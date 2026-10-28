import json
import os
from importlib import import_module, reload
from types import SimpleNamespace

import pytest

from backend import retrieval


@pytest.fixture(scope="function")
def app_settings():
    os.environ["DOTENV_PATH"] = os.path.join(
        os.path.dirname(__file__), "dotenv_data", "dotenv_with_azure_search_success"
    )
    settings_module = reload(import_module("backend.settings"))
    yield settings_module.app_settings


class FakeSearchClient:
    calls = []
    docs = []

    def __init__(self, endpoint, index_name, credential):
        self.endpoint = endpoint
        self.index_name = index_name
        self.credential = credential

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def search(self, search_text, **kwargs):
        FakeSearchClient.calls.append(
            {"endpoint": self.endpoint, "index": self.index_name, "credential": self.credential,
             "search_text": search_text, **kwargs}
        )

        async def results():
            for doc in FakeSearchClient.docs:
                yield doc
        return results()


class FakeOpenAIClient:
    def __init__(self, rewritten_query="rewritten query"):
        self.chat_calls = []
        self.embedding_calls = []

        async def create_chat(**kwargs):
            self.chat_calls.append(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=rewritten_query))])

        async def create_embedding(**kwargs):
            self.embedding_calls.append(kwargs)
            return SimpleNamespace(data=[SimpleNamespace(embedding=[0.1, 0.2])])

        self.chat = SimpleNamespace(completions=SimpleNamespace(create=create_chat))
        self.embeddings = SimpleNamespace(create=create_embedding)


@pytest.fixture(autouse=True)
def fake_search(monkeypatch):
    FakeSearchClient.calls = []
    FakeSearchClient.docs = [
        {"content1": "Holiday policy text", "content2": "More detail", "title": "Holidays",
         "url": "https://example.com/holidays", "filepath": "holidays.pdf", "vector1": [0.5],
         "@search.score": 1.2},
        {"content1": "Expenses policy text", "title": "Expenses", "url": None,
         "filepath": "expenses.pdf", "@search.score": 0.8},
    ]
    monkeypatch.setattr(retrieval, "SearchClient", FakeSearchClient)


@pytest.mark.asyncio
async def test_simple_search_grounds_first_question(app_settings):
    openai_client = FakeOpenAIClient()
    messages = [{"role": "user", "content": "How many holidays do I get?"}]

    grounded, context = await retrieval.ground_messages(app_settings, openai_client, messages)

    call = FakeSearchClient.calls[0]
    assert call["endpoint"] == "https://search_service.search.windows.net"
    assert call["index"] == "search_index"
    assert call["search_text"] == "How many holidays do I get?"
    assert call["top"] == 5
    assert call["select"] == ["content1", "content2", "title", "url", "filepath"]
    assert "query_type" not in call and "vector_queries" not in call
    assert openai_client.chat_calls == []

    assert context["intent"] == json.dumps(["How many holidays do I get?"])
    assert context["citations"][0] == {
        "content": "Holiday policy text\nMore detail", "title": "Holidays",
        "url": "https://example.com/holidays", "filepath": "holidays.pdf",
        "chunk_id": "0", "metadata": None,
    }
    assert context["citations"][1]["content"] == "Expenses policy text"

    assert grounded[0]["role"] == "system"
    assert "[doc1]\nTitle: Holidays\nHoliday policy text" in grounded[0]["content"]
    assert "[doc2]\nTitle: Expenses\nExpenses policy text" in grounded[0]["content"]
    assert retrieval.NO_DATA_RESPONSE in grounded[0]["content"]
    assert grounded[1:] == messages


@pytest.mark.asyncio
async def test_follow_up_question_is_rewritten_without_uploaded_documents(app_settings):
    openai_client = FakeOpenAIClient(rewritten_query="expenses policy limits")
    messages = [
        {"role": "user", "content": "Tell me about expenses"},
        {"role": "assistant", "content": "Expenses are covered [doc1].", "context": "{}"},
        {"role": "user", "content": "[Document Preview]: a.docx\n[hidden-document-content]secret[/hidden-document-content]\nWhat are the limits?"},
    ]

    grounded, context = await retrieval.ground_messages(app_settings, openai_client, messages)

    rewrite_messages = openai_client.chat_calls[0]["messages"]
    assert all("secret" not in m["content"] for m in rewrite_messages)
    assert FakeSearchClient.calls[0]["search_text"] == "expenses policy limits"
    assert context["intent"] == json.dumps(["expenses policy limits"])
    # The uploaded document is still sent to the model, but not the On Your Data "context" field
    assert "secret" in grounded[-1]["content"]
    assert all("context" not in m for m in grounded)


@pytest.mark.asyncio
async def test_vector_semantic_hybrid_search(app_settings):
    app_settings.datasource.query_type = "vector_semantic_hybrid"
    app_settings.datasource.semantic_search_config = "my-semantic-config"
    openai_client = FakeOpenAIClient()

    await retrieval.ground_messages(
        app_settings, openai_client, [{"role": "user", "content": "holidays"}]
    )

    call = FakeSearchClient.calls[0]
    assert call["search_text"] == "holidays"
    assert call["query_type"] == "semantic"
    assert call["semantic_configuration_name"] == "my-semantic-config"
    assert call["vector_queries"][0].as_dict() == {
        "vector": [0.1, 0.2], "k": 5, "fields": "vector1", "kind": "vector"
    }
    assert openai_client.embedding_calls == [{"model": "embedding_model", "input": "holidays"}]


@pytest.mark.asyncio
async def test_vector_only_search_sends_no_text(app_settings):
    app_settings.datasource.query_type = "vector"

    await retrieval.ground_messages(
        app_settings, FakeOpenAIClient(), [{"role": "user", "content": "holidays"}]
    )

    assert FakeSearchClient.calls[0]["search_text"] is None


@pytest.mark.asyncio
async def test_managed_identity_used_without_search_key(app_settings, monkeypatch):
    class FakeCredential:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

    monkeypatch.setattr(retrieval, "DefaultAzureCredential", FakeCredential)
    app_settings.datasource.key = None

    await retrieval.ground_messages(
        app_settings, FakeOpenAIClient(), [{"role": "user", "content": "holidays"}]
    )

    assert isinstance(FakeSearchClient.calls[0]["credential"], FakeCredential)


@pytest.mark.asyncio
async def test_out_of_domain_answers_allowed_when_in_domain_disabled(app_settings):
    app_settings.datasource.enable_in_domain = False
    FakeSearchClient.docs = []

    grounded, context = await retrieval.ground_messages(
        app_settings, FakeOpenAIClient(), [{"role": "user", "content": "holidays"}]
    )

    assert context["citations"] == []
    assert retrieval.NO_DATA_RESPONSE not in grounded[0]["content"]
    assert "general knowledge" in grounded[0]["content"]
