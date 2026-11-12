//! "Stundenzettel": one row per entry. Port of src/components/worklog-pdf.tsx.

use chrono::TimeZone;

use super::{
    clock_time, format_day_month, format_hm, weekday_short, Doc, Meta, Weight, CONTENT_WIDTH,
    HEADER_BG, MARGIN_X, MUTED, RULE, RULE_LIGHT, TEXT, TEXT_2, TEXT_3, ZEBRA_BG,
};
use crate::time::js_round;
use crate::worklog_report::{ReportRow, WorklogReport};

const SIZE: f32 = 9.0;
/// Row padding: vertical, horizontal.
const HEADER_PAD_Y: f32 = 6.0;
const ROW_PAD_Y: f32 = 4.0;
const ROW_PAD_X: f32 = 2.0;
/// Every cell keeps 4 pt free on its right.
const CELL_PAD_R: f32 = 4.0;

#[derive(Clone, Copy, PartialEq)]
enum Align {
    Left,
    /// Right, with this much extra space to the cell's right edge.
    Right(f32),
    Center,
}

/// Column widths of the old layout; the comment takes the rest.
const FIXED: [(f32, Align); 8] = [
    (46.0, Align::Left),       // Datum
    (24.0, Align::Left),       // Tag
    (42.0, Align::Left),       // Beginn
    (42.0, Align::Left),       // Ende
    (46.0, Align::Right(6.0)), // Dauer
    (72.0, Align::Left),       // Issue
    (0.0, Align::Left),        // Kommentar (flex)
    (36.0, Align::Center),     // Gebucht
];
const COMMENT: usize = 6;

const HEADERS: [&str; 8] = [
    "Datum",
    "Tag",
    "Beginn",
    "Ende",
    "Dauer",
    "Issue",
    "Kommentar",
    "Gebucht",
];

/// `(x, width)` of each cell, padding included.
fn columns() -> [(f32, f32); 8] {
    let inner = CONTENT_WIDTH - 2.0 * ROW_PAD_X;
    let fixed: f32 = FIXED.iter().map(|(w, _)| w).sum();
    let mut x = MARGIN_X + ROW_PAD_X;
    let mut out = [(0.0, 0.0); 8];
    for (i, (w, _)) in FIXED.iter().enumerate() {
        let w = if i == COMMENT { inner - fixed } else { *w };
        out[i] = (x, w);
        x += w;
    }
    out
}

/// Draws one cell's lines starting at `top`.
fn cell(doc: &mut Doc, col: usize, top: f32, w: Weight, color: super::Rgb, lines: &[String]) {
    let (x, width) = columns()[col];
    let text_width = width - CELL_PAD_R;
    for (i, line) in lines.iter().enumerate() {
        let baseline = Doc::baseline(top + i as f32 * Doc::line_height(SIZE), SIZE);
        match FIXED[col].1 {
            Align::Left => doc.text(x, baseline, w, SIZE, color, line),
            Align::Right(extra) => {
                doc.text_right(x + text_width - extra, baseline, w, SIZE, color, line)
            }
            Align::Center => doc.text_center(x, text_width, baseline, w, SIZE, color, line),
        }
    }
}

fn header_height() -> f32 {
    1.0 + HEADER_PAD_Y + Doc::line_height(SIZE) + HEADER_PAD_Y + 1.0
}

fn table_header(doc: &mut Doc) {
    let top = doc.y;
    let height = header_height();
    let right = MARGIN_X + CONTENT_WIDTH;
    doc.fill_rect(MARGIN_X, top, CONTENT_WIDTH, height, HEADER_BG);
    doc.hline(MARGIN_X, right, top, 1.0, RULE);
    doc.hline(MARGIN_X, right, top + height - 1.0, 1.0, RULE);
    for (i, label) in HEADERS.iter().enumerate() {
        cell(
            doc,
            i,
            top + 1.0 + HEADER_PAD_Y,
            Weight::Bold,
            TEXT,
            &[(*label).to_owned()],
        );
    }
    doc.y += height;
}

/// The cells of one row, already wrapped.
fn row_lines<Tz: TimeZone>(doc: &Doc, row: &ReportRow, tz: &Tz) -> Vec<Vec<String>> {
    let cols = columns();
    let wrap =
        |col: usize, text: &str| doc.wrap(Weight::Regular, SIZE, text, cols[col].1 - CELL_PAD_R);
    let issue = if row.is_allgemeines {
        format!("Allg. · {}", row.category.map_or("—", |c| c.as_str()))
    } else {
        row.issue_key.clone().unwrap_or_else(|| "—".into())
    };
    vec![
        vec![format_day_month(&row.started_at, tz)],
        vec![weekday_short(&row.started_at, tz)],
        vec![clock_time(&row.started_at, tz)],
        vec![clock_time(&row.ended_at, tz)],
        vec![format_hm(js_round(row.duration_seconds / 60.0))],
        wrap(5, &issue),
        wrap(6, &row.comment),
        vec![if row.submitted { "Ja" } else { "—" }.to_owned()],
    ]
}

/// Renders the timesheet. Times are shown in `tz`.
pub fn worklog_pdf<Tz: TimeZone>(report: &WorklogReport, tz: &Tz) -> Vec<u8> {
    let mut doc = Doc::new();
    let right = MARGIN_X + CONTENT_WIDTH;
    let title = format!("Stundenzettel · {}", report.range_label);

    // Header block.
    doc.text(
        MARGIN_X,
        Doc::baseline(doc.y, 16.0),
        Weight::Bold,
        16.0,
        TEXT,
        &title,
    );
    doc.y += Doc::line_height(16.0) + 4.0;
    doc.text(
        MARGIN_X,
        Doc::baseline(doc.y, 11.0),
        Weight::Regular,
        11.0,
        TEXT_2,
        &report.display_name,
    );
    doc.y += Doc::line_height(11.0) + 14.0;

    if report.rows.is_empty() {
        doc.y += 40.0;
        doc.text_center(
            MARGIN_X,
            CONTENT_WIDTH,
            Doc::baseline(doc.y, 11.0),
            Weight::Regular,
            11.0,
            TEXT_3,
            "Keine Einträge in diesem Zeitraum.",
        );
        doc.y += Doc::line_height(11.0);
    } else {
        table_header(&mut doc);
        for (i, row) in report.rows.iter().enumerate() {
            let cells = row_lines(&doc, row, tz);
            let lines = cells.iter().map(Vec::len).max().unwrap_or(1);
            let height = 2.0 * ROW_PAD_Y + lines as f32 * Doc::line_height(SIZE) + 0.5;
            // Rows never split; the header repeats on every page.
            if !doc.fits(height) {
                doc.new_page();
                table_header(&mut doc);
            }
            let top = doc.y;
            if i % 2 == 1 {
                doc.fill_rect(MARGIN_X, top, CONTENT_WIDTH, height, ZEBRA_BG);
            }
            doc.hline(MARGIN_X, right, top + height - 0.5, 0.5, RULE_LIGHT);
            for (col, cell_lines) in cells.iter().enumerate() {
                let muted = col == 5 && row.issue_key.is_none() && !row.is_allgemeines;
                let color = if muted { MUTED } else { TEXT };
                cell(
                    &mut doc,
                    col,
                    top + ROW_PAD_Y,
                    Weight::Regular,
                    color,
                    cell_lines,
                );
            }
            doc.y += height;
        }
    }

    // Totals: "Gesamtzeit:" and the sum on one baseline, right-aligned.
    let total = format_hm(js_round(report.total_seconds / 60.0));
    let height = 14.0 + 1.0 + 8.0 + Doc::line_height(14.0);
    if !doc.fits(height) {
        doc.new_page();
    }
    let rule_top = doc.y + 14.0;
    doc.hline(MARGIN_X, right, rule_top, 1.0, RULE);
    let baseline = Doc::baseline(rule_top + 1.0 + 8.0, 14.0);
    doc.text_right(right, baseline, Weight::Bold, 14.0, TEXT, &total);
    let label_right = right - doc.width(Weight::Bold, 14.0, &total) - 8.0;
    doc.text_right(
        label_right,
        baseline,
        Weight::Regular,
        10.0,
        TEXT_2,
        "Gesamtzeit:",
    );
    doc.y += height;

    doc.finish(&Meta {
        title: &title,
        author: &report.display_name,
        subject: &format!("Stundenzettel {}", report.range_label),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entries::AllgemeinesCategory;
    use crate::pdf::test_util::page_texts;
    use chrono_tz::Europe::Berlin;

    fn row(start: &str, end: &str, key: Option<&str>, comment: &str) -> ReportRow {
        ReportRow {
            started_at: start.into(),
            ended_at: end.into(),
            duration_seconds: 5400.0,
            issue_key: key.map(Into::into),
            is_allgemeines: false,
            category: None,
            comment: comment.into(),
            submitted: key.is_some(),
        }
    }

    #[test]
    fn rows_totals_and_labels_are_in_the_pdf() {
        let mut allg = row(
            "2026-11-09T07:00:00.000Z",
            "2026-11-09T07:15:00.000Z",
            None,
            "Daily",
        );
        allg.is_allgemeines = true;
        allg.category = Some(AllgemeinesCategory::Projektorganisation);
        allg.duration_seconds = 900.0;
        let report = WorklogReport {
            display_name: "jörg@example.com".into(),
            range_label: "KW 46 · 09.11.–15.11.2026".into(),
            rows: vec![
                allg,
                row(
                    "2026-11-09T08:00:00.000Z",
                    "2026-11-09T09:30:00.000Z",
                    Some("TXR-7"),
                    "Größe prüfen",
                ),
            ],
            total_seconds: 6300.0,
        };
        let pdf = worklog_pdf(&report, &Berlin);
        let text = page_texts(&pdf).join("\n");
        for needle in [
            "Stundenzettel · KW 46 · 09.11.–15.11.2026",
            "jörg@example.com",
            "Datum",
            "Gebucht",
            "09.11.",
            "Mo",
            "08:00",
            "10:30",
            "01:30",
            "TXR-7",
            "Größe prüfen",
            "Ja",
            "Allg. · Projekt",
            "Gesamtzeit:",
            "01:45",
            "Seite 1 / 1",
        ] {
            assert!(text.contains(needle), "{needle:?} missing in {text}");
        }
    }

    #[test]
    fn long_reports_break_pages_and_repeat_the_header() {
        let rows: Vec<ReportRow> = (0..120)
            .map(|i| {
                row(
                    &format!("2026-11-{:02}T08:00:00.000Z", 1 + i / 5),
                    &format!("2026-11-{:02}T09:30:00.000Z", 1 + i / 5),
                    Some("TXR-1"),
                    "Ein Kommentar, der so lang ist, dass er in der Spalte umbrechen muss.",
                )
            })
            .collect();
        let report = WorklogReport {
            display_name: "—".into(),
            range_label: "November 2026".into(),
            rows,
            total_seconds: 120.0 * 5400.0,
        };
        let texts = page_texts(&worklog_pdf(&report, &Berlin));
        assert!(texts.len() > 2, "{} pages", texts.len());
        let n = texts.len();
        for (i, t) in texts.iter().enumerate() {
            assert!(t.contains("Kommentar"), "page {i} has no header");
            assert!(t.contains(&format!("Seite {} / {n}", i + 1)), "{t}");
        }
        assert!(texts[n - 1].contains("180:00"));
    }

    #[test]
    fn an_empty_range_says_so() {
        let report = WorklogReport {
            display_name: "—".into(),
            range_label: "Alle Einträge".into(),
            rows: vec![],
            total_seconds: 0.0,
        };
        let text = page_texts(&worklog_pdf(&report, &Berlin)).join("\n");
        assert!(
            text.contains("Keine Einträge in diesem Zeitraum."),
            "{text}"
        );
        assert!(text.contains("00:00"), "{text}");
    }
}
