//! Burned-in captions: turns caption segments and a caption style into an ASS subtitle file for libass.
//! It follows the same paging as the live preview. Fonts are the closest ones Windows ships, and the
//! typewriter and slide-up animations are approximated, because ASS animates events, not single letters.
use serde::Deserialize;

use super::transcript::{Segment, Word};
use crate::db::models::TextPlace;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Style {
    pub font: String,
    pub size: f64,
    pub weight: u32,
    pub uppercase: bool,
    pub color: String,
    pub highlight_color: String,
    pub outline_width: f64,
    pub outline_color: String,
    pub shadow: f64,
    pub bg_enabled: bool,
    pub bg_color: String,
    pub bg_opacity: f64,
    pub letter_spacing: f64,
    pub align: String,
    pub pos_y: f64,
    /// Set when the user dragged the captions: their centre across, 0..100.
    pub pos_x: Option<f64>,
    pub max_words: usize,
    pub max_lines: usize,
    pub anim_speed: f64,
    pub animation: String,
    pub highlight: String,
}

impl Default for Style {
    fn default() -> Self {
        Style {
            font: "geist".into(), size: 60.0, weight: 900, uppercase: true, color: "#ffffff".into(), highlight_color: "#ffd84a".into(),
            outline_width: 7.0, outline_color: "#000000".into(), shadow: 4.0, bg_enabled: false, bg_color: "#0b1020".into(), bg_opacity: 0.7,
            letter_spacing: -1.0, align: "center".into(), pos_y: 70.0, pos_x: None, max_words: 3, max_lines: 2, anim_speed: 1.2,
            animation: "pop-in".into(), highlight: "keywords".into(),
        }
    }
}

/// Fixed mapping: the style value never reaches the file as a font name.
fn font_name(key: &str) -> &'static str {
    match key {
        "geist-mono" => "Consolas",
        "serif" => "Georgia",
        "impact" => "Impact",
        _ => "Segoe UI",
    }
}

/// "#rrggbb" to ASS `&HAABBGGRR` (alpha 00 is opaque). Anything else becomes white.
fn ass_color(hex: &str, opacity: f64) -> String {
    let h = hex.strip_prefix('#').filter(|h| h.len() == 6 && h.chars().all(|c| c.is_ascii_hexdigit())).unwrap_or("ffffff");
    let a = ((1.0 - opacity.clamp(0.0, 1.0)) * 255.0).round() as u8;
    format!("&H{a:02X}{}{}{}", &h[4..6], &h[2..4], &h[0..2]).to_uppercase()
}

fn time(sec: f64) -> String {
    let cs = (sec.max(0.0) * 100.0).round() as u64;
    format!("{}:{:02}:{:02}.{:02}", cs / 360_000, cs % 360_000 / 6000, cs % 6000 / 100, cs % 100)
}

/// Transcript text is untrusted for the ASS format: braces start override blocks, backslashes start tags.
fn escape(text: &str) -> String {
    text.chars().map(|c| match c { '{' => '(', '}' => ')', '\\' => '/', '\n' | '\r' => ' ', other => other }).collect()
}

fn word_text(w: &Word, s: &Style) -> String {
    let t = escape(&w.text);
    if s.uppercase { t.to_uppercase() } else { t }
}

fn lines(parts: Vec<String>, per_line: usize) -> String {
    parts.chunks(per_line.max(1)).map(|l| l.join(" ")).collect::<Vec<_>>().join("\\N")
}

struct Ctx<'a> {
    s: &'a Style,
    base: String,
    hl: String,
    pos: String,
}

fn keyword_highlight(c: &Ctx, w: &Word, active: bool) -> bool {
    match c.s.highlight.as_str() {
        "active-word" => active,
        "keywords" => w.keyword == Some(true),
        _ => c.s.animation == "keyword-emphasis" && w.keyword == Some(true),
    }
}

/// The override tags for one word while word `active` is being spoken.
fn styled(c: &Ctx, w: &Word, j: usize, active: Option<usize>) -> String {
    let s = c.s;
    let is_active = active == Some(j);
    let reveals = matches!(s.animation.as_str(), "word-reveal" | "pop-in" | "slide-up" | "typewriter");
    let mut tags = String::new();
    if reveals && active.is_some_and(|a| j > a) {
        tags.push_str("\\alpha&HFF&");
    }
    let color = if keyword_highlight(c, w, is_active) { &c.hl } else { &c.base };
    tags.push_str(&format!("\\1c{color}&"));
    let speed = s.anim_speed.clamp(0.3, 3.0);
    match s.animation.as_str() {
        "pop-in" if is_active => {
            let (a, b) = ((120.0 / speed) as u32, (260.0 / speed) as u32);
            tags.push_str(&format!("\\fscx55\\fscy55\\t(0,{a},\\fscx114\\fscy114)\\t({a},{b},\\fscx100\\fscy100)"));
        }
        "scale-emphasis" if is_active => tags.push_str("\\fscx118\\fscy118"),
        "keyword-emphasis" if w.keyword == Some(true) => tags.push_str("\\fscx114\\fscy114"),
        "word-reveal" | "slide-up" | "typewriter" if is_active => tags.push_str(&format!("\\alpha&HFF&\\t(0,{},\\alpha&H00&)", (140.0 / speed) as u32)),
        _ => {}
    }
    format!("{{{tags}}}{}{{\\r}}", word_text(w, s))
}

fn dialogue(start: f64, end: f64, text: String) -> String {
    format!("Dialogue: 0,{},{},Cap,,0,0,0,,{text}", time(start), time(end))
}

fn page_events(c: &Ctx, page: &[Word], page_end: f64, out: &mut Vec<String>) {
    let s = c.s;
    let start = page[0].start;
    let prefix = format!("{{{}}}", c.pos);

    if s.highlight == "karaoke-fill" {
        // \kf sweeps from SecondaryColour (base) to PrimaryColour (highlight).
        let mut at = start;
        let parts = page
            .iter()
            .map(|w| {
                let gap = ((w.start - at).max(0.0) * 100.0).round() as u32;
                let dur = ((w.end - w.start).max(0.05) * 100.0).round() as u32;
                at = w.end;
                let lead = if gap > 0 { format!("{{\\k{gap}}}") } else { String::new() };
                format!("{lead}{{\\kf{dur}}}{}", word_text(w, s))
            })
            .collect();
        let colors = format!("{{\\1c{}&\\2c{}&}}", c.hl, c.base);
        out.push(dialogue(start, page_end, format!("{prefix}{colors}{}", lines(parts, s.max_words))));
        return;
    }

    let per_word = s.highlight == "active-word" || matches!(s.animation.as_str(), "word-reveal" | "pop-in" | "slide-up" | "typewriter" | "scale-emphasis");
    if per_word {
        for i in 0..page.len() {
            let from = if i == 0 { start } else { page[i].start };
            let to = page.get(i + 1).map_or(page_end, |n| n.start);
            if to - from < 0.01 {
                continue;
            }
            let parts = page.iter().enumerate().map(|(j, w)| styled(c, w, j, Some(i))).collect();
            out.push(dialogue(from, to, format!("{prefix}{}", lines(parts, s.max_words))));
        }
        return;
    }

    let parts = page.iter().enumerate().map(|(j, w)| styled(c, w, j, None)).collect();
    let fade = if s.animation == "fade" {
        let ms = (250.0 / s.anim_speed.clamp(0.3, 3.0)) as u32;
        format!("{{\\fad({ms},{ms})}}")
    } else {
        String::new()
    };
    out.push(dialogue(start, page_end, format!("{prefix}{fade}{}", lines(parts, s.max_words))));
}

/// `width` and `height` are the output video size; everything is sized from them like the preview.
pub fn build(segments: &[Segment], style: &Style, width: u32, height: u32) -> String {
    let s = style;
    let h = height as f64;
    // libass sizes by the font's full line box, so it renders about a fifth smaller than CSS pixels.
    let font_px = s.size / 1000.0 * h * 1.2;
    let outline = s.outline_width * 0.0005 * h;
    let shadow = s.shadow * 0.0007 * h;
    let spacing = s.letter_spacing / 100.0 * font_px;
    let bold = if s.weight >= 600 { -1 } else { 0 };
    let (border_style, outline_colour, out_w, shad) = if s.bg_enabled {
        (3, ass_color(&s.bg_color, s.bg_opacity), font_px * 0.18, 0.0)
    } else {
        (1, ass_color(&s.outline_color, 1.0), outline, shadow)
    };
    let (an, x) = match s.align.as_str() {
        _ if s.pos_x.is_some() => (5, width as f64 * s.pos_x.unwrap_or(50.0).clamp(0.0, 100.0) / 100.0),
        "left" => (4, width as f64 * 0.05),
        "right" => (6, width as f64 * 0.95),
        _ => (5, width as f64 / 2.0),
    };
    let ctx = Ctx {
        s,
        base: ass_color(&s.color, 1.0),
        hl: ass_color(&s.highlight_color, 1.0),
        pos: format!("\\an{an}\\pos({x:.0},{:.0})", s.pos_y.clamp(0.0, 100.0) / 100.0 * h),
    };

    let mut out = format!(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: {width}\nPlayResY: {height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n\
         [V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n\
         Style: Cap,{font},{font_px:.0},{primary},{primary},{outline_colour},&H80000000,{bold},0,0,0,100,100,{spacing:.1},0,{border_style},{out_w:.1},{shad:.1},{an},40,40,40,1\n\n\
         [Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
        font = font_name(&s.font),
        primary = ctx.base,
    );

    let page_size = (s.max_words.max(1)) * s.max_lines.max(1);
    let mut events = Vec::new();
    for (i, seg) in segments.iter().enumerate() {
        let pages: Vec<&[Word]> = seg.words.chunks(page_size).collect();
        for (p, page) in pages.iter().enumerate() {
            let next = pages
                .get(p + 1)
                .map(|n| n[0].start)
                .unwrap_or_else(|| segments.get(i + 1).map_or(seg.end + 0.35, |n| (seg.end + 0.35).min(n.start)));
            page_events(&ctx, page, next.max(page[0].start + 0.05), &mut events);
        }
    }
    out.push_str(&events.join("\n"));
    out.push('\n');
    out
}

/// A headline across the top of the picture for the whole clip.
pub fn add_hook(ass: &mut String, hook: &str, place: Option<TextPlace>, width: u32, height: u32, duration: f64) {
    let h = height as f64;
    let place = place.unwrap_or(TextPlace { x: 50.0, y: 7.0, scale: 1.0 });
    let tags = format!(
        "{{\\an8\\pos({:.0},{:.0})\\fnSegoe UI\\b1\\fs{:.0}\\fsp0\\1c&HFFFFFF&\\3c&H000000&\\bord{:.1}\\shad0}}",
        width as f64 * place.x / 100.0, h * place.y / 100.0, h * 0.043 * place.scale, h * 0.004 * place.scale
    );
    ass.push_str(&dialogue(0.0, duration, format!("{tags}{}", escape(hook.trim()))));
    ass.push('\n');
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::transcript::tests::make;

    fn style(f: impl FnOnce(&mut Style)) -> Style {
        let mut s = Style { animation: "none".into(), highlight: "none".into(), uppercase: false, ..Default::default() };
        f(&mut s);
        s
    }
    fn events(s: &str) -> Vec<&str> {
        s.lines().filter(|l| l.starts_with("Dialogue:")).collect()
    }

    #[test]
    fn colours_are_converted_to_bgr_and_bad_input_is_safe() {
        assert_eq!(ass_color("#ff8800", 1.0), "&H000088FF");
        assert_eq!(ass_color("#000000", 0.5), "&H80000000");
        assert_eq!(ass_color("red; {\\x}", 1.0), "&H00FFFFFF");
    }

    #[test]
    fn hook_title_covers_the_clip_and_cannot_inject_tags() {
        let mut out = build(&[], &style(|_| {}), 720, 1280);
        add_hook(&mut out, "  {\\b0}Watch this ", None, 720, 1280, 12.5);
        let e = events(&out);
        assert_eq!(e.len(), 1);
        assert!(e[0].starts_with("Dialogue: 0,0:00:00.00,0:00:12.50,") && e[0].ends_with("(/b0)Watch this"), "{}", e[0]);
        assert!(e[0].contains("\\an8\\pos(360,90)"), "{}", e[0]);
    }

    #[test]
    fn dragged_text_goes_where_it_was_put() {
        let mut out = build(&make(&[(0.0, "hi")]), &style(|s| { s.pos_x = Some(25.0); s.pos_y = 10.0; s.align = "left".into() }), 1000, 2000);
        assert!(out.contains("\\an5\\pos(250,200)"), "{out}");
        add_hook(&mut out, "Title", Some(TextPlace { x: 80.0, y: 50.0, scale: 2.0 }), 1000, 2000, 1.0);
        assert!(out.contains("\\pos(800,1000)") && out.contains("\\fs172"), "{out}");
    }

    #[test]
    fn times_are_ass_formatted() {
        assert_eq!(time(0.0), "0:00:00.00");
        assert_eq!(time(3725.678), "1:02:05.68");
    }

    #[test]
    fn header_uses_the_video_size_and_mapped_font() {
        let out = build(&make(&[(0.0, "hi there")]), &style(|s| s.font = "impact".into()), 1080, 1920);
        assert!(out.contains("PlayResX: 1080") && out.contains("PlayResY: 1920"));
        assert!(out.contains("Style: Cap,Impact,"), "{out}");
        assert!(out.contains("\\pos(540,1344)"), "{out}");
    }

    #[test]
    fn pages_follow_words_per_line_and_lines() {
        let seg = make(&[(0.0, "a b c d e f g h")]);
        let out = build(&seg, &style(|s| { s.max_words = 2; s.max_lines = 2 }), 1080, 1920);
        let e = events(&out);
        assert_eq!(e.len(), 2, "{e:?}");
        assert!(e[0].contains("\\N"));
        assert!(e[0].contains('a') && e[0].contains('d') && !e[0].contains("}e{"));
    }

    #[test]
    fn active_word_highlight_makes_one_event_per_word() {
        let out = build(&make(&[(0.0, "one two three")]), &style(|s| s.highlight = "active-word".into()), 1080, 1920);
        let e = events(&out);
        assert_eq!(e.len(), 3);
        assert!(e[1].contains("0:00:00.40"), "{}", e[1]);
        let hl = ass_color("#ffd84a", 1.0);
        assert_eq!(e[1].matches(&hl).count(), 1, "only the spoken word is coloured");
    }

    #[test]
    fn karaoke_uses_sweep_tags_and_reveal_hides_later_words() {
        let k = build(&make(&[(0.0, "one two")]), &style(|s| s.highlight = "karaoke-fill".into()), 720, 1280);
        assert_eq!(events(&k).len(), 1);
        assert_eq!(k.matches("\\kf").count(), 2);
        let r = build(&make(&[(0.0, "one two three")]), &style(|s| s.animation = "word-reveal".into()), 720, 1280);
        assert!(events(&r)[0].matches("\\alpha&HFF&").count() >= 2);
    }

    #[test]
    fn transcript_text_cannot_inject_ass_tags() {
        let out = build(&make(&[(0.0, "{\\p1}evil\\N")]), &style(|_| {}), 720, 1280);
        let line = events(&out)[0];
        assert!(line.contains("(/p1)evil/N"), "{line}");
        assert!(!line.contains("{\\p1}"));
    }

    #[test]
    fn background_box_uses_border_style_three() {
        let out = build(&make(&[(0.0, "hi")]), &style(|s| s.bg_enabled = true), 720, 1280);
        let s = out.lines().find(|l| l.starts_with("Style:")).unwrap();
        assert!(s.contains(",3,"), "{s}");
    }
}
