//! "Axapta-Bericht": month totals per category in ≤ 24 h blocks, plus a
//! per-day overview. Port of src/components/category-report-pdf.tsx.

use super::{
    format_hm, Doc, Meta, Rgb, Weight, CONTENT_WIDTH, HEADER_BG, MARGIN_X, MUTED, RULE, RULE_LIGHT,
    TEXT, TEXT_2, TEXT_3, ZEBRA_BG,
};
use crate::category_report::{CategoryReport, CATEGORIES};

/// Minutes as "hh:mm", or a dash for zero to keep the grid readable.
fn cell_time(minutes: i32) -> String {
    if minutes > 0 {
        format_hm(f64::from(minutes))
    } else {
        "–".into()
    }
}

fn hm(minutes: i32) -> String {
    format_hm(f64::from(minutes))
}

const RIGHT: f32 = MARGIN_X + CONTENT_WIDTH;

/// One category: name and total over a rule, then one row per block.
fn category_height(blocks: usize) -> f32 {
    Doc::line_height(12.0) + 4.0 + 1.0 + 4.0 + blocks as f32 * (4.0 + Doc::line_height(10.0))
}

// ── Day table ──
const DAY_COL: f32 = 56.0;
const SUM_COL: f32 = 52.0;
const COL_PAD: f32 = 2.0;

/// Draws one row of the day table: label left, the rest right-aligned.
fn table_cells(doc: &mut Doc, baseline: f32, w: Weight, size: f32, cells: &[(String, Rgb)]) {
    let cat_width = (CONTENT_WIDTH - DAY_COL - SUM_COL) / CATEGORIES.len() as f32;
    let (label, color) = &cells[0];
    doc.text(MARGIN_X + COL_PAD, baseline, w, size, *color, label);
    let mut right = MARGIN_X + DAY_COL;
    for (text, color) in &cells[1..cells.len() - 1] {
        right += cat_width;
        doc.text_right(right - COL_PAD, baseline, w, size, *color, text);
    }
    let (sum, color) = &cells[cells.len() - 1];
    doc.text_right(RIGHT - COL_PAD, baseline, w, size, *color, sum);
}

/// Renders the report.
pub fn category_pdf(report: &CategoryReport) -> Vec<u8> {
    let mut doc = Doc::new();
    let title = format!("Axapta-Bericht · {}", report.range_label);

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
    doc.y += Doc::line_height(11.0) + 8.0;
    let intro = "Zeiten je Kategorie, aufgeteilt in Buchungsblöcke von maximal 24:00 \
                 Stunden zur manuellen Übertragung.";
    for line in doc.wrap(Weight::Regular, 9.0, intro, CONTENT_WIDTH) {
        doc.text(
            MARGIN_X,
            Doc::baseline(doc.y, 9.0),
            Weight::Regular,
            9.0,
            TEXT_3,
            &line,
        );
        doc.y += Doc::line_height(9.0);
    }
    doc.y += 18.0;

    if report.categories.is_empty() {
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
    }

    for cat in &report.categories {
        // A category never splits across pages.
        if !doc.fits(category_height(cat.blocks.len())) {
            doc.new_page();
        }
        let baseline = Doc::baseline(doc.y, 12.0);
        doc.text(
            MARGIN_X,
            baseline,
            Weight::Bold,
            12.0,
            TEXT,
            cat.name.as_str(),
        );
        doc.text_right(
            RIGHT,
            baseline,
            Weight::Bold,
            12.0,
            TEXT,
            &hm(cat.total_minutes),
        );
        doc.y += Doc::line_height(12.0) + 4.0;
        doc.hline(MARGIN_X, RIGHT, doc.y, 1.0, RULE);
        doc.y += 1.0 + 4.0;
        for (i, minutes) in cat.blocks.iter().enumerate() {
            let baseline = Doc::baseline(doc.y + 2.0, 10.0);
            let label = format!("Block {}", i + 1);
            doc.text(
                MARGIN_X + 10.0,
                baseline,
                Weight::Regular,
                10.0,
                TEXT_2,
                &label,
            );
            doc.text_right(RIGHT, baseline, Weight::Bold, 10.0, TEXT, &hm(*minutes));
            doc.y += 4.0 + Doc::line_height(10.0);
        }
        doc.y += 16.0;
    }

    if !report.categories.is_empty() {
        let height = 8.0 + 1.0 + 8.0 + Doc::line_height(14.0);
        if !doc.fits(height) {
            doc.new_page();
        }
        doc.y += 8.0;
        doc.hline(MARGIN_X, RIGHT, doc.y, 1.0, RULE);
        doc.y += 1.0 + 8.0;
        let baseline = Doc::baseline(doc.y, 14.0);
        doc.text(
            MARGIN_X,
            baseline,
            Weight::Regular,
            11.0,
            TEXT_2,
            "Gesamtzeit:",
        );
        doc.text_right(
            RIGHT,
            baseline,
            Weight::Bold,
            14.0,
            TEXT,
            &hm(report.total_minutes),
        );
        doc.y += Doc::line_height(14.0);
    }

    if !report.days.is_empty() {
        let title_height = 26.0 + Doc::line_height(12.0) + 6.0;
        let header_height = 1.0 + 4.0 + Doc::line_height(7.0) + 4.0 + 1.0;
        let row_height = 3.0 + Doc::line_height(9.0) + 3.0 + 0.5;
        // Keep the title and the header with the first row.
        if !doc.fits(title_height + header_height + row_height) {
            doc.new_page();
            doc.y -= 26.0;
        }
        doc.y += 26.0;
        doc.text(
            MARGIN_X,
            Doc::baseline(doc.y, 12.0),
            Weight::Bold,
            12.0,
            TEXT,
            "Tagesübersicht",
        );
        doc.y += Doc::line_height(12.0) + 6.0;

        let top = doc.y;
        doc.fill_rect(MARGIN_X, top, CONTENT_WIDTH, header_height, HEADER_BG);
        doc.hline(MARGIN_X, RIGHT, top, 1.0, RULE);
        doc.hline(MARGIN_X, RIGHT, top + header_height - 1.0, 1.0, RULE);
        let mut header = vec![("Datum".to_owned(), TEXT)];
        header.extend(CATEGORIES.iter().map(|c| (c.as_str().to_owned(), TEXT)));
        header.push(("Summe".to_owned(), TEXT));
        table_cells(
            &mut doc,
            Doc::baseline(top + 5.0, 7.0),
            Weight::Bold,
            7.0,
            &header,
        );
        doc.y += header_height;

        for (i, day) in report.days.iter().enumerate() {
            if !doc.fits(row_height) {
                doc.new_page();
            }
            let top = doc.y;
            if i % 2 == 1 {
                doc.fill_rect(MARGIN_X, top, CONTENT_WIDTH, row_height, ZEBRA_BG);
            }
            doc.hline(MARGIN_X, RIGHT, top + row_height - 0.5, 0.5, RULE_LIGHT);
            let mut cells = vec![(day.label.clone(), TEXT)];
            cells.extend(CATEGORIES.iter().map(|c| {
                let m = day.minutes_by_category.get(c).copied().unwrap_or(0);
                (cell_time(m), if m > 0 { TEXT } else { MUTED })
            }));
            cells.push((hm(day.total_minutes), TEXT));
            table_cells(
                &mut doc,
                Doc::baseline(top + 3.0, 9.0),
                Weight::Regular,
                9.0,
                &cells,
            );
            doc.y += row_height;
        }

        let footer_height = 1.0 + 4.0 + Doc::line_height(9.0) + 4.0;
        if !doc.fits(footer_height) {
            doc.new_page();
        }
        doc.hline(MARGIN_X, RIGHT, doc.y, 1.0, RULE);
        let mut cells = vec![("Summe".to_owned(), TEXT)];
        cells.extend(
            CATEGORIES
                .iter()
                .map(|c| (cell_time(report.category_total(*c)), TEXT)),
        );
        cells.push((hm(report.total_minutes), TEXT));
        let baseline = Doc::baseline(doc.y + 5.0, 9.0);
        table_cells(&mut doc, baseline, Weight::Bold, 9.0, &cells);
        doc.y += footer_height;
    }

    doc.finish(&Meta {
        title: &title,
        author: &report.display_name,
        subject: &format!("Buchungsbericht {}", report.range_label),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::category_report::{split_into_blocks, CategoryReportDay, CategoryReportItem};
    use crate::entries::AllgemeinesCategory;
    use crate::pdf::test_util::page_texts;

    #[test]
    fn categories_blocks_and_days_are_in_the_pdf() {
        let item = |name, total_minutes| CategoryReportItem {
            name,
            total_minutes,
            blocks: split_into_blocks(total_minutes),
        };
        let report = CategoryReport {
            display_name: "—".into(),
            range_label: "Oktober 2026".into(),
            categories: vec![
                item(AllgemeinesCategory::Projektorganisation, 4378),
                item(AllgemeinesCategory::Implementierung, 5040),
            ],
            days: vec![CategoryReportDay {
                day_key: "2026-10-01".into(),
                label: "Do 01.10.".into(),
                minutes_by_category: CATEGORIES
                    .iter()
                    .map(|c| (*c, if *c == AllgemeinesCategory::Qa { 0 } else { 80 }))
                    .collect(),
                total_minutes: 240,
            }],
            total_minutes: 9418,
        };
        let text = page_texts(&category_pdf(&report)).join("\n");
        for needle in [
            "Axapta-Bericht · Oktober 2026",
            "Buchungsblöcke von maximal 24:00",
            "Übertragung.",
            "Projektorganisation",
            "72:58",
            "Block 4",
            "00:58",
            "84:00",
            "Gesamtzeit:",
            "156:58",
            "Tagesübersicht",
            "Do 01.10.",
            "01:20",
            "–",
            "Summe",
            "Seite 1 / 1",
        ] {
            assert!(text.contains(needle), "{needle:?} missing in {text}");
        }
    }

    #[test]
    fn an_empty_month_says_so() {
        let report = CategoryReport {
            display_name: "—".into(),
            range_label: "Mai 2026".into(),
            categories: vec![],
            days: vec![],
            total_minutes: 0,
        };
        let text = page_texts(&category_pdf(&report)).join("\n");
        assert!(
            text.contains("Keine Einträge in diesem Zeitraum."),
            "{text}"
        );
        assert!(!text.contains("Gesamtzeit"), "{text}");
    }
}
