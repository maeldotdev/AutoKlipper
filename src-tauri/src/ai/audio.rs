use std::path::Path;

use crate::error::{invalid, AppResult};

pub const WINDOW_SEC: f64 = 0.5;

/// Loudness (RMS, in dB) of every half second of a 16-bit mono PCM WAV file.
pub fn loudness(path: &Path) -> AppResult<Vec<f32>> {
    let bytes = std::fs::read(path)?;
    parse(&bytes)
}

fn parse(b: &[u8]) -> AppResult<Vec<f32>> {
    if b.len() < 44 || &b[0..4] != b"RIFF" || &b[8..12] != b"WAVE" {
        return invalid("The extracted audio is not a WAV file.");
    }
    let (mut rate, mut data): (u32, Option<&[u8]>) = (0, None);
    let mut i = 12;
    while i + 8 <= b.len() {
        let id = &b[i..i + 4];
        let len = u32::from_le_bytes(b[i + 4..i + 8].try_into().unwrap()) as usize;
        let body = &b[i + 8..(i + 8).saturating_add(len).min(b.len())];
        if id == b"fmt " && body.len() >= 16 {
            let channels = u16::from_le_bytes(body[2..4].try_into().unwrap());
            let bits = u16::from_le_bytes(body[14..16].try_into().unwrap());
            if channels != 1 || bits != 16 {
                return invalid("Expected 16-bit mono audio.");
            }
            rate = u32::from_le_bytes(body[4..8].try_into().unwrap());
        } else if id == b"data" {
            data = Some(body);
        }
        i += 8 + len + (len & 1);
    }
    let Some(data) = data.filter(|_| rate > 0) else {
        return invalid("The audio file has no sound data.");
    };
    let per_window = (rate as f64 * WINDOW_SEC) as usize * 2;
    Ok(data
        .chunks(per_window.max(2))
        .map(|chunk| {
            let (sum, n) = chunk.chunks_exact(2).fold((0f64, 0u64), |(s, n), p| {
                let v = i16::from_le_bytes([p[0], p[1]]) as f64 / 32768.0;
                (s + v * v, n + 1)
            });
            let rms = if n > 0 { (sum / n as f64).sqrt() } else { 0.0 };
            (20.0 * rms.max(1e-5).log10()) as f32
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(samples: &[i16], rate: u32) -> Vec<u8> {
        let data: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut b = b"RIFF".to_vec();
        b.extend((36 + data.len() as u32).to_le_bytes());
        b.extend(b"WAVEfmt ");
        b.extend(16u32.to_le_bytes());
        b.extend(1u16.to_le_bytes());
        b.extend(1u16.to_le_bytes());
        b.extend(rate.to_le_bytes());
        b.extend((rate * 2).to_le_bytes());
        b.extend(2u16.to_le_bytes());
        b.extend(16u16.to_le_bytes());
        b.extend(b"data");
        b.extend((data.len() as u32).to_le_bytes());
        b.extend(data);
        b
    }

    #[test]
    fn loud_half_seconds_read_louder_than_quiet_ones() {
        let mut s = vec![200i16; 500]; // 0.5 s at 1 kHz: quiet
        s.extend(vec![16000i16; 500]); // loud
        let l = parse(&wav(&s, 1000)).unwrap();
        assert_eq!(l.len(), 2);
        assert!(l[1] - l[0] > 30.0, "{l:?}");
    }

    #[test]
    fn rejects_non_wav_input() {
        assert!(parse(b"not a wav at all, definitely not, no way, nope nope nope").is_err());
        assert!(parse(&[]).is_err());
    }
}
