import json
import logging
import re
from typing import List, Optional, Tuple

import httpx
from azure.core.credentials import AzureKeyCredential
from azure.identity.aio import DefaultAzureCredential, get_bearer_token_provider
from azure.search.documents.aio import SearchClient
from azure.search.documents.models import VectorizedQuery

# Replaces Azure OpenAI On Your Data (retired 14 October 2026): the app now queries the
# Azure AI Search (Foundry IQ) index itself and grounds the Foundry model with the results.

NO_DATA_RESPONSE = (
    "The requested information is not available in the retrieved data. "
    "Please try another query or topic."
)

SEARCH_QUERY_PROMPT = (
    "Generate a search query for the latest user question, using the conversation "
    "so far for context. Return only the search query, with no other text."
)

HIDDEN_DOCUMENT_PATTERN = re.compile(
    r"\[hidden-document-content\][\s\S]*?\[/hidden-document-content\]"
)


def get_message_text(content) -> str:
    # User messages are either plain text or a list of parts (text + image)
    if isinstance(content, list):
        content = " ".join(
            part.get("text", "") for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        )
    if not isinstance(content, str):
        return ""
    # Uploaded document text is not part of the question being searched for
    return HIDDEN_DOCUMENT_PATTERN.sub("", content).strip()


async def generate_search_query(openai_client, model: str, messages: List[dict]) -> str:
    conversation = [
        {"role": m["role"], "content": get_message_text(m.get("content"))}
        for m in messages
        if m.get("role") in ("user", "assistant")
    ]
    question = next(
        (m["content"] for m in reversed(conversation) if m["role"] == "user"), ""
    )

    if sum(1 for m in conversation if m["role"] == "user") <= 1:
        return question

    try:
        response = await openai_client.chat.completions.create(
            model=model,
            messages=conversation + [{"role": "user", "content": SEARCH_QUERY_PROMPT}],
            temperature=0,
            max_tokens=100,
        )
        return (response.choices[0].message.content or "").strip() or question
    except Exception:
        logging.exception("Failed to generate search query, using the latest question")
        return question


async def get_query_embedding(app_settings, openai_client, text: str) -> List[float]:
    azure_openai = app_settings.azure_openai
    dimensions = app_settings.search.vectorization_dimensions

    if azure_openai.embedding_name:
        kwargs = {"dimensions": dimensions} if dimensions else {}
        response = await openai_client.embeddings.create(
            model=azure_openai.embedding_name, input=text, **kwargs
        )
        return response.data[0].embedding

    if azure_openai.embedding_endpoint:
        headers = {"Content-Type": "application/json"}
        if azure_openai.embedding_key:
            headers["api-key"] = azure_openai.embedding_key
        else:
            async with DefaultAzureCredential() as credential:
                token = await credential.get_token("https://cognitiveservices.azure.com/.default")
                headers["Authorization"] = f"Bearer {token.token}"

        payload = {"input": text}
        if dimensions:
            payload["dimensions"] = dimensions
        async with httpx.AsyncClient() as client:
            response = await client.post(azure_openai.embedding_endpoint, headers=headers, json=payload)
            response.raise_for_status()
            return response.json()["data"][0]["embedding"]

    raise ValueError(
        "A vector query type needs AZURE_OPENAI_EMBEDDING_NAME or AZURE_OPENAI_EMBEDDING_ENDPOINT"
    )


def build_citation(doc: dict, datasource, index: int) -> dict:
    excluded = set(datasource.vector_columns or [])
    excluded.update(
        c for c in (datasource.title_column, datasource.url_column, datasource.filename_column) if c
    )
    if datasource.content_columns:
        content_fields = datasource.content_columns
    else:
        content_fields = [
            k for k, v in doc.items()
            if isinstance(v, str) and not k.startswith("@") and k not in excluded
        ]

    return {
        "content": "\n".join(str(doc[f]) for f in content_fields if doc.get(f)),
        "title": doc.get(datasource.title_column) if datasource.title_column else None,
        "url": doc.get(datasource.url_column) if datasource.url_column else None,
        "filepath": doc.get(datasource.filename_column) if datasource.filename_column else None,
        "chunk_id": str(index),
        "metadata": None,
    }


async def search_documents(app_settings, openai_client, query: str, request) -> List[dict]:
    datasource = app_settings.datasource
    query_type = datasource.query_type or "simple"

    search_kwargs = {"top": datasource.top_k}

    if request is not None and datasource.permitted_groups_column:
        search_kwargs["filter"] = datasource._set_filter_string(request)

    if datasource.content_columns:
        search_kwargs["select"] = [
            c for c in (
                datasource.content_columns
                + [datasource.title_column, datasource.url_column, datasource.filename_column]
            ) if c
        ]

    if "semantic" in query_type:
        search_kwargs["query_type"] = "semantic"
        if datasource.semantic_search_config:
            search_kwargs["semantic_configuration_name"] = datasource.semantic_search_config

    if "vector" in query_type:
        if not datasource.vector_columns:
            raise ValueError("A vector query type needs AZURE_SEARCH_VECTOR_COLUMNS")
        vector = await get_query_embedding(app_settings, openai_client, query)
        search_kwargs["vector_queries"] = [
            VectorizedQuery(
                vector=vector,
                k_nearest_neighbors=datasource.top_k,
                fields=",".join(datasource.vector_columns),
            )
        ]

    search_text = None if query_type == "vector" else query

    if datasource.key:
        credential = AzureKeyCredential(datasource.key)
        async with SearchClient(datasource.endpoint, datasource.index, credential) as client:
            results = await client.search(search_text, **search_kwargs)
            docs = [doc async for doc in results]
    else:
        async with DefaultAzureCredential() as credential:
            async with SearchClient(datasource.endpoint, datasource.index, credential) as client:
                results = await client.search(search_text, **search_kwargs)
                docs = [doc async for doc in results]

    return [build_citation(doc, datasource, i) for i, doc in enumerate(docs)]


def build_grounding_message(app_settings, citations: List[dict]) -> dict:
    instructions = [
        app_settings.search.role_information,
        "",
        "Answer the user's questions using the retrieved documents below. "
        "Cite each document you use with its reference straight after the statement it supports, "
        "for example [doc1] or [doc1][doc3].",
    ]
    if app_settings.datasource.enable_in_domain:
        instructions.append(
            "Only use information from the retrieved documents or documents the user has uploaded. "
            f"If they do not contain the answer, reply with exactly: {NO_DATA_RESPONSE}"
        )
    else:
        instructions.append(
            "If the retrieved documents do not contain the answer, you may answer from general knowledge, "
            "but only cite retrieved documents."
        )

    documents = []
    for i, citation in enumerate(citations, start=1):
        title = f"Title: {citation['title']}\n" if citation.get("title") else ""
        documents.append(f"[doc{i}]\n{title}{citation['content']}")

    instructions += ["", "Retrieved documents:", "\n\n".join(documents) if documents else "(none)"]
    return {"role": "system", "content": "\n".join(instructions)}


async def ground_messages(
    app_settings, openai_client, messages: List[dict], request=None
) -> Tuple[List[dict], Optional[dict]]:
    # "context" was an On Your Data extension and is not accepted by the v1 API
    conversation = [
        {"role": m["role"], "content": m["content"]}
        for m in messages
        if m.get("role") != "system"
    ]

    query = await generate_search_query(
        openai_client, app_settings.azure_openai.model, conversation
    )
    citations = await search_documents(app_settings, openai_client, query, request)
    logging.debug(f"SEARCH QUERY: {query} ({len(citations)} results)")

    context = {"citations": citations, "intent": json.dumps([query])}
    return [build_grounding_message(app_settings, citations)] + conversation, context
