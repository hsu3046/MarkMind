/**
 * doc-converter 통합 타입 정의 — Rust src-tauri/src/converters/ 와 일치.
 */

export type DetailLevel = 'concise' | 'standard' | 'detailed' | 'verbatim';
export type NotesProvider = 'claude' | 'gemini';
export type TemplateSource = 'builtin' | 'user';

export interface UsageInfo {
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}

export interface CostSummary {
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    breakdown: UsageInfo[];
}

export interface TemplateInfo {
    id: string;
    name: string;
    description: string;
    source: TemplateSource;
    path: string;
}

// ─── Audio ───

export interface AudioJobOptions {
    file_path: string;
    originalName?: string;
    trimSilence?: boolean;
    /**
     * Run an LLM post-processing pass that detects mis-split speaker labels
     * (same person tagged 화자A in one chunk, 화자C in another) and merges
     * them. Defaults to true on the Rust side — pass false to skip the
     * extra LLM call when speaker labels are known-correct or the user
     * prefers strict raw output.
     */
    dedupSpeakers?: boolean;
    outputDir?: string;
    /**
     * 1-based index of this file in a multi-file batch + total file count.
     * When both are set on a multi-file job, the Rust pipeline prefixes
     * every progress message with `(i/N)` so the user sees which file is
     * being processed in a long queue.
     */
    batchIndex?: number;
    batchTotal?: number;
}

export interface AudioJobResult {
    timestampedPath: string;
    cleanPath: string;
    cost: CostSummary;
}

// ─── OCR ───

export interface OcrJobOptions {
    file_path: string;
    originalName?: string;
    quick?: boolean;
    outputDir?: string;
}

export interface OcrJobResult {
    markdownPath: string;
    cost: CostSummary;
}

// ─── Notes ───

export interface NotesJobOptions {
    transcript: string;
    template: string;
    source: string;
    detail?: DetailLevel;
    provider?: NotesProvider;
    outputDir?: string;
}

export interface NotesJobResult {
    markdownPath: string;
    templateName: string;
    cost: CostSummary;
}

// ─── Progress event payload ───

export interface ProgressStep {
    jobId: string;
    step: string;
    detail?: string;
    progress?: number;
}

// ─── UI 상태 ───

export type ConvertTab = 'audio' | 'notes' | 'ocr';

export type JobPhase = 'idle' | 'running' | 'done' | 'error';

export interface JobState {
    phase: JobPhase;
    steps: ProgressStep[];
    error?: string;
}
