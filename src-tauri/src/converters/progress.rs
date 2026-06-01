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
    /// stable id — 같은 stepId 면 ProgressPanel 이 in-place 갱신 (heartbeat / progress 갱신용).
    /// None 이면 새 row append (기본 동작).
    #[serde(rename = "stepId", skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
}

#[derive(Clone)]
pub struct ProgressEmitter {
    app: AppHandle,
    job_id: String,
    /// Optional fixed prefix prepended to every emitted `step`. Used by the
    /// batch path (audio multi-file) so messages read "(2/3) ✂️ 무음 ...".
    /// Wrapped emitters share the same job_id + app so progress still goes
    /// to the same listener — only the step text differs.
    prefix: Option<String>,
}

impl ProgressEmitter {
    pub fn new(app: AppHandle, job_id: String) -> Self {
        Self { app, job_id, prefix: None }
    }

    pub fn job_id(&self) -> &str {
        &self.job_id
    }

    /// Return a clone of this emitter with `prefix` prepended to every
    /// future `step` message. Existing call sites stay untouched — they
    /// emit their natural text and the prefix is applied here.
    pub fn with_prefix(&self, prefix: impl Into<String>) -> Self {
        Self {
            app: self.app.clone(),
            job_id: self.job_id.clone(),
            prefix: Some(prefix.into()),
        }
    }

    /// Inject the prefix AFTER the leading emoji (if any). ProgressPanel's
    /// `iconFor` matches with `^⏳`/`^✂️`/etc. anchored at position 0; if
    /// we just prepend the batch tag (`(2/3) ⏳ ...`) the emoji is no
    /// longer at position 0 and every batch row loses its icon. Splitting
    /// at the first whitespace after the emoji keeps the icon picker
    /// happy while still surfacing the batch index.
    fn prefix_step(&self, step: String) -> String {
        let prefix = match &self.prefix {
            Some(p) => p,
            None => return step,
        };
        // Find the first space — separates the (typically emoji) head
        // from the body. If there's no space (e.g. single-word step),
        // fall back to leading-prefix.
        match step.find(' ') {
            Some(i) => {
                let (head, tail) = step.split_at(i);
                // tail begins with the space, so concatenating gives
                // "<emoji> <prefix><space><body>".
                format!("{} {}{}", head, prefix, tail)
            }
            None => format!("{} {}", prefix, step),
        }
    }

    pub fn emit(&self, step: impl Into<String>, detail: Option<String>) {
        let event = ProgressStep {
            job_id: self.job_id.clone(),
            step: self.prefix_step(step.into()),
            detail,
            progress: None,
            step_id: None,
        };
        let _ = self.app.emit("converter-progress", event);
    }

    #[allow(dead_code)]
    pub fn emit_with_progress(&self, step: impl Into<String>, detail: Option<String>, progress: f32) {
        let event = ProgressStep {
            job_id: self.job_id.clone(),
            step: self.prefix_step(step.into()),
            detail,
            progress: Some(progress),
            step_id: None,
        };
        let _ = self.app.emit("converter-progress", event);
    }

    /// 같은 step_id 의 이전 emit 을 in-place 갱신 — heartbeat / 진행률 표시.
    /// 첫 emit (id 미존재) 이면 append, 이후엔 같은 row 의 텍스트/progress 만 갱신.
    /// ProgressPanel 이 stepId 매칭 시 row replace 처리.
    pub fn emit_update(
        &self,
        step_id: impl Into<String>,
        step: impl Into<String>,
        detail: Option<String>,
        progress: Option<f32>,
    ) {
        let event = ProgressStep {
            job_id: self.job_id.clone(),
            step: self.prefix_step(step.into()),
            detail,
            progress,
            step_id: Some(step_id.into()),
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
