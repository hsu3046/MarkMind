import { GoogleGenAI } from '@google/genai';
import { AIRequest, AIResponse, DiffChunk, DiffSeg, getModelForMode } from '../types/ai';
import { getKey, hasKey, setKey, removeKey } from './secureStorage';
import { getCachedUserMemory } from './userMemory';

// ─── API Key Management ───────────────────────────────────
// 저장소: Tauri 환경 → macOS Keychain (Rust keyring), 웹 → localStorage.
// 첫 호출 전에 main.tsx 의 initSecureStorage() 가 완료되어야 한다.

export function getApiKey(): string | null {
    return getKey('gemini');
}

export async function setApiKey(key: string): Promise<void> {
    await setKey('gemini', key);
}

export async function removeApiKey(): Promise<void> {
    await removeKey('gemini');
}

export function hasApiKey(): boolean {
    return hasKey('gemini');
}

// ─── System Prompts ───────────────────────────────────────

function getSystemPrompt(request: AIRequest): string {
    return getBaseSystemPrompt(request) + buildUserMemoryBlock();
}

/** 사용자 메모리(#15)를 system prompt 끝에 "참고 컨텍스트" 로 덧붙인다.
    출력 형식 규칙(수정 텍스트만 출력 등)은 각 모드 prompt 가 이미 강제하므로,
    여기선 톤·어조·용어·배경 이해에 쓸 정보만 제공한다. */
function buildUserMemoryBlock(): string {
    const memory = getCachedUserMemory().trim();
    if (!memory) return '';
    return `\n\n## 사용자 컨텍스트 (참고용)
다음은 사용자가 제공한 정보입니다. 톤·어조·용어·배경 이해에 반영하되, 위의 출력 형식 규칙은 그대로 지키세요.
${memory}`;
}

function getBaseSystemPrompt(request: AIRequest): string {
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

        case 'structurize':
            return `You are an expert at reorganizing documents into a clean hierarchical outline that reads well as a mind map.
CRITICAL RULES:
- Output ONLY Markdown. No explanations, no code fences, no prefixes.
- Reorganize the content into a hierarchy using ONLY '#'/'##'/'###' headings and '-' bullet lists.
- Use a single top-level '# ' heading as the title; group related ideas under '##'/'###' headings; use '-' bullets for leaf items.
- Preserve the original meaning and key details. Do NOT invent new facts or drop important content.
- Prefer short, scannable node labels over long sentences.
${request.prompt ? `- Additional instructions: ${request.prompt}` : ''}`;

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

    // Convert ops to chunks. 변경된 문단 쌍(removed→added)은 word-level inline diff
    // 를 적용해 바뀐 단어만 강조한다(parts). 그 외(unchanged/순수 add·del)는 기존
    // 라인 단위. 그룹 사이에 빈 줄 separator(쌍 내부는 제외).
    const chunks: DiffChunk[] = [];
    let id = 0;
    let i = 0;

    while (i < interleaved.length) {
        const op = interleaved[i];
        const next = interleaved[i + 1];

        if (op.type === 'removed' && next && next.type === 'added') {
            // 변경 쌍 — 문단 전체를 한 chunk 로 두고 단어 단위 세그먼트 부여.
            const { origParts, modParts } = wordDiff(op.text, next.text);
            chunks.push({ id: id++, type: 'removed', content: op.text, parts: origParts });
            chunks.push({ id: id++, type: 'added', content: next.text, parts: modParts });
            i += 2;
        } else {
            for (const line of op.text.split('\n')) {
                chunks.push({ id: id++, type: op.type, content: line });
            }
            i += 1;
        }

        if (i < interleaved.length) {
            chunks.push({ id: id++, type: 'unchanged', content: '' });
        }
    }

    return chunks;
}

/** 단어/공백/구두점 토큰화 (한글·영문·숫자는 묶고 구두점은 1글자씩 →
    따옴표 하나 변경도 그 토큰만 잡힘). */
function tokenize(s: string): string[] {
    return s.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
}

/** 변경된 문단 쌍에 단어 단위 LCS 적용 → 양쪽 세그먼트(공통=unchanged, 차이=removed/added). */
function wordDiff(orig: string, mod: string): { origParts: DiffSeg[]; modParts: DiffSeg[] } {
    const a = tokenize(orig);
    const b = tokenize(mod);
    const lcs = computeLCS(a, b);
    return {
        origParts: buildSegs(a, lcs, 'removed'),
        modParts: buildSegs(b, lcs, 'added'),
    };
}

/** 토큰 배열을 LCS 기준으로 세그먼트화. 공통 토큰=unchanged, 나머지=changeType.
    인접 동일 type 은 병합. */
function buildSegs(tokens: string[], lcs: string[], changeType: 'removed' | 'added'): DiffSeg[] {
    const segs: DiffSeg[] = [];
    let li = 0;
    for (const tok of tokens) {
        let type: DiffSeg['type'];
        if (li < lcs.length && tok === lcs[li]) {
            type = 'unchanged';
            li++;
        } else {
            type = changeType;
        }
        const last = segs[segs.length - 1];
        if (last && last.type === type) last.text += tok;
        else segs.push({ text: tok, type });
    }
    return segs;
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
