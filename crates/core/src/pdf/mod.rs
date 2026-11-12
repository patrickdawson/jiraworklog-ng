//! PDF reports: the timesheet ("Als PDF") and the Axapta-Bericht. Port of
//! src/components/worklog-pdf.tsx and category-report-pdf.tsx, which used
//! `@react-pdf/renderer`.
//!
//! The layout is done by hand on a tiny canvas ([`Doc`]): A4 pages, text in
//! two embedded fonts, filled rectangles and lines. Both reports are tables,
//! so that is all they need, and it keeps the binary small (see
//! docs/tauri-migration.md, milestone 7). The fonts are Arimo (SIL OFL 1.1,
//! metric-compatible with Helvetica/Arial, which the old renderer used),
//! pre-subset to Latin, Greek, Cyrillic and common symbols, and subset again
//! per document to the glyphs it uses.

mod category;
mod worklog;

pub use category::category_pdf;
pub use worklog::worklog_pdf;

use chrono::{DateTime, TimeZone, Utc};
use pdf_writer::types::{CidFontType, FontFlags, SystemInfo, UnicodeCmap};
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref, Str, TextStr};
use subsetter::GlyphRemapper;
use ttf_parser::Face;

use crate::days::parse_iso;

const REGULAR_TTF: &[u8] = include_bytes!("../../assets/fonts/Arimo-Regular.ttf");
const BOLD_TTF: &[u8] = include_bytes!("../../assets/fonts/Arimo-Bold.ttf");

/// A4 in points.
pub(crate) const PAGE_WIDTH: f32 = 595.28;
pub(crate) const PAGE_HEIGHT: f32 = 841.89;

/// Margins shared by both reports (the old `page` style).
pub(crate) const MARGIN_TOP: f32 = 36.0;
pub(crate) const MARGIN_BOTTOM: f32 = 44.0;
pub(crate) const MARGIN_X: f32 = 40.0;
pub(crate) const CONTENT_WIDTH: f32 = PAGE_WIDTH - 2.0 * MARGIN_X;
/// Lowest y (from the top) content may reach.
pub(crate) const CONTENT_BOTTOM: f32 = PAGE_HEIGHT - MARGIN_BOTTOM;

/// An sRGB colour from `0xRRGGBB`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Rgb(pub u32);

impl Rgb {
    fn parts(self) -> (f32, f32, f32) {
        let c = |shift: u32| ((self.0 >> shift) & 0xff) as f32 / 255.0;
        (c(16), c(8), c(0))
    }
}

pub(crate) const TEXT: Rgb = Rgb(0x1f2937);
pub(crate) const TEXT_2: Rgb = Rgb(0x374151);
pub(crate) const TEXT_3: Rgb = Rgb(0x6b7280);
pub(crate) const MUTED: Rgb = Rgb(0x9ca3af);
pub(crate) const RULE: Rgb = Rgb(0x111827);
pub(crate) const RULE_LIGHT: Rgb = Rgb(0xe5e7eb);
pub(crate) const HEADER_BG: Rgb = Rgb(0xf3f4f6);
pub(crate) const ZEBRA_BG: Rgb = Rgb(0xfafafa);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Weight {
    Regular,
    Bold,
}

/// One embedded font and the glyphs the document uses from it.
struct FontState {
    face: Face<'static>,
    data: &'static [u8],
    resource: &'static [u8],
    base_name: &'static str,
    remapper: GlyphRemapper,
    /// `(new glyph id, char)` for the ToUnicode map (text extraction, search).
    to_unicode: Vec<(u16, char)>,
}

impl FontState {
    fn new(data: &'static [u8], resource: &'static [u8], base_name: &'static str) -> Self {
        Self {
            face: Face::parse(data, 0).expect("embedded font parses"),
            data,
            resource,
            base_name,
            remapper: GlyphRemapper::new(),
            to_unicode: Vec::new(),
        }
    }

    fn units(&self) -> f32 {
        f32::from(self.face.units_per_em())
    }

    fn glyph(&self, c: char) -> u16 {
        self.face.glyph_index(c).map_or(0, |g| g.0)
    }

    fn advance(&self, c: char) -> f32 {
        let gid = ttf_parser::GlyphId(self.glyph(c));
        f32::from(self.face.glyph_hor_advance(gid).unwrap_or(0)) / self.units()
    }

    /// Text as 2-byte CIDs of the subset (Identity-H).
    fn encode(&mut self, text: &str) -> Vec<u8> {
        let mut out = Vec::with_capacity(text.len() * 2);
        for c in text.chars() {
            let old = self.glyph(c);
            let known = self.remapper.get(old).is_some();
            let new = self.remapper.remap(old);
            if !known && old != 0 {
                self.to_unicode.push((new, c));
            }
            out.extend_from_slice(&new.to_be_bytes());
        }
        out
    }
}

/// A4 pages in top-down coordinates (y = 0 is the top edge).
pub(crate) struct Doc {
    regular: FontState,
    bold: FontState,
    pages: Vec<Content>,
    /// The page drawing goes to.
    current: usize,
    /// Top of the free space on the current page.
    pub y: f32,
}

/// Document metadata (`/Info`).
pub(crate) struct Meta<'a> {
    pub title: &'a str,
    pub author: &'a str,
    pub subject: &'a str,
}

impl Doc {
    pub fn new() -> Self {
        Self {
            regular: FontState::new(REGULAR_TTF, b"F1", "Arimo-Regular"),
            bold: FontState::new(BOLD_TTF, b"F2", "Arimo-Bold"),
            pages: vec![Content::new()],
            current: 0,
            y: MARGIN_TOP,
        }
    }

    fn font(&self, w: Weight) -> &FontState {
        match w {
            Weight::Regular => &self.regular,
            Weight::Bold => &self.bold,
        }
    }

    fn font_mut(&mut self, w: Weight) -> &mut FontState {
        match w {
            Weight::Regular => &mut self.regular,
            Weight::Bold => &mut self.bold,
        }
    }

    fn page(&mut self) -> &mut Content {
        &mut self.pages[self.current]
    }

    pub fn new_page(&mut self) {
        self.pages.push(Content::new());
        self.current = self.pages.len() - 1;
        self.y = MARGIN_TOP;
    }

    /// Whether `height` more points fit on the current page.
    pub fn fits(&self, height: f32) -> bool {
        self.y + height <= CONTENT_BOTTOM + 0.01
    }

    pub fn width(&self, w: Weight, size: f32, text: &str) -> f32 {
        let f = self.font(w);
        text.chars().map(|c| f.advance(c)).sum::<f32>() * size
    }

    /// Height of one line of text. react-pdf set Helvetica at 1.1 × the font
    /// size; measured in the old PDFs.
    pub fn line_height(size: f32) -> f32 {
        1.1 * size
    }

    /// Distance from the top of a line box to its baseline (0.9 × size in
    /// the old PDFs).
    pub fn ascent(size: f32) -> f32 {
        0.9 * size
    }

    /// The baseline of a line box whose top is at `top`.
    pub fn baseline(top: f32, size: f32) -> f32 {
        top + Self::ascent(size)
    }

    /// Breaks `text` into lines of at most `max` points: at spaces, and
    /// inside words that are longer than a whole line.
    pub fn wrap(&self, w: Weight, size: f32, text: &str, max: f32) -> Vec<String> {
        let mut lines = Vec::new();
        for paragraph in text.split('\n') {
            let mut line = String::new();
            for word in paragraph.split(' ').filter(|s| !s.is_empty()) {
                let candidate = if line.is_empty() {
                    word.to_owned()
                } else {
                    format!("{line} {word}")
                };
                if self.width(w, size, &candidate) <= max {
                    line = candidate;
                    continue;
                }
                if self.width(w, size, word) <= max {
                    if !line.is_empty() {
                        lines.push(std::mem::take(&mut line));
                    }
                    line = word.to_owned();
                    continue;
                }
                // Longer than a whole line: hyphenate it, starting on the
                // current line (react-pdf hyphenated by syllables; breaking
                // where the line is full is close enough).
                if !line.is_empty() {
                    line.push(' ');
                }
                // Bytes of `line` before the first character of this word.
                let mut prefix = line.len();
                let chars: Vec<char> = word.chars().collect();
                for (i, &c) in chars.iter().enumerate() {
                    let mut next = line.clone();
                    next.push(c);
                    let needed = if i + 1 == chars.len() {
                        next.clone()
                    } else {
                        format!("{next}-")
                    };
                    if self.width(w, size, &needed) <= max {
                        line = next;
                    } else if line.len() > prefix {
                        line.push('-');
                        lines.push(std::mem::take(&mut line));
                        line.push(c);
                        prefix = 0;
                    } else if prefix > 0 {
                        // Not even one character fits after the previous words.
                        lines.push(line.trim_end().to_owned());
                        line = c.to_string();
                        prefix = 0;
                    } else {
                        // A single character wider than the column.
                        line = next;
                    }
                }
            }
            lines.push(line);
        }
        // Keep at least one (empty) line so rows never collapse.
        if lines.is_empty() {
            lines.push(String::new());
        }
        lines
    }

    /// Draws one line of text with its baseline at `baseline` (from the top).
    pub fn text(&mut self, x: f32, baseline: f32, w: Weight, size: f32, color: Rgb, text: &str) {
        if text.is_empty() {
            return;
        }
        let bytes = self.font_mut(w).encode(text);
        let name = self.font(w).resource;
        let (r, g, b) = color.parts();
        self.page()
            .begin_text()
            .set_fill_rgb(r, g, b)
            .set_font(Name(name), size)
            .next_line(x, PAGE_HEIGHT - baseline)
            .show(Str(&bytes))
            .end_text();
    }

    /// Text right-aligned to `right`.
    pub fn text_right(
        &mut self,
        right: f32,
        baseline: f32,
        w: Weight,
        size: f32,
        color: Rgb,
        text: &str,
    ) {
        let x = right - self.width(w, size, text);
        self.text(x, baseline, w, size, color, text);
    }

    /// Text centred between `left` and `left + width`.
    #[allow(clippy::too_many_arguments)]
    pub fn text_center(
        &mut self,
        left: f32,
        width: f32,
        baseline: f32,
        w: Weight,
        size: f32,
        color: Rgb,
        text: &str,
    ) {
        let x = left + (width - self.width(w, size, text)) / 2.0;
        self.text(x, baseline, w, size, color, text);
    }

    pub fn fill_rect(&mut self, x: f32, y: f32, width: f32, height: f32, color: Rgb) {
        let (r, g, b) = color.parts();
        self.page()
            .set_fill_rgb(r, g, b)
            .rect(x, PAGE_HEIGHT - y - height, width, height)
            .fill_nonzero();
    }

    /// A horizontal rule whose top edge is at `y`.
    pub fn hline(&mut self, x1: f32, x2: f32, y: f32, thickness: f32, color: Rgb) {
        self.fill_rect(x1, y, x2 - x1, thickness, color);
    }

    /// Adds "Seite n / N" to every page and writes the file.
    pub fn finish(mut self, meta: &Meta) -> Vec<u8> {
        let total = self.pages.len();
        for i in 0..total {
            let label = format!("Seite {} / {}", i + 1, total);
            // The old footer box ends 22 pt above the page edge.
            let size = 9.0;
            let baseline = Self::baseline(PAGE_HEIGHT - 22.0 - Self::line_height(size), size);
            self.current = i;
            self.text_center(
                MARGIN_X,
                CONTENT_WIDTH,
                baseline,
                Weight::Regular,
                size,
                MUTED,
                &label,
            );
        }
        write_pdf(self, meta)
    }
}

/// The ids a font needs in the file.
struct FontRefs {
    type0: Ref,
    cid: Ref,
    descriptor: Ref,
    file: Ref,
    cmap: Ref,
}

fn compress(data: &[u8]) -> Vec<u8> {
    miniz_oxide::deflate::compress_to_vec_zlib(data, 6)
}

fn write_font(pdf: &mut Pdf, f: &FontState, refs: &FontRefs, tag: &str) {
    let units = f.units();
    let scale = |v: i16| f32::from(v) * 1000.0 / units;
    let base = format!("{tag}+{}", f.base_name);
    let base = Name(base.as_bytes());
    let system_info = SystemInfo {
        registry: Str(b"Adobe"),
        ordering: Str(b"Identity"),
        supplement: 0,
    };

    pdf.type0_font(refs.type0)
        .base_font(base)
        .encoding_predefined(Name(b"Identity-H"))
        .descendant_font(refs.cid)
        .to_unicode(refs.cmap);

    // Widths in subset order: new glyph id i is old glyph `old[i]`.
    let old: Vec<u16> = f.remapper.remapped_gids().collect();
    let widths: Vec<f32> = old
        .iter()
        .map(|&g| {
            f32::from(
                f.face
                    .glyph_hor_advance(ttf_parser::GlyphId(g))
                    .unwrap_or(0),
            ) * 1000.0
                / units
        })
        .collect();
    let mut cid = pdf.cid_font(refs.cid);
    cid.subtype(CidFontType::Type2)
        .base_font(base)
        .system_info(system_info)
        .font_descriptor(refs.descriptor)
        .cid_to_gid_map_predefined(Name(b"Identity"));
    cid.widths().consecutive(0, widths);
    cid.finish();

    let bbox = f.face.global_bounding_box();
    let cap = f.face.capital_height().unwrap_or(f.face.ascender());
    pdf.font_descriptor(refs.descriptor)
        .name(base)
        .flags(FontFlags::NON_SYMBOLIC)
        .bbox(Rect::new(
            scale(bbox.x_min),
            scale(bbox.y_min),
            scale(bbox.x_max),
            scale(bbox.y_max),
        ))
        .italic_angle(0.0)
        .ascent(scale(f.face.ascender()))
        .descent(scale(f.face.descender()))
        .cap_height(scale(cap))
        .stem_v(if f.base_name.ends_with("Bold") {
            120.0
        } else {
            80.0
        })
        .font_file2(refs.file);

    let subset = subsetter::subset(f.data, 0, &f.remapper).unwrap_or_else(|_| f.data.to_vec());
    pdf.stream(refs.file, &compress(&subset))
        .filter(Filter::FlateDecode);

    let mut cmap = UnicodeCmap::new(Name(b"Custom"), system_info);
    for &(gid, c) in &f.to_unicode {
        cmap.pair(gid, c);
    }
    pdf.cmap(refs.cmap, &cmap.finish());
}

fn write_pdf(doc: Doc, meta: &Meta) -> Vec<u8> {
    let mut next = 0;
    let mut alloc = || {
        next += 1;
        Ref::new(next)
    };
    let catalog = alloc();
    let tree = alloc();
    let info = alloc();
    let mut font_refs = || FontRefs {
        type0: alloc(),
        cid: alloc(),
        descriptor: alloc(),
        file: alloc(),
        cmap: alloc(),
    };
    let regular = font_refs();
    let bold = font_refs();
    let page_refs: Vec<(Ref, Ref)> = doc.pages.iter().map(|_| (alloc(), alloc())).collect();

    let mut pdf = Pdf::new();
    pdf.catalog(catalog).pages(tree);
    pdf.pages(tree)
        .kids(page_refs.iter().map(|(p, _)| *p))
        .count(page_refs.len() as i32);
    pdf.document_info(info)
        .title(TextStr(meta.title))
        .author(TextStr(meta.author))
        .subject(TextStr(meta.subject))
        .producer(TextStr("JiraWorklog"));

    for ((page_id, content_id), content) in page_refs.iter().zip(doc.pages) {
        let mut page = pdf.page(*page_id);
        page.media_box(Rect::new(0.0, 0.0, PAGE_WIDTH, PAGE_HEIGHT))
            .parent(tree)
            .contents(*content_id);
        let mut resources = page.resources();
        let mut fonts = resources.fonts();
        fonts.pair(Name(doc.regular.resource), regular.type0);
        fonts.pair(Name(doc.bold.resource), bold.type0);
        fonts.finish();
        resources.finish();
        page.finish();
        pdf.stream(*content_id, &compress(&content.finish()))
            .filter(Filter::FlateDecode);
    }

    write_font(&mut pdf, &doc.regular, &regular, "JWLAAA");
    write_font(&mut pdf, &doc.bold, &bold, "JWLAAB");
    pdf.finish()
}

// ── Formatting shared by both reports (src/lib/format.ts) ───────────────────

/// Minutes → `hh:mm` (negative counts as zero).
pub(crate) fn format_hm(total_minutes: f64) -> String {
    let m = crate::time::js_round(total_minutes).max(0.0) as i64;
    format!("{:02}:{:02}", m / 60, m % 60)
}

fn local<Tz: TimeZone>(iso: &str, tz: &Tz) -> Option<DateTime<Tz>> {
    parse_iso(iso).map(|at: DateTime<Utc>| at.with_timezone(tz))
}

/// Local `HH:MM`.
pub(crate) fn clock_time<Tz: TimeZone>(iso: &str, tz: &Tz) -> String {
    local(iso, tz).map_or_else(String::new, |d| d.naive_local().format("%H:%M").to_string())
}

/// Local `DD.MM.`.
pub(crate) fn format_day_month<Tz: TimeZone>(iso: &str, tz: &Tz) -> String {
    local(iso, tz).map_or_else(String::new, |d| {
        d.naive_local().format("%d.%m.").to_string()
    })
}

/// Local weekday, "Mo" … "So".
pub(crate) fn weekday_short<Tz: TimeZone>(iso: &str, tz: &Tz) -> String {
    use chrono::Datelike;
    const DAYS: [&str; 7] = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    local(iso, tz).map_or_else(String::new, |d| {
        DAYS[d.weekday().num_days_from_monday() as usize].to_owned()
    })
}

#[cfg(test)]
pub(crate) mod test_util {
    /// Text of every page, extracted through the fonts' ToUnicode maps.
    pub fn page_texts(pdf: &[u8]) -> Vec<String> {
        assert!(pdf.starts_with(b"%PDF-"));
        let doc = lopdf::Document::load_mem(pdf).expect("valid PDF");
        let pages: Vec<u32> = doc.get_pages().keys().copied().collect();
        pages
            .iter()
            .map(|p| doc.extract_text(&[*p]).expect("text"))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hm_rounds_like_javascript() {
        assert_eq!(format_hm(0.0), "00:00");
        assert_eq!(format_hm(59.5), "01:00");
        assert_eq!(format_hm(1501.0), "25:01");
        assert_eq!(format_hm(-5.0), "00:00");
    }

    #[test]
    fn wrap_breaks_at_spaces_and_inside_long_words() {
        let doc = Doc::new();
        let lines = doc.wrap(Weight::Regular, 9.0, "Allg. · Projektorganisation", 68.0);
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert!(lines[0].starts_with("Allg. · Projekt"), "{lines:?}");
        assert!(lines[0].ends_with('-'), "{lines:?}");
        assert_eq!(
            lines[0].trim_end_matches('-').to_owned() + &lines[1],
            "Allg. · Projektorganisation"
        );
        for line in &lines {
            assert!(doc.width(Weight::Regular, 9.0, line) <= 68.0, "{line}");
        }
        assert_eq!(doc.wrap(Weight::Regular, 9.0, "", 50.0), [""]);
        let long = "x".repeat(200);
        assert!(doc.wrap(Weight::Regular, 9.0, &long, 100.0).len() > 2);
    }

    #[test]
    fn umlauts_dashes_and_minus_survive_a_round_trip() {
        let mut doc = Doc::new();
        doc.text(
            40.0,
            60.0,
            Weight::Regular,
            10.0,
            TEXT,
            "Übertragung – Größe − 5",
        );
        doc.text(40.0, 80.0, Weight::Bold, 10.0, TEXT, "Tagesübersicht");
        let pdf = doc.finish(&Meta {
            title: "t",
            author: "a",
            subject: "s",
        });
        let text = test_util::page_texts(&pdf).join("\n");
        assert!(text.contains("Übertragung – Größe − 5"), "{text}");
        assert!(text.contains("Tagesübersicht"), "{text}");
        assert!(text.contains("Seite 1 / 1"), "{text}");
    }
}
