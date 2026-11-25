use std::path::Path;
use tracing_appender::non_blocking::WorkerGuard;

/// Daily-rolling log file in the logs folder. The returned guard must stay alive
/// for the whole run or buffered lines are lost on exit.
pub fn init(dir: &Path) -> WorkerGuard {
    let appender = tracing_appender::rolling::daily(dir, "clipit.log");
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let _ = tracing_subscriber::fmt()
        .with_writer(writer)
        .with_ansi(false)
        .with_max_level(tracing::Level::INFO)
        .try_init();
    guard
}
