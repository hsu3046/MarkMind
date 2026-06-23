/**
 * doc-converter 통합 타입 정의 — Rust src-tauri/src/converters/ 와 일치.
 */

import type { AICompany, AIAuthMode } from '../services/aiModelConfig';

export type DetailLevel = 'concise' | 'standard' | 'detailed' | 'verbatim';
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

/** Claude 호출 인증 소스 — API 키(공식) 또는 구독 OAuth(로컬 Claude Code 토큰 재사용). */
export type ClaudeAuthMode = 'api_key' | 'subscription';

export interface NotesJobOptions {
    transcript: string;
    template: string;
    source: string;
    detail?: DetailLevel;
    /** 전역 AI 모델 설정 — 회사 / 인증 / 모델. */
    company?: AICompany;
    auth?: AIAuthMode;
    model?: string;
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
    model?: {
        company: string;
        auth: AIAuthMode;
        model: string;
    };
    /** stable id — 같은 stepId 면 in-place 갱신 (heartbeat / progress). undefined 면 append. */
    stepId?: string;
}

// ─── UI 상태 ───

export type ConvertTab = 'audio' | 'notes' | 'ocr';

export type JobPhase = 'idle' | 'running' | 'done' | 'error';

export interface JobState {
    phase: JobPhase;
    steps: ProgressStep[];
    error?: string;
}
