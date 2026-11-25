use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{invalid, AppResult};

/// Same shape as `CaptionSegment` / `CaptionWord` on the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Word {
    pub id: String,
    pub text: String,
    pub start: f64,
    pub end: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyword: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Segment {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub words: Vec<Word>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<i64>,
}

impl Segment {
    pub fn text(&self) -> String {
        self.words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ")
    }
}

/// Long Whisper segments become caption-sized ones: split after sentence ends, or at 12 words.
fn split(words: Vec<Word>) -> Vec<Vec<Word>> {
    let mut out = Vec::new();
    let mut cur: Vec<Word> = Vec::new();
    for w in words {
        let ends = w.text.ends_with(['.', '?', '!']);
        cur.push(w);
        if ends || cur.len() >= 12 {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Parse the helper's result file.
pub fn from_helper(json: &Value) -> AppResult<Vec<Segment>> {
    let Some(list) = json["segments"].as_array() else {
        return invalid("The speech recogniser returned no transcript data.");
    };
    let mut out = Vec::new();
    let mut n = 0usize;
    for seg in list {
        let words: Vec<Word> = seg["words"]
            .as_array()
            .map(|ws| {
                ws.iter()
                    .filter_map(|w| {
                        let text = w["word"].as_str()?.trim();
                        let (s, e) = (w["start"].as_f64()?, w["end"].as_f64()?);
                        (!text.is_empty() && e >= s).then(|| {
                            n += 1;
                            Word { id: format!("w{n}"), text: text.to_string(), start: s, end: e, keyword: None }
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        let speaker = seg["speaker"].as_i64();
        for chunk in split(words) {
            out.push(Segment { id: format!("s{}", out.len() + 1), start: chunk[0].start, end: chunk[chunk.len() - 1].end, words: chunk, speaker });
        }
    }
    Ok(out)
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

/// The words of one clip, with times measured from the clip's start.
pub fn slice(segments: &[Segment], start: f64, end: f64) -> Vec<Segment> {
    segments
        .iter()
        .filter_map(|s| {
            let words: Vec<Word> = s
                .words
                .iter()
                .filter(|w| {
                    let mid = (w.start + w.end) / 2.0;
                    mid >= start && mid < end
                })
                .map(|w| Word { start: round2((w.start - start).max(0.0)), end: round2((w.end.min(end) - start).max(0.0)), ..w.clone() })
                .collect();
            (!words.is_empty()).then(|| Segment { id: s.id.clone(), start: words[0].start, end: words[words.len() - 1].end, words, speaker: s.speaker })
        })
        .collect()
}

pub fn srt_time(sec: f64) -> String {
    let ms = (sec.max(0.0) * 1000.0).round() as u64;
    format!("{:02}:{:02}:{:02},{:03}", ms / 3_600_000, ms % 3_600_000 / 60_000, ms % 60_000 / 1000, ms % 1000)
}

pub fn to_srt(segments: &[Segment]) -> String {
    segments
        .iter()
        .filter(|s| !s.words.is_empty())
        .enumerate()
        .map(|(i, s)| format!("{}\n{} --> {}\n{}\n", i + 1, srt_time(s.start), srt_time(s.end), s.text()))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;

    /// Build segments from (start, text) with 0.4 s per word.
    pub(crate) fn make(lines: &[(f64, &str)]) -> Vec<Segment> {
        let mut n = 0;
        lines
            .iter()
            .enumerate()
            .map(|(i, (start, text))| {
                let mut t = *start;
                let words: Vec<Word> = text
                    .split(' ')
                    .map(|w| {
                        n += 1;
                        let word = Word { id: format!("w{n}"), text: w.into(), start: t, end: t + 0.3, keyword: None };
                        t += 0.4;
                        word
                    })
                    .collect();
                Segment { id: format!("s{}", i + 1), start: *start, end: words.last().unwrap().end, words, speaker: None }
            })
            .collect()
    }

    #[test]
    fn helper_output_is_split_into_sentences_with_unique_ids() {
        let j = json!({"segments": [{"speaker": 1, "words": [
            {"word": " Hello", "start": 0.0, "end": 0.4}, {"word": "there.", "start": 0.4, "end": 0.8},
            {"word": "Next", "start": 1.0, "end": 1.2}, {"word": "bit", "start": 1.2, "end": 1.5},
            {"word": "", "start": 2.0, "end": 2.1}, {"word": "broken", "start": 3.0, "end": 2.0}]}]});
        let s = from_helper(&j).unwrap();
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].text(), "Hello there.");
        assert_eq!(s[1].text(), "Next bit");
        assert_eq!((s[0].speaker, s[1].speaker), (Some(1), Some(1)));
        let ids: Vec<_> = s.iter().flat_map(|x| x.words.iter().map(|w| w.id.clone())).collect();
        assert_eq!(ids, ["w1", "w2", "w3", "w4"]);
        assert!(from_helper(&json!({})).is_err());
    }

    #[test]
    fn very_long_sentences_are_cut_at_twelve_words() {
        let words: Vec<_> = (0..30).map(|i| json!({"word": format!("w{i}"), "start": i as f64, "end": i as f64 + 0.5})).collect();
        let s = from_helper(&json!({"segments": [{"words": words}]})).unwrap();
        assert_eq!(s.iter().map(|x| x.words.len()).collect::<Vec<_>>(), [12, 12, 6]);
    }

    #[test]
    fn slicing_rebases_times_and_drops_outside_words() {
        let s = make(&[(0.0, "one two three"), (10.0, "four five six")]);
        let c = slice(&s, 10.0, 20.0);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].text(), "four five six");
        assert_eq!(c[0].words[0].start, 0.0);
        assert_eq!(c[0].words[1].start, 0.4);
        assert!(slice(&s, 100.0, 110.0).is_empty());
    }

    #[test]
    fn srt_has_numbered_cues_and_comma_milliseconds() {
        let out = to_srt(&make(&[(1.5, "hello world")]));
        assert_eq!(out, "1\n00:00:01,500 --> 00:00:02,200\nhello world\n");
        assert_eq!(srt_time(3661.042), "01:01:01,042");
    }
}
