//! 변환 작업 진행상황을 Tauri event 로 frontend 에 stream.
//!
//! doc-converter 의 SSE (`/api/progress/:jobId`) 대체.
//! 윈도우별 격리를 위해 event 이름에 jobId 포함.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// 단일 진행 step — frontend ProgressPanel 이 한 줄씩 표시
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressStep {
    #[serde(rename = "jobId")]
    pub job_id: String,
    /// "🔍 Pass 1/2 — 텍스트 추출 중..." 같은 메인 메시지
    pub step: String,
    /// "23초 소요 · 누적 $0.012" 같은 부가 정보
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// 0.0 ~ 1.0 — 알 수 있는 경우만
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f32>,
}

#[derive(Clone)]
pub struct ProgressEmitter {
    app: AppHandle,
    job_id: String,
}

impl ProgressEmitter {
    pub fn new(app: AppHandle, job_id: String) -> Self {
        Self { app, job_id }
    }

    pub fn job_id(&self) -> &str {
        &self.job_id
    }

    pub fn emit(&self, step: impl Into<String>, detail: Option<String>) {
        let event = ProgressStep {
            job_id: self.job_id.clone(),
            step: step.into(),
            detail,
            progress: None,
        };
        let _ = self.app.emit("converter-progress", event);
    }

    #[allow(dead_code)]
    pub fn emit_with_progress(&self, step: impl Into<String>, detail: Option<String>, progress: f32) {
        let event = ProgressStep {
            job_id: self.job_id.clone(),
            step: step.into(),
            detail,
            progress: Some(progress),
        };
        let _ = self.app.emit("converter-progress", event);
    }
}

/// 초 → "N시간 M분 / N분 S초 / S초" 한국어 표기
pub fn fmt_duration(sec: f64) -> String {
    if sec < 60.0 {
        return format!("{:.0}초", sec);
    }
    if sec < 3600.0 {
        let m = (sec / 60.0).floor() as u64;
        let s = (sec % 60.0).round() as u64;
        return if s == 0 {
            format!("{}분", m)
        } else {
            format!("{}분 {}초", m, s)
        };
    }
    let h = (sec / 3600.0).floor() as u64;
    let m = ((sec % 3600.0) / 60.0).round() as u64;
    if m == 0 {
        format!("{}시간", h)
    } else {
        format!("{}시간 {}분", h, m)
    }
}
