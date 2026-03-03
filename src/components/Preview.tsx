import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface PreviewProps {
    content: string;
    fontSize?: number;
}

// Fix emphasis not closing when followed by CJK/letter characters
// e.g. **씬(Scene)**이다 → **씬(Scene)**\u200B이다
function fixEmphasis(md: string): string {
    // Only target closing emphasis: a non-space char before ** followed by a non-space, non-punctuation char
    // This ensures we don't break opening ** markers
    return md.replace(/(\S)(\*{1,2})(?=[^\s*\p{P}])/gu, '$1$2\u200B');
}

export function Preview({ content, fontSize = 14 }: PreviewProps) {
    const processedContent = useMemo(() => fixEmphasis(content), [content]);

    if (!content.trim()) {
        return (
            <div className="empty-state">
                <div className="empty-state-icon">📝</div>
                <div className="empty-state-text">Start typing to see preview</div>
            </div>
        );
    }

    return (
        <div className="preview-wrapper">
            <div
                className="markdown-body fade-in"
                style={{ fontSize: `${fontSize}px` }}
            >
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                >
                    {processedContent}
                </ReactMarkdown>
            </div>
        </div>
    );
}
