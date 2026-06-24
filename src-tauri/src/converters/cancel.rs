use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct JobCancelState {
    token: Option<CancellationToken>,
    cancelled: bool,
}

static JOBS: OnceLock<Mutex<HashMap<String, JobCancelState>>> = OnceLock::new();

fn jobs() -> &'static Mutex<HashMap<String, JobCancelState>> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub struct JobGuard {
    job_id: String,
}

impl Drop for JobGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = jobs().lock() {
            map.remove(&self.job_id);
        }
    }
}

pub fn job_guard(job_id: &str) -> JobGuard {
    if let Ok(mut map) = jobs().lock() {
        map.entry(job_id.to_string()).or_default();
    }
    JobGuard {
        job_id: job_id.to_string(),
    }
}

pub fn register_job(job_id: &str) -> CancellationToken {
    let token = CancellationToken::new();
    if let Ok(mut map) = jobs().lock() {
        let state = map.entry(job_id.to_string()).or_default();
        if state.cancelled {
            token.cancel();
        }
        state.token = Some(token.clone());
    }
    token
}

pub fn unregister_job(job_id: &str) {
    if let Ok(mut map) = jobs().lock() {
        if let Some(state) = map.get_mut(job_id) {
            state.token = None;
        }
    }
}

pub fn cancel_job(job_id: &str) -> bool {
    let Ok(mut map) = jobs().lock() else {
        return false;
    };
    let state = map.entry(job_id.to_string()).or_default();
    state.cancelled = true;
    if let Some(token) = &state.token {
        token.cancel();
    }
    true
}
