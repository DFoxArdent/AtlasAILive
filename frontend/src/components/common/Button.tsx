import { CommandBarButton, DefaultButton, IButtonProps } from '@fluentui/react';

import styles from './Button.module.css';

interface ButtonProps extends IButtonProps {
    onClick: () => void;
    text: string | undefined;
}

export const ShareButton: React.FC<ButtonProps> = ({ onClick, text }) => {
    return (
        <CommandBarButton
            className={styles.shareButtonRoot}
            iconProps={{ iconName: 'Share' }}
            onClick={onClick}
            text={text}
        />
    );
};

export const HistoryButton: React.FC<ButtonProps> = ({ onClick, text }) => {
    return (
        <DefaultButton
            className={styles.historyButtonRoot}
            text={text}
            iconProps={{ iconName: 'History' }}
            onClick={onClick}
        />
    );
};

export const SwitchAIButton: React.FC<{ url: string }> = ({ url }) => {
    return (
        <a
            href={url}
            className={styles.switchAIButtonRoot}
            title="Switch to Chat GPT"
        >
            Switch to Chat GPT
        </a>
    );
};
