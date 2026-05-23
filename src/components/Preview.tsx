import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeHighlight from 'rehype-highlight';

interface PreviewProps {
    content: string;
    fontSize?: number;
}

// Fix emphasis not closing when followed by CJK/letter characters
// e.g. **씬(Scene)**이다 → **씬(Scene)**​이다
function fixEmphasis(md: string): string {
    // Only target closing emphasis: a non-space char before ** followed by a non-space, non-punctuation char
    // This ensures we don't break opening ** markers
    return md.replace(/(\S)(\*{1,2})(?=[^\s*\p{P}])/gu, '$1$2​');
}

interface FrontmatterParts {
    fields: { key: string; value: string }[];
    body: string;
}

/**
 * `---\nkey: value\n...\n---\n본문` 분리.
 * 없으면 fields=[], body=원본.
 * doc-converter evidence frontmatter (한국어 라벨) + 일반 YAML 모두 대응.
 */
function splitFrontmatter(md: string): FrontmatterParts {
    if (!md.startsWith('---')) return { fields: [], body: md };
    const after = md.slice(3);
    const endIdx = after.indexOf('\n---');
    if (endIdx === -1) return { fields: [], body: md };
    const raw = after.slice(0, endIdx).trim();
    const body = after.slice(endIdx + 4).replace(/^\r?\n/, '');

    const fields: { key: string; value: string }[] = [];
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx === -1) continue;
        const key = trimmed.slice(0, colonIdx).trim();
        let value = trimmed.slice(colonIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        fields.push({ key, value });
    }
    return { fields, body };
}

export function Preview({ content, fontSize = 14 }: PreviewProps) {
    const { fields, processedBody } = useMemo(() => {
        const split = splitFrontmatter(content);
        return { fields: split.fields, processedBody: fixEmphasis(split.body) };
    }, [content]);

    if (!content.trim()) {
        return (
            <div className="empty-state">
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
                {fields.length > 0 && (
                    <aside className="markdown-frontmatter">
                        <dl>
                            {fields.map((f) => (
                                <div key={f.key} className="markdown-frontmatter-row">
                                    <dt>{f.key}</dt>
                                    <dd>{f.value}</dd>
                                </div>
                            ))}
                        </dl>
                    </aside>
                )}
                <ReactMarkdown
                    remarkPlugins={[
                        remarkFrontmatter,
                        [remarkGfm, { singleTilde: false }],
                    ]}
                    rehypePlugins={[rehypeHighlight]}
                >
                    {processedBody}
                </ReactMarkdown>
            </div>
        </div>
    );
}
