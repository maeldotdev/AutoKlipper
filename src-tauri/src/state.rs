use rusqlite::Connection;
use std::sync::{Arc, Mutex, MutexGuard};
use tracing_appender::non_blocking::WorkerGuard;

use crate::error::{AppError, AppResult};
use crate::live_commands::LiveManager;
use crate::media::queue::Queue;
use crate::paths::AppPaths;

pub struct AppState {
    db: Mutex<Connection>,
    pub paths: AppPaths,
    pub queue: Arc<Queue>,
    pub live: Arc<LiveManager>,
    /// Keeps the log writer alive for the whole run.
    _log_guard: WorkerGuard,
}

impl AppState {
    pub fn new(db: Connection, paths: AppPaths, log_guard: WorkerGuard) -> Self {
        Self { db: Mutex::new(db), paths, queue: Arc::new(Queue::default()), live: Arc::new(LiveManager::default()), _log_guard: log_guard }
    }

    pub fn db(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.db.lock().map_err(|_| AppError::Internal("database lock was poisoned".into()))
    }
}
