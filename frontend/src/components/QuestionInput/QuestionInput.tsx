import { useContext, useState, useRef } from 'react';
import { FontIcon, Stack, TextField, Spinner } from '@fluentui/react';
import { SendRegular } from '@fluentui/react-icons';

import Send from '../../assets/Send.svg';
import DocUpload from '../../assets/DocUpload.svg';

import styles from './QuestionInput.module.css';
import { ChatMessage } from '../../api';
import { AppStateContext } from '../../state/AppProvider';
import { resizeImage } from '../../utils/resizeImage';

interface Props {
    onSend: (question: ChatMessage['content'], id?: string, silent?: boolean) => void;
    disabled: boolean;
    placeholder?: string;
    clearOnSend?: boolean;
    conversationId?: string;
    isProcessingDocument?: boolean;
    setIsProcessingDocument?: (value: boolean) => void;
}

export const QuestionInput = ({
    onSend,
    disabled,
    placeholder,
    clearOnSend,
    conversationId,
    isProcessingDocument,
    setIsProcessingDocument,
}: Props) => {
    const [question, setQuestion] = useState<string>('');
    const [base64Image, setBase64Image] = useState<string | null>(null);
    const [documentFile, setDocumentFile] = useState<File | null>(null);

    const appStateContext = useContext(AppStateContext);
    const OYD_ENABLED = appStateContext?.state.frontendSettings?.oyd_enabled || false;

    const imageInputRef = useRef<HTMLInputElement>(null);
    const documentInputRef = useRef<HTMLInputElement>(null);

    const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            console.warn('No file selected');
            return;
        }
        try {
            const resizedBase64 = await resizeImage(file, 800, 800);
            setBase64Image(resizedBase64);
            setDocumentFile(null);
        } catch (error) {
            console.error('Error during image upload:', error);
        }
    };

    const onPaste = async (event: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const clipboardItems = event.clipboardData.items;
        for (let i = 0; i < clipboardItems.length; i++) {
            const item = clipboardItems[i];
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                    try {
                        const resizedBase64 = await resizeImage(file, 800, 800);
                        setBase64Image(resizedBase64);
                        setDocumentFile(null);
                    } catch (error) {
                        console.error('Error during image paste:', error);
                    }
                }
                break;
            }
        }
    };

    const removeImage = () => setBase64Image(null);

    const handleDocumentSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            console.warn('No document selected');
            return;
        }
        setBase64Image(null);
        setDocumentFile(file);
        console.log('Document file selected:', file);
    };

    const removeUpload = () => {
        setBase64Image(null);
        setDocumentFile(null);
        if (imageInputRef.current) imageInputRef.current.value = '';
        if (documentInputRef.current) documentInputRef.current.value = '';
    };

    const sendQuestion = async () => {
        const trimmedQuestion = question.trim();

        if (disabled || (!trimmedQuestion && !base64Image && !documentFile)) return;

        let questionContent: ChatMessage['content'];

        if (documentFile) {
            if (setIsProcessingDocument) setIsProcessingDocument(true);

            let documentChunks: string[] | null = null;
            try {
                const formData = new FormData();
                formData.append('file', documentFile);
                const response = await fetch('http://127.0.0.1:50505/upload', {
                    method: 'POST',
                    body: formData,
                });
                const data = await response.json();
                if (!response.ok) {
                    alert(data.error); 
                    removeUpload();    
                    return;          
                }
                documentChunks = data.chunks;
            } catch (error) {
                console.error('Error processing document:', error);
            } finally {
                if (setIsProcessingDocument) setIsProcessingDocument(false);
            }

            const previewLine = `[Document Preview]: ${documentFile.name}\n`;
            let finalUserMessage: ChatMessage['content'];
            if (documentChunks && documentChunks.length > 0) {
                const hiddenDocumentContent = documentChunks.join("");
                finalUserMessage =
                    previewLine +
                    `[hidden-document-content]${hiddenDocumentContent}[/hidden-document-content]\n` +
                    trimmedQuestion;
            } else {
                finalUserMessage = previewLine + trimmedQuestion;
            }
            await onSend(finalUserMessage, conversationId, false);
            removeUpload();
            if (clearOnSend) setQuestion('');
            return;
        } else if (base64Image) {
            questionContent = [
                { type: 'text', text: trimmedQuestion },
                { type: 'image_url', image_url: { url: base64Image } },
            ];
        } else {
            questionContent = trimmedQuestion;
        }

        if (conversationId) {
            onSend(questionContent, conversationId);
        } else {
            onSend(questionContent);
        }
        removeUpload();
        if (clearOnSend) setQuestion('');
    };

    const onEnterPress = (event: React.KeyboardEvent<Element>) => {
        if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !(event.nativeEvent?.isComposing === true)
        ) {
            event.preventDefault();
            sendQuestion();
        }
    };

    const handleSendKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
            sendQuestion();
        }
    };

    const sendQuestionDisabled =
        disabled || (!question.trim() && !base64Image && !documentFile) || (isProcessingDocument ?? false);

    return (
        <Stack horizontal className={styles.questionInputContainer}>
            {isProcessingDocument && (
                <div className={styles.spinnerOverlay}>
                    <Spinner label="Processing document..." />
                </div>
            )}

            <TextField
                className={styles.questionInputTextArea}
                placeholder={placeholder}
                multiline
                resizable={false}
                borderless
                value={question}
                onChange={(_ev, newValue) => setQuestion(newValue || '')}
                onKeyDown={(event) => event.key === 'Enter' && !event.shiftKey && sendQuestion()}
                onPaste={onPaste}
            />

            <div className={styles.fileAndSendContainer}>
                <div className={styles.fileInputContainer}>
                    <input
                        type="file"
                        id="imageInput"
                        onChange={handleImageUpload}
                        accept="image/*"
                        className={styles.fileInput}
                        ref={imageInputRef}
                    />
                    <label
                        htmlFor="imageInput"
                        className={styles.fileLabel}
                        aria-label="Upload Image"
                        title="Click here to upload an image"
                    >
                        <FontIcon
                            className={styles.fileIcon}
                            iconName="PhotoCollection"
                            aria-label="Upload Image Icon"
                        />
                    </label>
                </div>

                <div className={styles.fileInputContainer}>
                    <input
                        type="file"
                        id="documentInput"
                        onChange={handleDocumentSelect}
                        accept=".pdf,.docx,.txt,.xls,.xlsx,.csv"
                        className={styles.fileInput}
                        ref={documentInputRef}
                    />
                    <label
                        htmlFor="documentInput"
                        className={styles.fileLabel}
                        aria-label="Upload Document"
                        title="Click here to upload a document"
                    >
                        <img
                            src={DocUpload}
                            className={styles.fileIcon}
                            alt="Upload Document Icon"
                        />
                    </label>
                </div>

                <div
                    className={styles.questionInputSendButtonContainer}
                    role="button"
                    tabIndex={0}
                    aria-label="Ask Question Button"
                    onClick={sendQuestion}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ' ? sendQuestion() : null)}
                >
                    {sendQuestionDisabled ? (
                        <SendRegular className={styles.questionInputSendButtonDisabled} />
                    ) : (
                        <img src={Send} className={styles.questionInputSendButton} alt="Send Button" />
                    )}
                </div>
            </div>

            {base64Image && (
                <div className={styles.uploadPreviewContainer}>
                    <img className={styles.uploadedImage} src={base64Image} alt="Uploaded Preview" />
                    <button
                        className={styles.removeImageButton}
                        onClick={removeImage}
                        aria-label="Remove Uploaded Image"
                        disabled={isProcessingDocument}
                    >
                        &times;
                    </button>
                </div>
            )}

            {documentFile && (
                <div className={styles.uploadPreviewContainer}>
                    <p className={styles.uploadedDocument}>{documentFile.name}</p>
                    <button
                        className={styles.removeImageButton}
                        onClick={() => setDocumentFile(null)}
                        aria-label="Remove Uploaded Document"
                        disabled={isProcessingDocument}
                    >
                        &times;
                    </button>
                </div>
            )}

            <div className={styles.questionInputBottomBorder} />
        </Stack>
    );
};
