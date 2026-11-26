//! Cutting pauses and filler words out of a clip. Times in `Clip::cuts` are seconds in the source;
//! the export works on times measured from the start of the clip.
use serde::Serialize;

use crate::ai::transcript::{Segment, Word};

/// A pause this long (or longer) between words is cut.
const PAUSE: f64 = 0.6;
/// Breathing room left on each side of a cut pause.
const PAD: f64 = 0.15;
const FILLERS: [&str; 8] = ["um", "umm", "uh", "uhh", "erm", "er", "hmm", "mm"];

pub type Cut = [f64; 2];

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub cuts: Vec<Cut>,
    pub pauses: usize,
    pub fillers: usize,
    pub seconds: f64,
}

fn is_filler(w: &Word) -> bool {
    let t: String = w.text.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase();
    FILLERS.contains(&t.as_str())
}

/// Join cuts that overlap or touch.
fn merged(mut cuts: Vec<Cut>) -> Vec<Cut> {
    cuts.retain(|c| c[1] - c[0] > 0.05);
    cuts.sort_by(|a, b| a[0].total_cmp(&b[0]));
    let mut out: Vec<Cut> = Vec::new();
    for c in cuts {
        match out.last_mut() {
            Some(last) if c[0] <= last[1] + 0.01 => last[1] = last[1].max(c[1]),
            _ => out.push(c),
        }
    }
    out
}

/// What could be removed from a clip running from `start` to `end`. Segments use source times.
pub fn detect(segments: &[Segment], start: f64, end: f64) -> Found {
    let words: Vec<&Word> = segments.iter().flat_map(|s| &s.words).filter(|w| w.end > start && w.start < end).collect();
    let kept: Vec<&&Word> = words.iter().filter(|w| !is_filler(w)).collect();
    let mut cuts = Vec::new();
    let mut pauses = 0;
    // Without any words there is nothing to judge silence by, so nothing is cut.
    if let (Some(first), Some(last)) = (kept.first(), kept.last()) {
        let mut gap = |from: f64, to: f64, a: f64, b: f64| {
            if to - from >= PAUSE {
                cuts.push([a, b]);
                pauses += 1;
            }
        };
        gap(start, first.start, start, first.start - PAD);
        for pair in kept.windows(2) {
            gap(pair[0].end, pair[1].start, pair[0].end + PAD, pair[1].start - PAD);
        }
        gap(last.end, end, last.end + PAD, end);
    }
    let fillers: Vec<&&Word> = words.iter().filter(|w| is_filler(w)).collect();
    cuts.extend(fillers.iter().map(|w| [w.start.max(start), w.end.min(end)]));
    let cuts = merged(cuts);
    let seconds = cuts.iter().map(|c| c[1] - c[0]).sum();
    Found { fillers: fillers.len(), pauses, seconds, cuts }
}

/// The cuts that fall inside the clip, measured from its start.
pub fn relative(cuts: &[Cut], start: f64, end: f64) -> Vec<Cut> {
    merged(cuts.iter().map(|c| [c[0].max(start) - start, c[1].min(end) - start]).collect())
}

/// Where a moment lands once the cuts before it are gone.
pub fn remap(rel: &[Cut], t: f64) -> f64 {
    t - rel.iter().map(|c| (t.min(c[1]) - c[0]).max(0.0)).sum::<f64>()
}

/// Caption words on the shortened timeline. Words that were cut disappear.
pub fn apply_words(segments: &[Segment], rel: &[Cut]) -> Vec<Segment> {
    let cut_away = |w: &Word| {
        let middle = (w.start + w.end) / 2.0;
        rel.iter().any(|c| middle >= c[0] && middle < c[1])
    };
    segments
        .iter()
        .filter_map(|s| {
            let words: Vec<Word> = s
                .words
                .iter()
                .filter(|w| !cut_away(w))
                .map(|w| Word { start: remap(rel, w.start), end: remap(rel, w.end), ..w.clone() })
                .collect();
            let (first, last) = (words.first()?.start, words.last()?.end);
            Some(Segment { start: first, end: last, words, ..s.clone() })
        })
        .collect()
}

/// FFmpeg `select` expression that is true for the parts to keep.
pub fn keep_expr(rel: &[Cut]) -> String {
    let parts: Vec<String> = rel.iter().map(|c| format!("between(t,{:.3},{:.3})", c[0], c[1])).collect();
    format!("not({})", parts.join("+"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(words: &[(&str, f64, f64)]) -> Segment {
        let words: Vec<Word> = words.iter().enumerate().map(|(i, w)| Word { id: format!("w{i}"), text: w.0.into(), start: w.1, end: w.2, keyword: None }).collect();
        Segment { id: "s".into(), start: words[0].start, end: words[words.len() - 1].end, words, speaker: None }
    }

    #[test]
    fn pauses_and_fillers_are_found() {
        // Clip 10..20: a late start, a filler, a long pause in the middle, a quiet tail.
        let s = [seg(&[("Hello", 11.0, 11.4), ("Um,", 11.5, 11.8), ("there", 11.9, 12.2), ("friend", 15.0, 15.5)])];
        let f = detect(&s, 10.0, 20.0);
        assert_eq!((f.pauses, f.fillers), (3, 1));
        let want = [[10.0, 10.85], [11.5, 11.8], [12.35, 14.85], [15.65, 20.0]];
        assert_eq!(f.cuts.len(), want.len(), "{:?}", f.cuts);
        for (got, want) in f.cuts.iter().zip(want) {
            assert!((got[0] - want[0]).abs() < 1e-9 && (got[1] - want[1]).abs() < 1e-9, "{got:?} {want:?}");
        }
        assert_eq!(detect(&[], 0.0, 30.0).cuts, Vec::<Cut>::new(), "no words, nothing cut");
    }

    #[test]
    fn times_move_up_and_cut_words_leave() {
        let rel = relative(&[[11.0, 12.0], [14.0, 15.0], [90.0, 91.0]], 10.0, 20.0);
        assert_eq!(rel, vec![[1.0, 2.0], [4.0, 5.0]]);
        assert_eq!((remap(&rel, 0.5), remap(&rel, 3.0), remap(&rel, 6.0), remap(&rel, 1.5)), (0.5, 2.0, 4.0, 1.0));
        let out = apply_words(&[seg(&[("a", 0.2, 0.6), ("um", 1.2, 1.6), ("b", 3.0, 3.4)])], &rel);
        assert_eq!(out[0].words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert!((out[0].words[1].start - 2.0).abs() < 1e-9);
        assert_eq!(keep_expr(&rel), "not(between(t,1.000,2.000)+between(t,4.000,5.000))");
    }
}
