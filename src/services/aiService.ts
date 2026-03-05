import { GoogleGenAI } from '@google/genai';
import { AIRequest, AIResponse, DiffChunk, getModelForMode } from '../types/ai';

const API_KEY_STORAGE = 'markmind-gemini-api-key';

// ─── API Key Management ───────────────────────────────────

export function getApiKey(): string | null {
    return localStorage.getItem(API_KEY_STORAGE);
}

export function setApiKey(key: string): void {
    localStorage.setItem(API_KEY_STORAGE, key);
}

export function removeApiKey(): void {
    localStorage.removeItem(API_KEY_STORAGE);
}

export function hasApiKey(): boolean {
    const key = getApiKey();
    return !!key && key.trim().length > 0;
}

// ─── System Prompts ───────────────────────────────────────

function getSystemPrompt(request: AIRequest): string {
    const base = `You are an expert document editor. You work with Markdown documents.
CRITICAL RULES:
- Return ONLY the modified text. No explanations, no code blocks, no prefixes.
- Preserve all Markdown formatting (headings, lists, links, etc.).
- Do NOT add any text before or after the modified content.`;

    switch (request.mode) {
        case 'grammar':
            return `${base}
- Fix ONLY grammar errors, typos, and punctuation issues.
- Do NOT change the meaning, style, or structure.
- Make the minimum number of changes needed.
${request.prompt ? `- Additional instructions: ${request.prompt}` : ''}`;

        case 'translate':
            return `${base}
- Translate the text to ${getLanguageName(request.language || 'en')}.
- Maintain the original tone and style.
- Keep all Markdown formatting intact.
${request.prompt ? `- Additional instructions: ${request.prompt}` : ''}`;

        case 'improve':
            return `You are a senior document consultant and writing expert.
CRITICAL RULES:
- Return ONLY the improved text. No explanations, no code blocks, no prefixes.
- Preserve all Markdown formatting.
- Improve the document based on the user's specific instructions.
${request.prompt ? `\nUser instructions: ${request.prompt}` : ''}`;

        default:
            return base;
    }
}

function getLanguageName(lang: string): string {
    const names: Record<string, string> = {
        ko: 'Korean (한국어)',
        en: 'English',
        ja: 'Japanese (日本語)',
    };
    return names[lang] || lang;
}

// ─── Diff Generation ──────────────────────────────────────

export function generateDiff(original: string, modified: string): DiffChunk[] {
    const origParas = splitIntoParagraphs(original);
    const modParas = splitIntoParagraphs(modified);

    // Build paragraph-level operations
    type ParaOp = { type: 'unchanged'; text: string }
        | { type: 'removed'; text: string }
        | { type: 'added'; text: string };

    const ops: ParaOp[] = [];
    const lcs = computeLCS(origParas, modParas);
    let oi = 0, mi = 0, li = 0;

    while (oi < origParas.length || mi < modParas.length) {
        if (li < lcs.length && oi < origParas.length && mi < modParas.length
            && origParas[oi] === lcs[li] && modParas[mi] === lcs[li]) {
            ops.push({ type: 'unchanged', text: origParas[oi] });
            oi++; mi++; li++;
        } else if (li < lcs.length && oi < origParas.length && origParas[oi] !== lcs[li]) {
            ops.push({ type: 'removed', text: origParas[oi] });
            oi++;
        } else if (li < lcs.length && mi < modParas.length && modParas[mi] !== lcs[li]) {
            ops.push({ type: 'added', text: modParas[mi] });
            mi++;
        } else if (li >= lcs.length && oi < origParas.length) {
            ops.push({ type: 'removed', text: origParas[oi] });
            oi++;
        } else if (li >= lcs.length && mi < modParas.length) {
            ops.push({ type: 'added', text: modParas[mi] });
            mi++;
        } else {
            break;
        }
    }

    // Interleave consecutive removed/added batches into paired before/after
    const interleaved: ParaOp[] = [];
    let idx = 0;
    while (idx < ops.length) {
        if (ops[idx].type === 'removed') {
            // Collect consecutive removed
            const removedBatch: ParaOp[] = [];
            while (idx < ops.length && ops[idx].type === 'removed') {
                removedBatch.push(ops[idx]);
                idx++;
            }
            // Collect consecutive added
            const addedBatch: ParaOp[] = [];
            while (idx < ops.length && ops[idx].type === 'added') {
                addedBatch.push(ops[idx]);
                idx++;
            }
            // Interleave: pair removed[i] with added[i]
            const maxLen = Math.max(removedBatch.length, addedBatch.length);
            for (let k = 0; k < maxLen; k++) {
                if (k < removedBatch.length) interleaved.push(removedBatch[k]);
                if (k < addedBatch.length) interleaved.push(addedBatch[k]);
            }
        } else {
            interleaved.push(ops[idx]);
            idx++;
        }
    }

    // Convert ops to chunks, inserting blank separators only between paragraph groups
    const chunks: DiffChunk[] = [];
    let id = 0;

    for (let i = 0; i < interleaved.length; i++) {
        const op = interleaved[i];
        const lines = op.text.split('\n');

        for (const line of lines) {
            chunks.push({ id: id++, type: op.type === 'unchanged' ? 'unchanged' : op.type, content: line });
        }

        // Add blank separator between paragraph groups,
        // but NOT between a removed and an immediately following added (they form a pair)
        if (i < interleaved.length - 1) {
            const next = interleaved[i + 1];
            const isChangePair = op.type === 'removed' && next.type === 'added';
            if (!isChangePair) {
                chunks.push({ id: id++, type: 'unchanged', content: '' });
            }
        }
    }

    return chunks;
}

/** Split text into paragraphs (separated by blank lines) */
function splitIntoParagraphs(text: string): string[] {
    // Split on one or more blank lines
    return text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
}

/** Compute Longest Common Subsequence */
function computeLCS(a: string[], b: string[]): string[] {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    const result: string[] = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (a[i - 1] === b[j - 1]) {
            result.unshift(a[i - 1]);
            i--; j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }

    return result;
}

// ─── Apply Diff to Content ───────────────────────────────

export function applyDiff(chunks: DiffChunk[]): string {
    const lines: string[] = [];

    for (const chunk of chunks) {
        if (chunk.type === 'unchanged') {
            lines.push(chunk.content);
        } else if (chunk.type === 'removed') {
            // If not explicitly accepted (i.e., keeping original), include original
            if (chunk.accepted !== true) {
                lines.push(chunk.content);
            }
            // If accepted = true, the removal is applied (line is dropped)
        } else if (chunk.type === 'added') {
            // If not explicitly rejected, include the addition
            if (chunk.accepted !== false) {
                lines.push(chunk.content);
            }
            // If accepted = false, the addition is rejected (line is dropped)
        }
    }

    return lines.join('\n');
}

// ─── AI API Call ──────────────────────────────────────────

export async function callAI(
    request: AIRequest,
    onStream?: (text: string) => void,
): Promise<AIResponse> {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('API 키가 설정되지 않았습니다. 설정에서 Gemini API 키를 입력해주세요.');
    }

    const ai = new GoogleGenAI({ apiKey });
    const hasPrompt = !!request.prompt?.trim();
    const model = getModelForMode(request.mode, hasPrompt, request.improveQuality);

    const systemPrompt = getSystemPrompt(request);

    let userContent = request.content;
    if (hasPrompt) {
        userContent = `Instructions: ${request.prompt}\n\nDocument:\n${request.content}`;
    }

    let modifiedText = '';

    if (onStream) {
        // Streaming mode
        const response = await ai.models.generateContentStream({
            model,
            contents: userContent,
            config: {
                systemInstruction: systemPrompt,
            },
        });

        for await (const chunk of response) {
            const text = chunk.text || '';
            modifiedText += text;
            onStream(modifiedText);
        }
    } else {
        // Non-streaming mode
        const response = await ai.models.generateContent({
            model,
            contents: userContent,
            config: {
                systemInstruction: systemPrompt,
            },
        });

        modifiedText = response.text || '';
    }

    // Clean up: remove markdown code block wrappers if present
    modifiedText = modifiedText
        .replace(/^```(?:markdown|md)?\n/i, '')
        .replace(/\n```\s*$/, '')
        .trim();

    const chunks = generateDiff(request.content, modifiedText);

    return {
        originalText: request.content,
        modifiedText,
        chunks,
    };
}
