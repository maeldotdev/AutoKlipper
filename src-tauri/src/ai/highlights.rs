//! Highlight detection without a language model: it scores windows of the transcript on loudness,
//! reaction words, questions, insight phrases, humour, story cues and speaking speed. It is a heuristic,
//! and each clip carries the reason it was picked so the user can judge it.
use serde::{Deserialize, Serialize};

use super::audio::WINDOW_SEC;
use super::transcript::Segment;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    pub min_len: f64,
    pub max_len: f64,
    pub count: usize,
    /// Labels chosen in the UI: "Funny moments", "Big reactions", "Key insights",
    /// "Questions and answers", "High energy", "Story beats". Empty means all equally.
    pub moments: Vec<String>,
    /// 10..=100. Higher keeps weaker candidates.
    pub sensitivity: u32,
}

impl Default for Options {
    fn default() -> Self {
        Options { min_len: 20.0, max_len: 60.0, count: 6, moments: vec![], sensitivity: 60 }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub start: f64,
    pub end: f64,
    pub score: u32,
    pub reason: String,
    pub title: String,
}

const REACTION: &[&str] = &["oh my", "wow", "no way", "insane", "incredible", "unbelievable", "crazy", "cannot believe", "can't believe", "what the", "amazing", "holy", "did you see"];
const INSIGHT: &[&str] = &["secret", "mistake", "the thing is", "here is", "here's", "lesson", "learned", "important", "nobody tells", "the key", "the truth", "tip", "never ", "always "];
const HUMOR: &[&str] = &["haha", "lol", "funny", "joke", "laugh", "hilarious"];
const STORY: &[&str] = &["when i", "so i", "one day", "remember", "first time", "years ago", "i was", "and then"];
const CUE_WORDS: &[&str] = &["incredible", "insane", "unbelievable", "secret", "mistake", "never", "always", "wow", "crazy", "amazing", "important"];

#[derive(Default, Clone, Copy)]
struct Features {
    energy: f64,
    reaction: f64,
    insight: f64,
    humor: f64,
    story: f64,
    question: f64,
    exclaim: f64,
    speed: f64,
}

fn count(text: &str, needles: &[&str]) -> f64 {
    needles.iter().map(|n| text.matches(n).count()).sum::<usize>() as f64
}

fn median(mut v: Vec<f32>) -> f32 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(f32::total_cmp);
    v[v.len() / 2]
}

fn features(segs: &[Segment], start: f64, end: f64, loud: &[f32], base: f32) -> Features {
    let dur = (end - start).max(1.0);
    let text = segs.iter().map(Segment::text).collect::<Vec<_>>().join(" ").to_lowercase();
    let words: usize = segs.iter().map(|s| s.words.len()).sum();
    // Loudest fifth of the window, compared with the whole video.
    let a = ((start / WINDOW_SEC) as usize).min(loud.len());
    let b = ((end / WINDOW_SEC).ceil() as usize).min(loud.len()).max(a);
    let mut w: Vec<f32> = loud[a..b].to_vec();
    w.sort_by(|x, y| y.total_cmp(x));
    let top = &w[..w.len().div_ceil(5).min(w.len())];
    let peak = if top.is_empty() { base } else { top.iter().sum::<f32>() / top.len() as f32 };
    let per = |x: f64| (x * 15.0 / dur).min(1.0); // "per 15 seconds", capped
    Features {
        energy: ((peak - base) as f64 / 12.0).clamp(0.0, 1.0),
        reaction: per(count(&text, REACTION)),
        insight: per(count(&text, INSIGHT)),
        humor: per(count(&text, HUMOR)),
        story: per(count(&text, STORY) * 0.7),
        question: per(text.matches('?').count() as f64 * 0.7),
        exclaim: per(text.matches('!').count() as f64 * 0.7),
        speed: ((words as f64 / dur - 2.0) / 2.0).clamp(0.0, 1.0),
    }
}

fn score(f: Features, moments: &[String]) -> (f64, String) {
    let on = |label: &str| if moments.iter().any(|m| m == label) { 2.0 } else { 1.0 };
    let parts = [
        ("Loud moment", f.energy * 28.0 * on("High energy")),
        ("Strong reaction", (f.reaction * 26.0 + f.exclaim * 8.0) * on("Big reactions")),
        ("Insight", f.insight * 24.0 * on("Key insights")),
        ("Question", f.question * 16.0 * on("Questions and answers")),
        ("Humour", f.humor * 22.0 * on("Funny moments")),
        ("Story", f.story * 18.0 * on("Story beats")),
        ("Fast talking", f.speed * 10.0),
    ];
    let total: f64 = parts.iter().map(|p| p.1).sum();
    let mut top: Vec<_> = parts.iter().filter(|p| p.1 >= 4.0).collect();
    top.sort_by(|a, b| b.1.total_cmp(&a.1));
    let reason = top.iter().take(2).map(|p| p.0).collect::<Vec<_>>().join(" and ").to_string();
    // 40 is the floor for "speech with nothing special"; the signals lift it towards 99.
    ((40.0 + total * 0.75).min(99.0), if reason.is_empty() { "Steady speech".into() } else { reason })
}

fn title_for(segs: &[Segment]) -> String {
    let best = segs
        .iter()
        .max_by_key(|s| {
            let t = s.text().to_lowercase();
            (count(&t, REACTION) + count(&t, INSIGHT) * 1.5 + t.matches('?').count() as f64) as u64
        })
        .filter(|s| {
            let t = s.text().to_lowercase();
            count(&t, REACTION) + count(&t, INSIGHT) + t.matches('?').count() as f64 > 0.0
        })
        .or(segs.first());
    let words: Vec<String> = best.map(|s| s.words.iter().take(7).map(|w| w.text.clone()).collect()).unwrap_or_default();
    let t = words.join(" ").trim_end_matches([',', '.', ';', ':']).to_string();
    if t.is_empty() { "Untitled moment".into() } else { t }
}

/// Candidate windows start at a sentence and end at a later sentence end inside the length range.
fn candidates(segs: &[Segment], o: &Options, total: f64) -> Vec<(usize, usize, f64, f64)> {
    let mut out = Vec::new();
    for i in 0..segs.len() {
        let start = (segs[i].start - 0.25).max(0.0);
        let mut best: Option<(usize, f64)> = None;
        for j in i..segs.len() {
            let end = (segs[j].end + 0.35).min(total.max(segs[j].end));
            let len = end - start;
            if len > o.max_len {
                break;
            }
            if len >= o.min_len {
                out.push((i, j, start, end));
            }
            best = Some((j, end));
        }
        // Nothing reaches the minimum from here on (short video): keep the longest run, once.
        if out.is_empty() && i == 0 {
            if let Some((j, end)) = best {
                out.push((0, j, start, end));
            }
        }
    }
    out
}

pub fn find(segs: &[Segment], loud: &[f32], total: f64, o: &Options) -> Vec<Highlight> {
    if segs.is_empty() || o.count == 0 {
        return vec![];
    }
    let base = median(loud.to_vec());
    let mut scored: Vec<Highlight> = candidates(segs, o, total)
        .into_iter()
        .map(|(i, j, start, end)| {
            let window = &segs[i..=j];
            let (s, reason) = score(features(window, start, end, loud, base), &o.moments);
            Highlight { start: (start * 10.0).round() / 10.0, end: (end * 10.0).round() / 10.0, score: s.round() as u32, reason, title: title_for(window) }
        })
        .collect();
    // Best first; among equals prefer the shorter, tighter clip.
    scored.sort_by(|a, b| b.score.cmp(&a.score).then((a.end - a.start).total_cmp(&(b.end - b.start))));

    let floor = 40 + (100u32.saturating_sub(o.sensitivity.clamp(10, 100))) / 5;
    let mut picked: Vec<Highlight> = Vec::new();
    for h in scored {
        let overlaps = picked.iter().any(|p| {
            let overlap = (h.end.min(p.end) - h.start.max(p.start)).max(0.0);
            overlap > 0.2 * (h.end - h.start).min(p.end - p.start)
        });
        if !overlaps && (picked.is_empty() || h.score >= floor) {
            picked.push(h);
        }
        if picked.len() == o.count {
            break;
        }
    }
    picked.sort_by(|a, b| a.start.total_cmp(&b.start));
    picked
}

/// Words that caption presets highlight as keywords.
pub fn mark_keywords(segs: &mut [Segment]) {
    for w in segs.iter_mut().flat_map(|s| s.words.iter_mut()) {
        let clean = w.text.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
        w.keyword = CUE_WORDS.contains(&clean.as_str()).then_some(true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::transcript::tests::make;

    fn sample() -> (Vec<Segment>, Vec<f32>) {
        let segs = make(&[
            (0.0, "welcome back everyone today we talk about pricing small tools."),
            (8.0, "there are a few things to consider here and none are exciting."),
            (16.0, "oh my did you see that? that was the most incredible thing!"),
            (24.0, "no way that is insane i cannot believe it worked!"),
            (32.0, "okay let us go back to the spreadsheet for last month."),
            (40.0, "the numbers look the same as before and the rows are fine."),
        ]);
        // 50 s of half-second windows: quiet except 16 s to 29 s.
        let loud = (0..100).map(|i| if (32..58).contains(&i) { -10.0 } else { -30.0 }).collect();
        (segs, loud)
    }

    fn opts(count: usize) -> Options {
        Options { min_len: 7.0, max_len: 14.0, count, moments: vec![], sensitivity: 60 }
    }

    #[test]
    fn the_loud_excited_stretch_wins() {
        let (s, l) = sample();
        let h = find(&s, &l, 50.0, &opts(1));
        assert_eq!(h.len(), 1);
        assert!(h[0].start >= 15.0 && h[0].start <= 17.0, "{h:?}");
        assert!(h[0].score > 60, "{h:?}");
        assert!(h[0].reason.contains("Loud moment") || h[0].reason.contains("Strong reaction"), "{}", h[0].reason);
        assert!(!h[0].title.is_empty());
    }

    #[test]
    fn picks_do_not_overlap_and_respect_the_length_range() {
        let (s, l) = sample();
        let h = find(&s, &l, 50.0, &Options { sensitivity: 100, ..opts(4) });
        assert!(h.len() > 1);
        for w in h.windows(2) {
            assert!(w[1].start >= w[0].end - 0.2 * 14.0, "{w:?}");
        }
        assert!(h.iter().all(|c| c.end - c.start <= 14.0 + 0.1), "{h:?}");
        assert!(h.windows(2).all(|w| w[0].start < w[1].start), "returned in time order");
    }

    #[test]
    fn lower_sensitivity_keeps_fewer_clips() {
        let (s, l) = sample();
        let strict = find(&s, &l, 50.0, &Options { sensitivity: 10, ..opts(6) });
        let loose = find(&s, &l, 50.0, &Options { sensitivity: 100, ..opts(6) });
        assert!(strict.len() <= loose.len());
        assert!(!strict.is_empty(), "always at least the best one");
    }

    #[test]
    fn a_preference_changes_the_ranking() {
        let segs = make(&[(0.0, "here is the secret and the biggest mistake nobody tells you."), (20.0, "what would you do? what should you charge? why would they pay?")]);
        let o = |m: &str| Options { min_len: 3.0, max_len: 8.0, count: 1, moments: vec![m.into()], sensitivity: 100 };
        assert_eq!(find(&segs, &[], 30.0, &o("Key insights"))[0].start, 0.0);
        assert!(find(&segs, &[], 30.0, &o("Questions and answers"))[0].start > 10.0);
    }

    #[test]
    fn short_video_still_gives_one_clip_and_silence_gives_none() {
        let s = make(&[(0.0, "just a short line.")]);
        let h = find(&s, &[], 2.0, &Options::default());
        assert_eq!(h.len(), 1);
        assert!(find(&[], &[], 100.0, &Options::default()).is_empty());
    }

    #[test]
    fn keywords_are_marked_for_captions() {
        let mut s = make(&[(0.0, "That was incredible, really!")]);
        mark_keywords(&mut s);
        let k: Vec<_> = s[0].words.iter().filter(|w| w.keyword == Some(true)).map(|w| w.text.as_str()).collect();
        assert_eq!(k, ["incredible,"]);
    }
}
