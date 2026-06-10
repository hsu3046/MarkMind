//! 로컬 화자분리 — pyannote.audio Python 사이드카(diarize_pyannote.py) 실행.
//! 유료 pyannote.ai 키 없이 무료/오프라인으로 동작 (Python + pyannote.audio 설치 +
//! 무료 HF 토큰 1회 필요). `MARKMIND_DIAR_PYTHON` 으로 Python 인터프리터 지정 시 활성.

use super::audio_splitter::ffmpeg_path;
use super::diar::{labels_to_segments, DiarSegment};
use super::error::{ConverterError, ConverterResult};
use super::progress::{fmt_duration, ProgressEmitter};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Instant;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;

/// pyannote 단계명 → 사용자용 한국어 라벨.
fn kor_step(s: &str) -> &str {
    match s {
        "segmentation" => "발화 구간 검출",
        "embeddings" => "화자 임베딩",
        "discrete_diarization" | "clustering" => "화자 클러스터링",
        "speaker_counting" => "화자 수 추정",
        _ => "분석",
    }
}

#[derive(Deserialize)]
struct Turn {
    start: f64,
    end: f64,
    speaker: String,
}

/// 로컬 pyannote 활성 조건 = Python 경로가 지정됨. 우선순위:
/// ① ENV `MARKMIND_DIAR_PYTHON` (파워유저) → ② Settings 에 저장된 `diar_python`(vault).
/// 둘 다 없으면 None(로컬 비활성 → 클라우드/폴백).
pub fn local_python() -> Option<String> {
    if let Ok(p) = std::env::var("MARKMIND_DIAR_PYTHON") {
        if !p.trim().is_empty() {
            return Some(p);
        }
    }
    crate::secrets::load()
        .diar_python
        .filter(|s| !s.trim().is_empty())
}

fn resolve_script(app: &tauri::AppHandle) -> ConverterResult<PathBuf> {
    if let Ok(dir) = app.path().resource_dir() {
        for p in [
            dir.join("resources").join("diarize_pyannote.py"),
            dir.join("diarize_pyannote.py"),
        ] {
            if p.is_file() {
                return Ok(p);
            }
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("diarize_pyannote.py");
    if dev.is_file() {
        return Ok(dev);
    }
    Err(ConverterError::Internal(
        "diarize_pyannote.py 스크립트 못 찾음 (resources/)".into(),
    ))
}

/// Python 사이드카로 로컬 pyannote 화자분리 실행 → DiarSegment.
/// stderr 의 진행 라인(PROGRESS/STEP)을 실시간으로 읽어 `emitter` 로 진행바+ETA 표시.
pub async fn diarize_local(
    app: &tauri::AppHandle,
    emitter: &ProgressEmitter,
    python: &str,
    file_path: &Path,
    num_speakers: Option<usize>,
) -> ConverterResult<Vec<DiarSegment>> {
    let script = resolve_script(app)?;
    let num = num_speakers
        .map(|n| n.to_string())
        .unwrap_or_else(|| "auto".into());

    let mut cmd = Command::new(python);
    cmd.arg(&script)
        .arg(file_path)
        .arg(num)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Ok(ff) = ffmpeg_path() {
        cmd.env("MARKMIND_FFMPEG", ff);
    }
    // HF_TOKEN 이 환경에 없으면, 이미 캐시된 게이트 모델을 토큰 없이 쓰도록 오프라인 모드.
    if std::env::var("HF_TOKEN").map(|v| v.trim().is_empty()).unwrap_or(true) {
        cmd.env("HF_HUB_OFFLINE", "1");
    }

    let mut child = cmd.spawn().map_err(|e| {
        ConverterError::Internal(format!(
            "python 실행 실패: {} (MARKMIND_DIAR_PYTHON 경로 확인)",
            e
        ))
    })?;

    // stdout(JSON 결과)은 별도 task 로 끝까지 수집 — pipe 버퍼 막힘 방지.
    let mut stdout = child.stdout.take().expect("stdout piped");
    let stdout_task = tokio::spawn(async move {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf).await;
        buf
    });

    // stderr 를 줄 단위로 읽어 진행 표시 + 에러 tail 보존.
    let stderr = child.stderr.take().expect("stderr piped");
    let mut lines = BufReader::new(stderr).lines();
    let mut tail: Vec<String> = Vec::new();
    let started = Instant::now();
    let mut step_started = Instant::now();
    let mut cur_step = String::new();

    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(rest) = line.strip_prefix("PROGRESS\t") {
            let p: Vec<&str> = rest.split('\t').collect();
            if p.len() >= 3 {
                let (step, completed, total) = (
                    p[0],
                    p[1].parse::<f64>().unwrap_or(0.0),
                    p[2].parse::<f64>().unwrap_or(0.0),
                );
                if step != cur_step {
                    cur_step = step.to_string();
                    step_started = Instant::now();
                }
                let frac = if total > 0.0 { (completed / total).clamp(0.0, 1.0) } else { 0.0 };
                let el = step_started.elapsed().as_secs_f64();
                let detail = if completed > 0.0 && completed < total {
                    let eta = el * (total - completed) / completed;
                    format!("{:.0}% · ETA {}", frac * 100.0, fmt_duration(eta))
                } else {
                    format!("{:.0}%", frac * 100.0)
                };
                emitter.emit_update(
                    "diar-local",
                    format!("🎭 화자 분리 — {}", kor_step(step)),
                    Some(detail),
                    Some(frac as f32),
                );
            }
        } else if let Some(name) = line.strip_prefix("STEP\t") {
            emitter.emit_update(
                "diar-local",
                format!("🎭 화자 분리 — {}", kor_step(name)),
                Some(format!("{}초 경과", started.elapsed().as_secs())),
                None,
            );
        } else {
            // 그 외 stderr(경고 등) — 에러 보고용으로 마지막 몇 줄만 보존.
            tail.push(line);
            if tail.len() > 8 {
                tail.remove(0);
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| ConverterError::Internal(format!("python wait 실패: {}", e)))?;
    let stdout_str = stdout_task.await.unwrap_or_default();

    if !status.success() {
        return Err(ConverterError::Internal(format!(
            "로컬 diarization 실패:\n{}",
            tail.join("\n")
        )));
    }

    let turns: Vec<Turn> = serde_json::from_str(stdout_str.trim()).map_err(|e| {
        let head: String = stdout_str.chars().take(120).collect();
        ConverterError::Internal(format!("diarization 출력 파싱 실패: {} (stdout: {})", e, head))
    })?;

    emitter.emit_update(
        "diar-local",
        "🎭 화자 분리 완료",
        Some(format!("{} 소요", fmt_duration(started.elapsed().as_secs_f64()))),
        Some(1.0),
    );

    Ok(labels_to_segments(
        turns.into_iter().map(|t| (t.start, t.end, t.speaker)).collect(),
    ))
}
