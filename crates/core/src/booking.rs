//! Jira booking: which worklogs a day (or every open day) turns into, and
//! sending them. Port of the "Jira booking" part of src/lib/actions.ts.
//!
//! Building the plan is pure; sending goes through [`JiraApi`], and marking
//! entries as submitted through a callback, so the shell can release the
//! database between HTTP requests.

use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{params, Connection};
use serde::Serialize;
use specta::Type;

use crate::days::{day_key_of, local_midnight, parse_iso, parse_key};
use crate::description::parse_description;
use crate::entries::{finished_seconds, TimeEntry};
use crate::error::{Error, Result};
use crate::jira::{JiraApi, WorklogRequest};
use crate::settings::{self, BookingMode, SettingsInput};
use crate::time::js_round;

/// One worklog as the preview shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlannedWorklog {
    pub issue_key: String,
    /// Jira `timeSpent`, e.g. `1h 30m`.
    pub time_spent: String,
    pub minutes: i32,
    pub comment: String,
    pub entry_count: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct SkippedEntry {
    pub description: String,
    pub reason: String,
}

/// What a booking would send (the preview dialog).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct BookingPlan {
    pub worklogs: Vec<PlannedWorklog>,
    pub skipped: Vec<SkippedEntry>,
}

/// A planned worklog plus what the preview does not show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Worklog {
    pub planned: PlannedWorklog,
    /// Start of the earliest entry in it.
    pub started: DateTime<Utc>,
    pub entry_ids: Vec<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Plan {
    pub worklogs: Vec<Worklog>,
    pub skipped: Vec<SkippedEntry>,
}

impl Plan {
    pub fn preview(self) -> BookingPlan {
        BookingPlan {
            worklogs: self.worklogs.into_iter().map(|w| w.planned).collect(),
            skipped: self.skipped,
        }
    }
}

/// `90` → `1h 30m`, `5` → `5m`.
pub fn format_duration_hours_minutes(minutes: i32) -> String {
    let hours = minutes.div_euclid(60);
    let rest = minutes.rem_euclid(60);
    if hours <= 0 {
        format!("{rest}m")
    } else {
        format!("{hours}h {rest}m")
    }
}

struct Valid {
    id: i32,
    issue_key: String,
    comment: String,
    seconds: f64,
    started: DateTime<Utc>,
}

fn skip(entry: &TimeEntry, reason: &str) -> SkippedEntry {
    let description = if entry.description.is_empty() {
        "(ohne Beschreibung)".to_owned()
    } else {
        entry.description.clone()
    };
    SkippedEntry {
        description,
        reason: reason.to_owned(),
    }
}

fn worklog(
    issue_key: String,
    seconds: f64,
    comment: String,
    started: DateTime<Utc>,
    ids: Vec<i32>,
) -> Worklog {
    let minutes = js_round(seconds / 60.0) as i32;
    Worklog {
        planned: PlannedWorklog {
            issue_key,
            time_spent: format_duration_hours_minutes(minutes),
            minutes,
            comment,
            entry_count: ids.len() as i32,
        },
        started,
        entry_ids: ids,
    }
}

/// Turns finished, unsubmitted entries of ONE day into worklogs. Grouped mode
/// would otherwise merge days into one worklog.
pub fn build_plan<Tz: TimeZone>(candidates: &[TimeEntry], s: &SettingsInput, tz: &Tz) -> Plan {
    let project_keys = &s.jira_project_keys;
    let mut plan = Plan::default();
    let mut valid: Vec<Valid> = Vec::new();

    for entry in candidates {
        // Never booked; callers filter them out already.
        if entry.is_allgemeines {
            continue;
        }
        let seconds = finished_seconds(
            &entry.started_at,
            entry.ended_at.as_deref(),
            &s.breaks,
            s.auto_pause_enabled,
            tz,
        );
        let parsed = parse_description(&entry.description, project_keys);
        let Some(issue_key) = parsed.issue_key else {
            plan.skipped.push(skip(entry, "Kein Issue-Key erkannt"));
            continue;
        };
        if js_round(seconds / 60.0) < 1.0 {
            plan.skipped.push(skip(entry, "Dauer unter 1 Minute"));
            continue;
        }
        valid.push(Valid {
            id: entry.id,
            issue_key,
            comment: parsed.comment,
            seconds,
            started: parse_iso(&entry.started_at).unwrap_or_default(),
        });
    }

    match s.booking_mode {
        BookingMode::Grouped => {
            // Groups in order of first appearance, like a JS Map.
            let mut groups: Vec<(String, Vec<Valid>)> = Vec::new();
            for v in valid {
                match groups.iter_mut().find(|(k, _)| *k == v.issue_key) {
                    Some((_, g)) => g.push(v),
                    None => groups.push((v.issue_key.clone(), vec![v])),
                }
            }
            for (issue_key, group) in groups {
                let seconds: f64 = group.iter().map(|v| v.seconds).sum();
                let mut comments: Vec<&str> = Vec::new();
                for v in &group {
                    if !v.comment.is_empty() && !comments.contains(&v.comment.as_str()) {
                        comments.push(&v.comment);
                    }
                }
                let comment = comments.join(", ");
                let started = group
                    .iter()
                    .map(|v| v.started)
                    .min()
                    .expect("group is not empty");
                let ids = group.iter().map(|v| v.id).collect();
                plan.worklogs
                    .push(worklog(issue_key, seconds, comment, started, ids));
            }
        }
        BookingMode::Individual => {
            for v in valid {
                plan.worklogs.push(worklog(
                    v.issue_key,
                    v.seconds,
                    v.comment,
                    v.started,
                    vec![v.id],
                ));
            }
        }
    }
    plan
}

/// The plan for local day `day_key` (`YYYY-MM-DD`).
pub fn plan_day<Tz: TimeZone>(
    conn: &Connection,
    day_key: &str,
    force: bool,
    tz: &Tz,
) -> Result<Plan> {
    let s = settings::get(conn)?.values;
    let date = parse_key(day_key).ok_or_else(|| Error::Validation("Ungültiger Tag.".into()))?;
    let from = crate::time::to_iso(local_midnight(date, tz));
    let to = crate::time::to_iso(local_midnight(date + chrono::Days::new(1), tz));
    let candidates = crate::store::bookable_entries_between(conn, &from, &to, force)?;
    Ok(build_plan(&candidates, &s, tz))
}

/// The plan for every day with open entries, newest day first.
pub fn plan_all_open<Tz: TimeZone>(conn: &Connection, force: bool, tz: &Tz) -> Result<Plan> {
    let s = settings::get(conn)?.values;
    let candidates = crate::store::bookable_entries(conn, force)?;
    let mut days: Vec<(String, Vec<TimeEntry>)> = Vec::new();
    for e in candidates {
        let key = day_key_of(&e.started_at, tz);
        match days.iter_mut().find(|(k, _)| *k == key) {
            Some((_, d)) => d.push(e),
            None => days.push((key, vec![e])),
        }
    }
    let mut plan = Plan::default();
    for (_, entries) in days {
        let p = build_plan(&entries, &s, tz);
        plan.worklogs.extend(p.worklogs);
        plan.skipped.extend(p.skipped);
    }
    Ok(plan)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SubmitResult {
    pub ok: bool,
    pub booked_worklogs: i32,
    pub booked_entries: i32,
    pub errors: Vec<String>,
    pub skipped: Vec<SkippedEntry>,
    pub message: Option<String>,
}

/// Sends the plan worklog by worklog. `api = None`: Jira is not configured.
/// `mark` records a sent worklog's entries as submitted; a failure there
/// counts as an error of that worklog, as in the old app.
pub fn submit(
    api: Option<&dyn JiraApi>,
    plan: Plan,
    mut mark: impl FnMut(&Worklog) -> Result<()>,
) -> SubmitResult {
    let mut result = SubmitResult {
        ok: true,
        booked_worklogs: 0,
        booked_entries: 0,
        errors: Vec::new(),
        skipped: plan.skipped,
        message: None,
    };
    let Some(api) = api else {
        result.ok = false;
        result.message =
            Some("Jira ist nicht vollständig konfiguriert (siehe Einstellungen).".into());
        return result;
    };
    if plan.worklogs.is_empty() {
        result.message = Some("Keine buchbaren Einträge gefunden.".into());
        return result;
    }
    for wl in &plan.worklogs {
        let request = WorklogRequest {
            issue_key: wl.planned.issue_key.clone(),
            time_spent: wl.planned.time_spent.clone(),
            started: wl.started,
            comment: wl.planned.comment.clone(),
        };
        let sent = api
            .post_worklog(&request)
            .and_then(|()| mark(wl).map_err(|e| e.to_string()));
        match sent {
            Ok(()) => {
                result.booked_worklogs += 1;
                result.booked_entries += wl.entry_ids.len() as i32;
            }
            Err(e) => result.errors.push(e),
        }
    }
    result.ok = result.errors.is_empty();
    result
}

/// Marks the entries of a sent worklog: `submitted_at`, the issue key, and
/// `updated_at`, all with the same instant.
pub fn mark_submitted(conn: &mut Connection, wl: &Worklog, now_iso: &str) -> Result<()> {
    let tx = conn.transaction()?;
    for id in &wl.entry_ids {
        tx.execute(
            "UPDATE time_entries SET submitted_at = ?1, jira_issue_key = ?2, updated_at = ?1 WHERE id = ?3",
            params![now_iso, wl.planned.issue_key, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;
    use crate::db::open_in_memory;
    use crate::settings::BreakWindow;
    use crate::store;
    use crate::timer::{self, EntryInput};
    use chrono_tz::Europe::Berlin;

    fn entry(id: i32, desc: &str, start: &str, end: &str) -> TimeEntry {
        TimeEntry {
            id,
            description: desc.into(),
            started_at: start.into(),
            ended_at: Some(end.into()),
            submitted_at: None,
            jira_issue_key: None,
            is_allgemeines: false,
            category: None,
        }
    }

    fn settings(mode: BookingMode) -> SettingsInput {
        let conn = open_in_memory().unwrap();
        let mut s = settings::get(&conn).unwrap().values;
        s.jira_project_keys = vec!["ABC".into(), "XY".into()];
        s.booking_mode = mode;
        s.breaks = vec![];
        s
    }

    #[test]
    fn formats_durations_like_jira() {
        assert_eq!(format_duration_hours_minutes(0), "0m");
        assert_eq!(format_duration_hours_minutes(59), "59m");
        assert_eq!(format_duration_hours_minutes(60), "1h 0m");
        assert_eq!(format_duration_hours_minutes(135), "2h 15m");
    }

    fn sample() -> Vec<TimeEntry> {
        // Newest first, as the store returns them.
        vec![
            entry(
                5,
                "Merk ABC-1 Review",
                "2026-11-10T12:00:00.000Z",
                "2026-11-10T12:30:00.000Z",
            ),
            entry(
                4,
                "kein key",
                "2026-11-10T11:00:00.000Z",
                "2026-11-10T11:10:00.000Z",
            ),
            entry(
                3,
                "xy-7",
                "2026-11-10T10:00:00.000Z",
                "2026-11-10T10:00:20.000Z",
            ),
            entry(
                2,
                "ABC-1 Review",
                "2026-11-10T09:00:00.000Z",
                "2026-11-10T09:15:00.000Z",
            ),
            entry(
                1,
                "ABC-1 Code",
                "2026-11-10T08:00:00.000Z",
                "2026-11-10T08:44:31.000Z",
            ),
            entry(
                0,
                "",
                "2026-11-10T07:00:00.000Z",
                "2026-11-10T07:30:00.000Z",
            ),
        ]
    }

    #[test]
    fn grouped_mode_merges_by_issue_and_skips_what_jira_cannot_take() {
        let plan = build_plan(&sample(), &settings(BookingMode::Grouped), &Berlin);
        assert_eq!(plan.worklogs.len(), 1);
        let w = &plan.worklogs[0];
        // 30 m + 15 m + 44 m 31 s = 89.52 m → 90
        assert_eq!(w.planned.minutes, 90);
        assert_eq!(w.planned.time_spent, "1h 30m");
        assert_eq!(w.planned.comment, "Review, Code");
        assert_eq!(w.planned.entry_count, 3);
        assert_eq!(w.entry_ids, vec![5, 2, 1]);
        assert_eq!(w.started, parse_iso("2026-11-10T08:00:00.000Z").unwrap());
        let reasons: Vec<_> = plan
            .skipped
            .iter()
            .map(|s| (s.description.as_str(), s.reason.as_str()))
            .collect();
        assert_eq!(
            reasons,
            vec![
                ("kein key", "Kein Issue-Key erkannt"),
                ("xy-7", "Dauer unter 1 Minute"),
                ("(ohne Beschreibung)", "Kein Issue-Key erkannt"),
            ]
        );
    }

    #[test]
    fn individual_mode_books_each_entry() {
        let plan = build_plan(&sample(), &settings(BookingMode::Individual), &Berlin);
        let got: Vec<_> = plan
            .worklogs
            .iter()
            .map(|w| {
                (
                    w.planned.issue_key.as_str(),
                    w.planned.minutes,
                    w.planned.comment.as_str(),
                )
            })
            .collect();
        assert_eq!(
            got,
            vec![
                ("ABC-1", 30, "Review"),
                ("ABC-1", 15, "Review"),
                ("ABC-1", 45, "Code")
            ]
        );
    }

    #[test]
    fn auto_pause_cuts_breaks_and_allgemeines_never_books() {
        let mut s = settings(BookingMode::Individual);
        s.auto_pause_enabled = true;
        s.breaks = vec![BreakWindow {
            start: "12:00".into(),
            end: "12:30".into(),
        }];
        let mut general = entry(
            9,
            "ABC-9",
            "2026-11-10T08:00:00.000Z",
            "2026-11-10T09:00:00.000Z",
        );
        general.is_allgemeines = true;
        // 10:30–11:30 UTC = 11:30–12:30 Berlin; the break takes 30 min.
        let e = entry(
            1,
            "ABC-2",
            "2026-11-10T10:30:00.000Z",
            "2026-11-10T11:30:00.000Z",
        );
        let plan = build_plan(&[general, e], &s, &Berlin);
        assert_eq!(plan.worklogs.len(), 1);
        assert_eq!(plan.worklogs[0].planned.minutes, 30);
        assert!(plan.skipped.is_empty());
    }

    fn manual(conn: &Connection, desc: &str, start: &str, end: &str) {
        timer::create_manual_entry(
            conn,
            &EntryInput {
                description: desc.into(),
                started_at: Some(start.into()),
                ended_at: Some(end.into()),
                is_allgemeines: None,
                category: None,
            },
        )
        .unwrap();
    }

    fn db() -> Connection {
        let conn = open_in_memory().unwrap();
        let mut s = settings::get(&conn).unwrap().values;
        s.jira_project_keys = vec!["ABC".into()];
        s.breaks = vec![];
        settings::update(&conn, &s).unwrap();
        // Berlin: 23:30 UTC on the 9th is already the 10th.
        manual(
            &conn,
            "ABC-1 a",
            "2026-11-09T23:30:00.000Z",
            "2026-11-10T00:00:00.000Z",
        );
        manual(
            &conn,
            "ABC-1 b",
            "2026-11-10T08:00:00.000Z",
            "2026-11-10T09:00:00.000Z",
        );
        manual(
            &conn,
            "ABC-1 c",
            "2026-11-09T08:00:00.000Z",
            "2026-11-09T08:30:00.000Z",
        );
        conn
    }

    #[test]
    fn day_and_all_open_plans_never_merge_days() {
        let conn = db();
        let day = plan_day(&conn, "2026-11-10", false, &Berlin).unwrap();
        assert_eq!(day.worklogs.len(), 1);
        assert_eq!(day.worklogs[0].planned.minutes, 90);
        assert_eq!(day.worklogs[0].planned.comment, "b, a");

        let all = plan_all_open(&conn, false, &Berlin).unwrap();
        let mins: Vec<_> = all.worklogs.iter().map(|w| w.planned.minutes).collect();
        assert_eq!(mins, vec![90, 30]);
        assert!(plan_day(&conn, "kaputt", false, &Berlin).is_err());
    }

    struct FakeJira {
        sent: RefCell<Vec<WorklogRequest>>,
        fail_key: Option<&'static str>,
    }

    impl JiraApi for FakeJira {
        fn post_worklog(&self, wl: &WorklogRequest) -> std::result::Result<(), String> {
            if self.fail_key == Some(wl.issue_key.as_str()) {
                return Err(format!(
                    "Jira lehnte die Anfrage ab ({}): HTTP 400",
                    wl.issue_key
                ));
            }
            self.sent.borrow_mut().push(wl.clone());
            Ok(())
        }
    }

    #[test]
    fn submit_marks_entries_and_force_books_them_again() {
        let mut conn = db();
        let jira = FakeJira {
            sent: RefCell::new(vec![]),
            fail_key: None,
        };
        let plan = plan_day(&conn, "2026-11-10", false, &Berlin).unwrap();
        let r = submit(Some(&jira), plan, |wl| {
            mark_submitted(&mut conn, wl, "2026-11-10T10:00:00.000Z")
        });
        assert!(r.ok);
        assert_eq!((r.booked_worklogs, r.booked_entries), (1, 2));
        assert_eq!(
            jira.sent.borrow()[0].started,
            parse_iso("2026-11-09T23:30:00.000Z").unwrap()
        );
        let marked: Vec<_> = store::all_entries(&conn)
            .unwrap()
            .into_iter()
            .filter(|e| e.submitted_at.is_some())
            .map(|e| (e.description, e.jira_issue_key))
            .collect();
        assert_eq!(marked.len(), 2);
        assert!(marked.iter().all(|(_, k)| k.as_deref() == Some("ABC-1")));

        // Submitted entries drop out, unless force booking is on.
        assert!(plan_day(&conn, "2026-11-10", false, &Berlin)
            .unwrap()
            .worklogs
            .is_empty());
        assert_eq!(
            plan_day(&conn, "2026-11-10", true, &Berlin)
                .unwrap()
                .worklogs
                .len(),
            1
        );
        let r = submit(
            Some(&jira),
            plan_day(&conn, "2026-11-10", false, &Berlin).unwrap(),
            |_| Ok(()),
        );
        assert_eq!(
            r.message.as_deref(),
            Some("Keine buchbaren Einträge gefunden.")
        );
        assert!(r.ok);
    }

    #[test]
    fn submit_reports_errors_and_missing_configuration() {
        let conn = db();
        let plan = plan_all_open(&conn, false, &Berlin).unwrap();
        let r = submit(None, plan.clone(), |_| Ok(()));
        assert!(!r.ok);
        assert_eq!(
            r.message.as_deref(),
            Some("Jira ist nicht vollständig konfiguriert (siehe Einstellungen).")
        );

        let jira = FakeJira {
            sent: RefCell::new(vec![]),
            fail_key: Some("ABC-1"),
        };
        let r = submit(Some(&jira), plan, |_| Ok(()));
        assert!(!r.ok);
        assert_eq!(r.errors.len(), 2);
        assert_eq!(r.booked_worklogs, 0);
    }
}
