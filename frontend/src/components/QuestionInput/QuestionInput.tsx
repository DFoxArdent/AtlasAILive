import { useContext, useState } from 'react';
import { Stack, TextField } from '@fluentui/react';
import { SendRegular } from '@fluentui/react-icons';

import Send from '../../assets/Send.svg';

import styles from './QuestionInput.module.css';
import { ChatMessage } from '../../api';
import { AppStateContext } from '../../state/AppProvider';

interface Props {
    onSend: (question: ChatMessage['content'], id?: string) => void;
    disabled: boolean;
    placeholder?: string;
    clearOnSend?: boolean;
    conversationId?: string;
}

export const QuestionInput = ({ onSend, disabled, placeholder, clearOnSend, conversationId }: Props) => {
    const [question, setQuestion] = useState<string>('');

    const appStateContext = useContext(AppStateContext);

    const sendQuestion = () => {
        if (disabled || !question.trim()) return;

        const questionContent: ChatMessage['content'] = question.toString();

        if (conversationId) {
            onSend(questionContent, conversationId);
        } else {
            onSend(questionContent);
        }

        if (clearOnSend) setQuestion('');
    };

    const onEnterPress = (event: React.KeyboardEvent<Element>) => {
        if (event.key === 'Enter' && !event.shiftKey && !(event.nativeEvent?.isComposing === true)) {
            event.preventDefault();
            sendQuestion();
        }
    };

    const onQuestionChange = (_ev: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) => {
        setQuestion(newValue || '');
    };

    const sendQuestionDisabled = disabled || !question.trim();

    return (
        <Stack horizontal className={styles.questionInputContainer}>
            <TextField
                className={styles.questionInputTextArea}
                placeholder={placeholder}
                multiline
                resizable={false}
                borderless
                value={question}
                onChange={onQuestionChange}
                onKeyDown={onEnterPress}
            />
            <div className={styles.fileAndSendContainer}>
                {/* Send Button */}
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
            <div className={styles.questionInputBottomBorder} />
        </Stack>
    );
};
