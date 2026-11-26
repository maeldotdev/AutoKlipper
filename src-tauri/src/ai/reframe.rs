//! Turning raw face positions into a calm camera path, and a camera path into an FFmpeg crop expression.
//! `src/lib/reframe.ts` mirrors `crop_p` and the interpolation so the preview matches the export.

/// A point of the path: absolute time in the source video, and the face centre as a fraction of its width.
pub type Point = [f64; 2];

const DEADZONE: f64 = 0.04;
/// Fastest pan, in source widths per second.
const MAX_SPEED: f64 = 0.35;
const MAX_POINTS: usize = 60;

fn median5(v: &[f64]) -> Vec<f64> {
    (0..v.len())
        .map(|i| {
            let mut w: Vec<f64> = v[i.saturating_sub(2)..(i + 3).min(v.len())].to_vec();
            w.sort_by(f64::total_cmp);
            w[w.len() / 2]
        })
        .collect()
}

/// Ramer-Douglas-Peucker on (time, position): keep only the points that bend the path.
fn simplify(p: &[Point], eps: f64) -> Vec<Point> {
    if p.len() < 3 {
        return p.to_vec();
    }
    let (a, b) = (p[0], p[p.len() - 1]);
    let (mut far, mut dist) = (0, 0.0);
    for (i, q) in p.iter().enumerate().skip(1).take(p.len() - 2) {
        let t = if b[0] > a[0] { (q[0] - a[0]) / (b[0] - a[0]) } else { 0.0 };
        let d = (q[1] - (a[1] + (b[1] - a[1]) * t)).abs();
        if d > dist {
            (far, dist) = (i, d);
        }
    }
    if dist <= eps {
        return vec![a, b];
    }
    let mut left = simplify(&p[..=far], eps);
    left.pop();
    left.extend(simplify(&p[far..], eps));
    left
}

/// Gaps hold the last position, jitter is removed, small movements are ignored and pans are limited.
/// Returns an empty path when no face was ever found.
pub fn smooth(samples: &[(f64, Option<f64>)]) -> Vec<Point> {
    let Some(first) = samples.iter().find_map(|s| s.1) else { return vec![] };
    let mut last = first;
    let filled: Vec<f64> = samples
        .iter()
        .map(|s| {
            last = s.1.unwrap_or(last);
            last
        })
        .collect();
    let calm = median5(&filled);
    let mut pos = calm[0];
    let mut prev_t = samples[0].0;
    let mut chasing = false;
    let path: Vec<Point> = samples
        .iter()
        .zip(&calm)
        .map(|(s, &target)| {
            let dt = (s.0 - prev_t).max(0.0);
            prev_t = s.0;
            let gap = target - pos;
            // Start moving once the face leaves the dead zone, stop when it is nearly centred again.
            if gap.abs() > DEADZONE {
                chasing = true;
            } else if gap.abs() < DEADZONE / 4.0 {
                chasing = false;
            }
            if chasing {
                pos += gap.clamp(-MAX_SPEED * dt, MAX_SPEED * dt);
            }
            [s.0, (pos.clamp(0.0, 1.0) * 10_000.0).round() / 10_000.0]
        })
        .collect();
    let mut eps = 0.008;
    let mut out = simplify(&path, eps);
    while out.len() > MAX_POINTS {
        eps *= 1.5;
        out = simplify(&path, eps);
    }
    out
}

/// Where to put the crop window (0 left, 1 right) so that `cx` sits in its middle.
pub fn crop_p(cx: f64, src_w: f64, src_h: f64, target_ratio: f64, zoom: f64) -> f64 {
    let window = src_w.min(src_h * target_ratio) / zoom.max(1.0);
    let room = src_w - window;
    if room <= 0.5 {
        return 0.5;
    }
    (cx * src_w - window / 2.0).clamp(0.0, room) / room
}

/// An FFmpeg expression in `t` (seconds from the clip start) giving the crop position 0..1.
pub fn expression(path: &[Point], clip_start: f64, src_w: u32, src_h: u32, target_ratio: f64, zoom: f64) -> Option<String> {
    let keys: Vec<(f64, f64)> = path.iter().map(|k| (k[0] - clip_start, crop_p(k[1], src_w as f64, src_h as f64, target_ratio, zoom))).collect();
    let last = keys.last()?;
    let mut expr = format!("{:.4}", last.1);
    for w in keys.windows(2).rev() {
        let ((t0, p0), (t1, p1)) = (w[0], w[1]);
        let span = (t1 - t0).max(0.001);
        expr = format!("if(lt(t,{t1:.3}),{p0:.4}+{d:.4}*clip((t-{t0:.3})/{span:.3},0,1),{expr})", d = p1 - p0);
    }
    Some(expr)
}

/// A webcam overlay is roughly three faces wide and two and a half tall, with the face a bit above
/// its middle. Uses the typical (median) face so a stray detection does not move the box.
pub fn camera_box(faces: &[[f64; 4]]) -> Option<[f64; 4]> {
    if faces.is_empty() {
        return None;
    }
    let median = |i: usize| {
        let mut v: Vec<f64> = faces.iter().map(|f| f[i]).collect();
        v.sort_by(f64::total_cmp);
        v[v.len() / 2]
    };
    let (cx, cy, fw, fh) = (median(0), median(1), median(2), median(3));
    let (w, h) = ((fw * 3.0).clamp(0.08, 1.0), (fh * 2.4).clamp(0.08, 1.0));
    let x = (cx - w / 2.0).clamp(0.0, 1.0 - w);
    let y = (cy - h * 0.45).clamp(0.0, 1.0 - h);
    Some([x, y, w, h])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_face_gives_no_path() {
        assert!(smooth(&[(0.0, None), (0.2, None)]).is_empty());
        assert!(smooth(&[]).is_empty());
    }

    #[test]
    fn jitter_and_a_single_wrong_detection_are_ignored() {
        let s: Vec<(f64, Option<f64>)> = (0..50).map(|i| (i as f64 * 0.2, Some(if i == 20 { 0.9 } else { 0.4 + if i % 2 == 0 { 0.01 } else { -0.01 } }))).collect();
        let p = smooth(&s);
        assert_eq!(p.len(), 2, "a still camera needs only two points: {p:?}");
        assert!((p[0][1] - 0.41).abs() < 0.02 && (p[1][1] - p[0][1]).abs() < 0.001);
    }

    #[test]
    fn a_moving_face_is_followed_smoothly_and_gaps_hold() {
        let s: Vec<(f64, Option<f64>)> = (0..=50).map(|i| {
            let t = i as f64 * 0.2;
            (t, if (20..25).contains(&i) { None } else { Some(0.2 + 0.06 * t) })
        }).collect();
        let p = smooth(&s);
        assert!(p.len() <= MAX_POINTS && p.len() >= 2);
        assert!(p.windows(2).all(|w| w[1][1] >= w[0][1] - 0.001), "never jumps back: {p:?}");
        assert!(p.windows(2).all(|w| (w[1][1] - w[0][1]) / (w[1][0] - w[0][0]) <= MAX_SPEED + 0.01), "pan speed limited");
        assert!((p.last().unwrap()[1] - 0.8).abs() < 0.07, "{p:?}");
    }

    #[test]
    fn a_sudden_cut_pans_at_limited_speed() {
        let s: Vec<(f64, Option<f64>)> = (0..40).map(|i| (i as f64 * 0.2, Some(if i < 10 { 0.2 } else { 0.8 }))).collect();
        let p = smooth(&s);
        assert!((p.last().unwrap()[1] - 0.8).abs() < 0.05);
        assert!(p.windows(2).all(|w| (w[1][1] - w[0][1]) / (w[1][0] - w[0][0]).max(0.001) <= MAX_SPEED + 0.02), "{p:?}");
    }

    #[test]
    fn crop_position_centres_the_face_and_stays_inside() {
        // 1280x720 to 9:16: the window is 405 px wide, 875 px of room.
        assert!((crop_p(0.5, 1280.0, 720.0, 9.0 / 16.0, 1.0) - 0.5).abs() < 0.001);
        assert_eq!(crop_p(0.0, 1280.0, 720.0, 9.0 / 16.0, 1.0), 0.0);
        assert_eq!(crop_p(1.0, 1280.0, 720.0, 9.0 / 16.0, 1.0), 1.0);
        let p = crop_p(0.3, 1280.0, 720.0, 9.0 / 16.0, 1.0);
        assert!((p * 875.0 + 202.5 - 384.0).abs() < 0.5, "{p}");
        assert_eq!(crop_p(0.2, 720.0, 1280.0, 9.0 / 16.0, 1.0), 0.5, "nothing to slide");
    }

    #[test]
    fn expressions_are_relative_to_the_clip_start() {
        let e = expression(&[[10.0, 0.3], [12.0, 0.7]], 10.0, 1280, 720, 9.0 / 16.0, 1.0).unwrap();
        assert!(e.starts_with("if(lt(t,2.000),"), "{e}");
        assert!(e.contains("(t-0.000)/2.000"), "{e}");
        assert!(expression(&[], 0.0, 1, 1, 1.0, 1.0).is_none());
        assert_eq!(expression(&[[5.0, 0.5]], 0.0, 1280, 720, 0.5625, 1.0).unwrap(), "0.5000");
    }

    #[test]
    fn camera_box_surrounds_the_usual_face_and_stays_inside() {
        use super::camera_box;
        assert_eq!(camera_box(&[]), None);
        // A small face near the bottom left corner, with one stray detection.
        let faces = [[0.1, 0.85, 0.06, 0.12], [0.1, 0.85, 0.06, 0.12], [0.8, 0.2, 0.3, 0.5]];
        let [x, y, w, h] = camera_box(&faces).unwrap();
        assert!(x >= 0.0 && y >= 0.0 && x + w <= 1.0 && y + h <= 1.0);
        assert!(x < 0.1 && x + w > 0.1 && y < 0.85 && y + h > 0.85, "{x} {y} {w} {h}");
        assert!((w - 0.18).abs() < 1e-9 && (h - 0.288).abs() < 1e-9);
    }
}
