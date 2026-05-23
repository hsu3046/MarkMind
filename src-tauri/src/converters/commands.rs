//! Tauri command 모음 — frontend 에서 invoke() 로 호출.
//!
//! 각 명령은 비동기로 파이프라인 실행 + ProgressEmitter 로 진행상황 stream.

use super::audio_pipeline::{self, AudioJobOptions, AudioJobResult};
use super::error::ConverterError;
use super::notes_pipeline::{self, NotesJobOptions, NotesJobResult};
use super::ocr_pipeline::{self, OcrJobOptions, OcrJobResult};
use super::progress::ProgressEmitter;
use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Serialize)]
pub struct JobError {
    pub message: String,
    #[serde(rename = "jobId")]
    pub job_id: String,
}

fn new_emitter(app: AppHandle) -> ProgressEmitter {
    let id = format!("job-{}", uuid::Uuid::new_v4().simple());
    ProgressEmitter::new(app, id)
}

fn err_to_string(e: ConverterError) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn run_audio_job(
    app: AppHandle,
    options: AudioJobOptions,
) -> Result<AudioJobResult, String> {
    let emitter = new_emitter(app.clone());
    audio_pipeline::run(&emitter, options, &app)
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn run_ocr_job(
    app: AppHandle,
    options: OcrJobOptions,
) -> Result<OcrJobResult, String> {
    let emitter = new_emitter(app);
    ocr_pipeline::run(&emitter, options)
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn run_notes_job(
    app: AppHandle,
    options: NotesJobOptions,
) -> Result<NotesJobResult, String> {
    let emitter = new_emitter(app.clone());
    notes_pipeline::run(&emitter, options, &app)
        .await
        .map_err(err_to_string)
}

/// 인라인 OCR — 결과 markdown 문자열만 반환 (.md 저장 안 함).
/// 에디터에 이미지 드래그 시 사용.
#[tauri::command]
pub async fn run_ocr_inline(
    app: AppHandle,
    image_path: String,
) -> Result<String, String> {
    let emitter = new_emitter(app);
    ocr_pipeline::run_inline(&emitter, &image_path)
        .await
        .map_err(err_to_string)
}

/// 변환 결과 .md 파일의 기본 저장 디렉토리 반환 (오늘 날짜)
#[tauri::command]
pub fn get_conversions_dir() -> String {
    super::conversions_dir().to_string_lossy().into_owned()
}
