import { AnchorHTMLAttributes } from 'react';
import { ExtraProps } from 'react-markdown';

// Opens markdown links in a new tab (replaces the linkTarget="_blank" prop removed in react-markdown v9)
export const MarkdownLink = ({ node, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps) => (
    <a {...props} target="_blank" />
);
