use std::collections::{HashSet, VecDeque};

/// Pure queue logic: first in, first out, at most `limit` running at once.
/// Kept free of threads and Tauri so it can be tested on its own.
pub struct Scheduler<T> {
    pending: VecDeque<(String, T)>,
    running: HashSet<String>,
}

impl<T> Default for Scheduler<T> {
    fn default() -> Self {
        Self { pending: VecDeque::new(), running: HashSet::new() }
    }
}

impl<T> Scheduler<T> {
    pub fn enqueue(&mut self, id: String, task: T) {
        self.pending.push_back((id, task));
    }

    /// Move as many pending tasks to running as free slots allow.
    pub fn take_ready(&mut self, limit: usize) -> Vec<(String, T)> {
        let mut out = Vec::new();
        while self.running.len() < limit.max(1) {
            let Some((id, t)) = self.pending.pop_front() else { break };
            self.running.insert(id.clone());
            out.push((id, t));
        }
        out
    }

    pub fn finish(&mut self, id: &str) {
        self.running.remove(id);
    }

    /// Remove a task that has not started. Returns it if it was waiting.
    pub fn cancel_pending(&mut self, id: &str) -> Option<T> {
        let i = self.pending.iter().position(|(p, _)| p == id)?;
        self.pending.remove(i).map(|(_, t)| t)
    }

    #[cfg(test)]
    pub fn is_running(&self, id: &str) -> bool {
        self.running.contains(id)
    }

    #[cfg(test)]
    pub fn counts(&self) -> (usize, usize) {
        (self.running.len(), self.pending.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn respects_the_concurrency_limit_and_order() {
        let mut s = Scheduler::default();
        for i in 1..=4 {
            s.enqueue(format!("j{i}"), i);
        }
        let first: Vec<_> = s.take_ready(2).into_iter().map(|(id, _)| id).collect();
        assert_eq!(first, ["j1", "j2"]);
        assert!(s.take_ready(2).is_empty(), "no free slot");
        s.finish("j1");
        let next: Vec<_> = s.take_ready(2).into_iter().map(|(id, _)| id).collect();
        assert_eq!(next, ["j3"]);
        assert_eq!(s.counts(), (2, 1));
    }

    #[test]
    fn limit_can_grow_between_calls_and_zero_still_runs_one() {
        let mut s = Scheduler::default();
        s.enqueue("a".into(), ());
        s.enqueue("b".into(), ());
        assert_eq!(s.take_ready(0).len(), 1);
        assert_eq!(s.take_ready(3).len(), 1);
    }

    #[test]
    fn only_waiting_tasks_can_be_cancelled_here() {
        let mut s = Scheduler::default();
        s.enqueue("a".into(), 1);
        s.enqueue("b".into(), 2);
        s.take_ready(1);
        assert!(s.is_running("a"));
        assert_eq!(s.cancel_pending("a"), None, "running jobs are stopped through the process");
        assert_eq!(s.cancel_pending("b"), Some(2));
        assert_eq!(s.counts(), (1, 0));
    }
}
