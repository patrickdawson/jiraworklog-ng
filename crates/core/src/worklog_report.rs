//! The data of the "Als PDF" timesheet (Stundenzettel). Port of
//! src/lib/pdf-report.ts and the query part of src/app/api/report/pdf.

use chrono::{DateTime, TimeZone, Utc};
use rusqlite::Connection;
use serde::Serialize;

use crate::days::parse_iso;
use crate::entries::{to_entry_view, AllgemeinesCategory, AnalysisConfig, TimeEntry};
use crate::error::Result;
use crate::report_range::{self, RangeKind, ResolvedRange, SprintConfig};
use crate::settings::{self, SettingsInput};
use crate::store;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRow {
    pub started_at: String,
    pub ended_at: String,
    pub duration_seconds: f64,
    pub issue_key: Option<String>,
    pub is_allgemeines: bool,
    pub category: Option<AllgemeinesCategory>,
    pub comment: String,
    pub submitted: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorklogReport {
    pub display_name: String,
    pub range_label: String,
    pub rows: Vec<ReportRow>,
    pub total_seconds: f64,
}

/// `jira_user`, trimmed, or a dash. Both reports put it under the title.
pub(crate) fn display_name(s: &SettingsInput) -> String {
    match s.jira_user.as_deref().map(str::trim) {
        Some(name) if !name.is_empty() => name.to_owned(),
        _ => "—".to_owned(),
    }
}

/// Whether a finished entry started within the range (inclusive bounds).
pub(crate) fn started_in(entry: &TimeEntry, range: &ResolvedRange) -> bool {
    match (
        parse_iso(&entry.started_at),
        parse_iso(&range.from),
        parse_iso(&range.to),
    ) {
        (Some(at), Some(from), Some(to)) => at >= from && at <= to,
        _ => false,
    }
}

/// The finished entries of `range`, oldest first, with their booking state.
pub fn build_report<Tz: TimeZone>(
    entries: &[TimeEntry],
    s: &SettingsInput,
    range: &ResolvedRange,
    tz: &Tz,
) -> WorklogReport {
    let cfg = AnalysisConfig {
        project_keys: s.jira_project_keys.clone(),
        breaks: s.breaks.clone(),
        auto_pause: s.auto_pause_enabled,
    };
    let mut rows: Vec<ReportRow> = entries
        .iter()
        .filter(|e| e.ended_at.is_some() && started_in(e, range))
        .map(|e| {
            let view = to_entry_view(e, &cfg, tz);
            // Allgemeines entries are not booked to Jira and carry no issue key.
            let issue_key = if view.is_allgemeines {
                None
            } else {
                view.issue_key.clone()
            };
            let comment = if !view.is_allgemeines && view.issue_key.is_some() {
                view.comment.clone()
            } else {
                view.description.trim().to_owned()
            };
            ReportRow {
                started_at: view.started_at,
                ended_at: view.ended_at.unwrap_or_default(),
                duration_seconds: view.effective_seconds,
                issue_key,
                is_allgemeines: view.is_allgemeines,
                category: view.category,
                comment,
                submitted: view.submitted_at.is_some(),
            }
        })
        .collect();
    rows.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    let total_seconds = rows.iter().map(|r| r.duration_seconds).sum();

    WorklogReport {
        display_name: display_name(s),
        range_label: range.label.clone(),
        rows,
        total_seconds,
    }
}

/// Settings and the resolved period, shared by both PDF loaders.
pub(crate) fn settings_and_range<Tz: TimeZone>(
    conn: &Connection,
    kind: RangeKind,
    anchor: Option<&str>,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Result<(SettingsInput, ResolvedRange)> {
    let s = settings::get(conn)?.values;
    let sprint = SprintConfig {
        anchor_date: s.sprint_anchor_date.clone(),
        length_days: s.sprint_length_days,
    };
    let range = report_range::resolve(kind, anchor, now, &sprint, tz);
    Ok((s, range))
}

/// The timesheet of the period of `kind` around `anchor`, plus the period
/// (its `slug` names the file).
pub fn load<Tz: TimeZone>(
    conn: &Connection,
    kind: RangeKind,
    anchor: Option<&str>,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Result<(WorklogReport, ResolvedRange)> {
    let (s, range) = settings_and_range(conn, kind, anchor, now, tz)?;
    let entries = store::entries_between(conn, &range.from, &range.to)?;
    Ok((build_report(&entries, &s, &range, tz), range))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::timer::{self, EntryInput};
    use chrono_tz::Europe::Berlin;

    fn manual(conn: &Connection, desc: &str, start: &str, end: &str, allgemein: bool) {
        timer::create_manual_entry(
            conn,
            &EntryInput {
                description: desc.into(),
                started_at: Some(start.into()),
                ended_at: Some(end.into()),
                is_allgemeines: Some(allgemein),
                category: allgemein.then_some(AllgemeinesCategory::Qa),
            },
        )
        .unwrap();
    }

    #[test]
    fn rows_are_sorted_filtered_and_labelled() {
        let conn = open_in_memory().unwrap();
        manual(
            &conn,
            "TXR-7 Review",
            "2026-11-10T08:00:00.000Z",
            "2026-11-10T09:30:00.000Z",
            false,
        );
        manual(
            &conn,
            "  Daily  ",
            "2026-11-09T08:00:00.000Z",
            "2026-11-09T08:15:00.000Z",
            true,
        );
        manual(
            &conn,
            "ohne Ticket",
            "2026-11-09T09:00:00.000Z",
            "2026-11-09T10:00:00.000Z",
            false,
        );
        // Previous week: not in the range.
        manual(
            &conn,
            "TXR-1",
            "2026-11-02T08:00:00.000Z",
            "2026-11-02T09:00:00.000Z",
            false,
        );
        let now = parse_iso("2026-11-11T10:00:00.000Z").unwrap();
        let (r, range) = load(&conn, RangeKind::Week, None, now, &Berlin).unwrap();

        assert_eq!(range.slug, "2026-W46");
        assert_eq!(r.display_name, "—");
        assert_eq!(r.rows.len(), 3);
        assert_eq!(r.rows[0].comment, "Daily");
        assert_eq!(r.rows[0].issue_key, None);
        assert_eq!(r.rows[0].category, Some(AllgemeinesCategory::Qa));
        assert_eq!(r.rows[1].comment, "ohne Ticket");
        assert_eq!(r.rows[1].issue_key, None);
        assert_eq!(r.rows[2].issue_key.as_deref(), Some("TXR-7"));
        assert_eq!(r.rows[2].comment, "Review");
        assert!(!r.rows[2].submitted);
        assert_eq!(r.total_seconds, (15.0 + 60.0 + 90.0) * 60.0);
    }
}
