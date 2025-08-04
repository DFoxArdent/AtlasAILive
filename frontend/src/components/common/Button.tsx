import { CommandBarButton, DefaultButton, IButtonProps } from '@fluentui/react';
import React, { useState } from 'react';

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

interface SwitchAIButtonProps {
    options: string[];
    onChange: (selectedIndex: string) => void;
}

export const SwitchAIButton: React.FC<SwitchAIButtonProps> = ({ options, onChange }) => {
    const [selected, setSelected] = useState(options[0]);

    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const newIndex = event.target.value;
        setSelected(newIndex);
        onChange(newIndex);
    };

    const formatLabel = (value: string): string => {
        if (value === "standard-responses") return "Standard Responses";
        return value
            .replace(/-/g, ' ') // Replace dashes with spaces
            .replace(/\b\w/g, (char) => char.toUpperCase()); // Capitalize each word
    };

    return (
        <div className={styles.switchAIButtonRoot}>
            <label htmlFor="Data-Select" style={{ marginRight: 8 }}>
                Select Data Source:
            </label>
            <select
                id="Data-Select"
                value={selected}
                onChange={handleChange}
                className={styles.dropdown}
            >
                {options.map((option) => (
                    <option key={option} value={option}>
                        {formatLabel(option)}
                    </option>
                ))}
            </select>
        </div>
    );
};

