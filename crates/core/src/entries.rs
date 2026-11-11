//! Time entries and the views built from them. Port of src/lib/entries.ts.

use std::collections::{BTreeMap, HashMap};

use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::days::{day_key, day_key_of, day_label, is_weekend_key, parse_iso};
use crate::description::parse_description;
use crate::settings::BreakWindow;
use crate::time::js_round;
use crate::work_time::effective_duration_seconds;

/// Report category of an Allgemeines entry.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, Type,
)]
pub enum AllgemeinesCategory {
    Projektorganisation,
    Implementierung,
    #[serde(rename = "QA")]
    Qa,
    Release,
}

impl AllgemeinesCategory {
    pub const DEFAULT: Self = Self::Projektorganisation;

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Projektorganisation => "Projektorganisation",
            Self::Implementierung => "Implementierung",
            Self::Qa => "QA",
            Self::Release => "Release",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        [
            Self::Projektorganisation,
            Self::Implementierung,
            Self::Qa,
            Self::Release,
        ]
        .into_iter()
        .find(|c| c.as_str() == s)
    }

    /// The category to store: concrete entries never carry one, Allgemeines
    /// entries fall back to the default.
    pub fn resolve(is_allgemeines: bool, category: Option<Self>) -> Option<Self> {
        is_allgemeines.then(|| category.unwrap_or(Self::DEFAULT))
    }
}

/// One row of `time_entries`. `ended_at = None`: the timer is still running.
#[derive(Debug, Clone, PartialEq)]
pub struct TimeEntry {
    pub id: i32,
    pub description: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub submitted_at: Option<String>,
    pub jira_issue_key: Option<String>,
    pub is_allgemeines: bool,
    pub category: Option<AllgemeinesCategory>,
}

/// What the entry analysis needs from the settings.
#[derive(Debug, Clone)]
pub struct AnalysisConfig {
    pub project_keys: Vec<String>,
    pub breaks: Vec<BreakWindow>,
    pub auto_pause: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EntryView {
    pub id: i32,
    pub description: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub submitted_at: Option<String>,
    pub jira_issue_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue_key: Option<String>,
    pub comment: String,
    #[specta(type = crate::JsNumber)]
    pub effective_seconds: f64,
    pub is_allgemeines: bool,
    pub category: Option<AllgemeinesCategory>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DescGroup {
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue_key: Option<String>,
    pub entries: Vec<EntryView>,
    #[specta(type = crate::JsNumber)]
    pub total_seconds: f64,
    pub all_submitted: bool,
    pub is_allgemeines: bool,
    pub category: Option<AllgemeinesCategory>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DayGroup {
    pub day_key: String,
    pub label: String,
    pub groups: Vec<DescGroup>,
    #[specta(type = crate::JsNumber)]
    pub total_seconds: f64,
    pub unsubmitted_count: i32,
}

/// One distinct piece of work the user can pick up again, merged across days.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub key: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue_key: Option<String>,
    pub is_allgemeines: bool,
    pub category: Option<AllgemeinesCategory>,
    pub count: i32,
    #[specta(type = crate::JsNumber)]
    pub total_seconds: f64,
    pub last_started_at: String,
}

/// How far back the "recently used" suggestions look.
pub const RECENT_WINDOW_DAYS: u32 = 30;
/// Days of history the Buchen page shows by default (same as the suggestions,
/// so the dropdown is never truncated by a shorter display window).
pub const DEFAULT_HISTORY_DAYS: u32 = RECENT_WINDOW_DAYS;
/// How many suggestions the timer dropdown offers at most.
pub const RECENT_LIMIT: usize = 8;

/// Identity of "the same piece of work": Allgemeines flag + category + the
/// trimmed description, case-sensitive.
pub fn desc_group_key(
    is_allgemeines: bool,
    category: Option<AllgemeinesCategory>,
    description: &str,
) -> String {
    let prefix = if is_allgemeines {
        format!("A:{}", category.map(|c| c.as_str()).unwrap_or(""))
    } else {
        "P".into()
    };
    format!("{prefix}|{}", description.trim())
}

/// Effective seconds of a finished entry; 0 for a running or broken one.
fn finished_seconds<Tz: TimeZone>(
    started_at: &str,
    ended_at: Option<&str>,
    breaks: &[BreakWindow],
    auto_pause: bool,
    tz: &Tz,
) -> f64 {
    match (parse_iso(started_at), ended_at.and_then(parse_iso)) {
        (Some(s), Some(e)) => effective_duration_seconds(s, Some(e), breaks, auto_pause, e, tz),
        _ => 0.0,
    }
}

pub fn to_entry_view<Tz: TimeZone>(e: &TimeEntry, cfg: &AnalysisConfig, tz: &Tz) -> EntryView {
    let parsed = parse_description(&e.description, &cfg.project_keys);
    EntryView {
        id: e.id,
        description: e.description.clone(),
        started_at: e.started_at.clone(),
        ended_at: e.ended_at.clone(),
        submitted_at: e.submitted_at.clone(),
        jira_issue_key: e.jira_issue_key.clone(),
        issue_key: parsed.issue_key,
        comment: parsed.comment,
        effective_seconds: finished_seconds(
            &e.started_at,
            e.ended_at.as_deref(),
            &cfg.breaks,
            cfg.auto_pause,
            tz,
        ),
        is_allgemeines: e.is_allgemeines,
        category: e.category,
    }
}

/// Finished entries grouped by local day (newest first), then by identical
/// description (newest first).
pub fn build_day_groups<Tz: TimeZone>(
    entries: &[TimeEntry],
    cfg: &AnalysisConfig,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Vec<DayGroup> {
    let mut by_day: BTreeMap<String, Vec<EntryView>> = BTreeMap::new();
    for e in entries.iter().filter(|e| e.ended_at.is_some()) {
        let view = to_entry_view(e, cfg, tz);
        by_day
            .entry(day_key_of(&view.started_at, tz))
            .or_default()
            .push(view);
    }

    let mut days: Vec<DayGroup> = by_day
        .into_iter()
        .map(|(key, day_entries)| {
            // Insertion-ordered grouping, like the JS Map.
            let mut order: Vec<String> = Vec::new();
            let mut by_desc: HashMap<String, Vec<EntryView>> = HashMap::new();
            for v in &day_entries {
                let k = desc_group_key(v.is_allgemeines, v.category, &v.description);
                by_desc
                    .entry(k.clone())
                    .or_insert_with(|| {
                        order.push(k);
                        Vec::new()
                    })
                    .push(v.clone());
            }
            let mut groups: Vec<DescGroup> = order
                .into_iter()
                .map(|k| {
                    let mut es = by_desc.remove(&k).expect("key was recorded");
                    es.sort_by(|a, b| b.started_at.cmp(&a.started_at));
                    let first = &es[0];
                    DescGroup {
                        description: first.description.clone(),
                        issue_key: first.issue_key.clone(),
                        total_seconds: es.iter().map(|e| e.effective_seconds).sum(),
                        all_submitted: es.iter().all(|e| e.submitted_at.is_some()),
                        is_allgemeines: first.is_allgemeines,
                        category: first.category,
                        entries: es,
                    }
                })
                .collect();
            groups.sort_by(|a, b| b.entries[0].started_at.cmp(&a.entries[0].started_at));

            DayGroup {
                label: day_label(&key, now, tz),
                total_seconds: groups.iter().map(|g| g.total_seconds).sum(),
                // Allgemeines entries are never booked, so they are not "open".
                unsubmitted_count: day_entries
                    .iter()
                    .filter(|e| e.submitted_at.is_none() && !e.is_allgemeines)
                    .count() as i32,
                day_key: key,
                groups,
            }
        })
        .collect();
    days.sort_by(|a, b| b.day_key.cmp(&a.day_key));
    days
}

/// The distinct pieces of work of the last `window_days`, most recent first
/// (tie-break: most used first), at most `limit`.
pub fn build_recent_entries<Tz: TimeZone>(
    days: &[DayGroup],
    now: DateTime<Utc>,
    window_days: u32,
    limit: usize,
    tz: &Tz,
) -> Vec<RecentEntry> {
    let cutoff = day_key(now - chrono::Duration::days(window_days.into()), tz);
    let mut order: Vec<String> = Vec::new();
    let mut merged: HashMap<String, RecentEntry> = HashMap::new();

    // `days` is newest first, so the first sighting carries the newest spelling.
    for day in days.iter().filter(|d| d.day_key >= cutoff) {
        for g in &day.groups {
            if g.description.trim().is_empty() {
                continue;
            }
            let key = desc_group_key(g.is_allgemeines, g.category, &g.description);
            let latest = &g.entries[0].started_at;
            match merged.get_mut(&key) {
                Some(r) => {
                    r.count += g.entries.len() as i32;
                    r.total_seconds += g.total_seconds;
                    if *latest > r.last_started_at {
                        r.last_started_at = latest.clone();
                    }
                }
                None => {
                    order.push(key.clone());
                    merged.insert(
                        key.clone(),
                        RecentEntry {
                            key,
                            description: g.description.clone(),
                            issue_key: g.issue_key.clone(),
                            is_allgemeines: g.is_allgemeines,
                            category: g.category,
                            count: g.entries.len() as i32,
                            total_seconds: g.total_seconds,
                            last_started_at: latest.clone(),
                        },
                    );
                }
            }
        }
    }

    let mut list: Vec<RecentEntry> = order
        .into_iter()
        .filter_map(|k| merged.remove(&k))
        .collect();
    list.sort_by(|a, b| {
        b.last_started_at
            .cmp(&a.last_started_at)
            .then(b.count.cmp(&a.count))
    });
    list.truncate(limit);
    list
}

/// The columns the per-day aggregate needs.
#[derive(Debug, Clone)]
pub struct DurationRow {
    pub started_at: String,
    pub ended_at: Option<String>,
    pub is_allgemeines: bool,
}

/// Effective seconds per local day for finished entries: all of them
/// (`worked`) and the non-Allgemeines ones (`concrete`).
pub struct SecondsByDay {
    pub worked: BTreeMap<String, f64>,
    pub concrete: BTreeMap<String, f64>,
}

pub fn seconds_by_day<Tz: TimeZone>(
    rows: &[DurationRow],
    breaks: &[BreakWindow],
    auto_pause: bool,
    tz: &Tz,
) -> SecondsByDay {
    let mut out = SecondsByDay {
        worked: BTreeMap::new(),
        concrete: BTreeMap::new(),
    };
    for r in rows.iter().filter(|r| r.ended_at.is_some()) {
        let seconds =
            finished_seconds(&r.started_at, r.ended_at.as_deref(), breaks, auto_pause, tz);
        let key = day_key_of(&r.started_at, tz);
        *out.worked.entry(key.clone()).or_default() += seconds;
        if !r.is_allgemeines {
            *out.concrete.entry(key).or_default() += seconds;
        }
    }
    out
}

/// Overtime balance in minutes: per tracked day, worked minutes minus the
/// target (weekdays only), plus the carried-in baseline. Rounded like JS.
pub fn overtime_balance_minutes(
    worked_by_day: &BTreeMap<String, f64>,
    regular_minutes: i32,
    baseline: i32,
) -> i32 {
    let mut balance = f64::from(baseline);
    for (key, seconds) in worked_by_day {
        let target = if is_weekend_key(key) {
            0.0
        } else {
            f64::from(regular_minutes)
        };
        balance += seconds / 60.0 - target;
    }
    js_round(balance) as i32
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BalancePoint {
    pub key: String,
    pub minutes: i32,
}

/// The overtime balance at the end of each day in `day_keys`, by the rule of
/// [`overtime_balance_minutes`]. Days before the first key still count, so the
/// last point matches the KPI. Days before the first tracked day and after
/// `today_key` are left out.
pub fn overtime_balance_series(
    worked_by_day: &BTreeMap<String, f64>,
    regular_minutes: i32,
    day_keys: &[String],
    today_key: &str,
    baseline: i32,
) -> Vec<BalancePoint> {
    let Some(first_tracked) = worked_by_day.keys().next() else {
        return Vec::new();
    };
    let visible: Vec<&String> = day_keys
        .iter()
        .filter(|k| *k >= first_tracked && k.as_str() <= today_key)
        .collect();
    let Some(first_visible) = visible.first() else {
        return Vec::new();
    };

    let delta = |key: &str| match worked_by_day.get(key) {
        Some(seconds) if is_weekend_key(key) => seconds / 60.0,
        Some(seconds) => seconds / 60.0 - f64::from(regular_minutes),
        None => 0.0,
    };

    let mut balance = f64::from(baseline);
    for key in worked_by_day.keys().take_while(|k| k < first_visible) {
        balance += delta(key);
    }
    visible
        .into_iter()
        .map(|key| {
            balance += delta(key);
            BalancePoint {
                key: key.clone(),
                minutes: js_round(balance) as i32,
            }
        })
        .collect()
}

/// The key a group color is stored under: `issue:<KEY>` for concrete entries,
/// `cat:<category>` for Allgemeines. Concrete entries without a key have none.
pub fn group_color_key(
    is_allgemeines: bool,
    category: Option<AllgemeinesCategory>,
    issue_key: Option<&str>,
) -> Option<String> {
    if is_allgemeines {
        category.map(|c| format!("cat:{}", c.as_str()))
    } else {
        issue_key.map(|k| format!("issue:{}", k.to_uppercase()))
    }
}

/// The "Zeit pro Ticket" bucket of an entry; stable across requests.
pub fn group_total_id(e: &EntryView) -> String {
    group_color_key(e.is_allgemeines, e.category, e.issue_key.as_deref())
        .unwrap_or_else(|| "none".into())
}

/// Worked time of one ticket (concrete) or category (Allgemeines).
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupTotal {
    pub id: String,
    /// Group color key; `None` for concrete entries without an issue key.
    pub key: Option<String>,
    /// The ticket of a concrete group.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue_key: Option<String>,
    pub label: String,
    pub is_allgemeines: bool,
    #[specta(type = crate::JsNumber)]
    pub seconds: f64,
}

/// Worked time per ticket or category, largest first (stable for ties).
/// Concrete entries without an issue key share one bucket.
pub fn seconds_by_group(entries: &[EntryView]) -> Vec<GroupTotal> {
    let mut totals: Vec<GroupTotal> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for e in entries.iter().filter(|e| e.effective_seconds > 0.0) {
        let id = group_total_id(e);
        let i = *index.entry(id.clone()).or_insert_with(|| {
            totals.push(GroupTotal {
                key: group_color_key(e.is_allgemeines, e.category, e.issue_key.as_deref()),
                issue_key: if e.is_allgemeines {
                    None
                } else {
                    e.issue_key.clone()
                },
                label: if e.is_allgemeines {
                    format!("Allgemein · {}", e.category.map_or("—", |c| c.as_str()))
                } else {
                    e.issue_key
                        .clone()
                        .unwrap_or_else(|| "kein Issue-Key".into())
                },
                is_allgemeines: e.is_allgemeines,
                seconds: 0.0,
                id,
            });
            totals.len() - 1
        });
        totals[i].seconds += e.effective_seconds;
    }
    totals.sort_by(|a, b| b.seconds.total_cmp(&a.seconds));
    totals
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono_tz::Europe::Berlin;

    fn cfg() -> AnalysisConfig {
        AnalysisConfig {
            project_keys: vec!["TXR".into(), "TX4B".into()],
            breaks: vec![],
            auto_pause: true,
        }
    }

    fn entry(id: i32, desc: &str, start: &str, end: Option<&str>) -> TimeEntry {
        TimeEntry {
            id,
            description: desc.into(),
            started_at: start.into(),
            ended_at: end.map(Into::into),
            submitted_at: None,
            jira_issue_key: None,
            is_allgemeines: false,
            category: None,
        }
    }

    fn now() -> DateTime<Utc> {
        parse_iso("2026-11-10T15:00:00.000Z").unwrap()
    }

    #[test]
    fn groups_by_local_day_then_description() {
        let entries = vec![
            entry(
                1,
                "Fix TXR-1 a",
                "2026-11-10T08:00:00.000Z",
                Some("2026-11-10T09:00:00.000Z"),
            ),
            entry(
                2,
                "Fix TXR-1 a",
                "2026-11-10T10:00:00.000Z",
                Some("2026-11-10T10:30:00.000Z"),
            ),
            entry(
                3,
                "Other",
                "2026-11-10T09:00:00.000Z",
                Some("2026-11-10T09:15:00.000Z"),
            ),
            // 23:30 UTC on the 9th is the 10th in Berlin.
            entry(
                4,
                "Late",
                "2026-11-09T23:30:00.000Z",
                Some("2026-11-09T23:45:00.000Z"),
            ),
            entry(
                5,
                "Older",
                "2026-11-03T08:00:00.000Z",
                Some("2026-11-03T08:10:00.000Z"),
            ),
            entry(6, "Running", "2026-11-10T14:00:00.000Z", None),
        ];
        let days = build_day_groups(&entries, &cfg(), now(), &Berlin);

        assert_eq!(
            days.iter().map(|d| d.day_key.as_str()).collect::<Vec<_>>(),
            ["2026-11-10", "2026-11-03"]
        );
        let today = &days[0];
        assert_eq!(today.label, "Heute");
        assert_eq!(
            today
                .groups
                .iter()
                .map(|g| g.description.as_str())
                .collect::<Vec<_>>(),
            ["Fix TXR-1 a", "Other", "Late"]
        );
        let fix = &today.groups[0];
        assert_eq!(fix.entries.iter().map(|e| e.id).collect::<Vec<_>>(), [2, 1]);
        assert_eq!(fix.total_seconds, 5400.0);
        assert_eq!(fix.issue_key.as_deref(), Some("TXR-1"));
        assert_eq!(today.total_seconds, 5400.0 + 900.0 + 900.0);
        assert_eq!(today.unsubmitted_count, 4);
        assert_eq!(days[1].label, "Dienstag, 03.11.2026");
    }

    #[test]
    fn recents_merge_across_days_and_respect_the_window() {
        let mut a = entry(
            1,
            "Fix TXR-1 a",
            "2026-11-09T08:00:00.000Z",
            Some("2026-11-09T09:00:00.000Z"),
        );
        a.is_allgemeines = false;
        let entries = vec![
            a,
            entry(
                2,
                "Fix TXR-1 a ",
                "2026-11-10T08:00:00.000Z",
                Some("2026-11-10T08:30:00.000Z"),
            ),
            entry(
                3,
                "Meeting",
                "2026-11-10T09:00:00.000Z",
                Some("2026-11-10T09:30:00.000Z"),
            ),
            entry(
                4,
                "   ",
                "2026-11-10T11:00:00.000Z",
                Some("2026-11-10T11:30:00.000Z"),
            ),
            entry(
                5,
                "Ancient",
                "2026-09-01T08:00:00.000Z",
                Some("2026-09-01T09:00:00.000Z"),
            ),
        ];
        let days = build_day_groups(&entries, &cfg(), now(), &Berlin);
        let recents = build_recent_entries(&days, now(), RECENT_WINDOW_DAYS, RECENT_LIMIT, &Berlin);

        assert_eq!(
            recents
                .iter()
                .map(|r| r.description.as_str())
                .collect::<Vec<_>>(),
            ["Meeting", "Fix TXR-1 a "]
        );
        let fix = &recents[1];
        assert_eq!(fix.count, 2);
        assert_eq!(fix.total_seconds, 5400.0);
        assert_eq!(fix.last_started_at, "2026-11-10T08:00:00.000Z");
        assert_eq!(fix.key, "P|Fix TXR-1 a");
    }

    #[test]
    fn group_key_includes_flag_and_category() {
        assert_eq!(desc_group_key(false, None, " x "), "P|x");
        assert_eq!(
            desc_group_key(true, Some(AllgemeinesCategory::Qa), "x"),
            "A:QA|x"
        );
        assert_eq!(desc_group_key(true, None, "x"), "A:|x");
    }

    #[test]
    fn overtime_counts_weekends_fully_and_rounds_like_js() {
        let mut worked = BTreeMap::new();
        worked.insert("2026-11-09".to_string(), 8.0 * 3600.0); // Mon: +60
        worked.insert("2026-11-14".to_string(), 3600.0); // Sat: +60
        worked.insert("2026-11-10".to_string(), 6.0 * 3600.0 + 30.0); // Tue: -59.5
        assert_eq!(overtime_balance_minutes(&worked, 420, 10), 71); // 70.5 → 71
        let mut minus = BTreeMap::new();
        minus.insert("2026-11-10".to_string(), 30.0); // -419.5
        assert_eq!(overtime_balance_minutes(&minus, 420, 0), -419);
    }

    #[test]
    fn balance_series_starts_at_the_first_tracked_day_and_stops_today() {
        let mut worked = BTreeMap::new();
        worked.insert("2026-11-02".to_string(), 8.0 * 3600.0); // Mon: +60
        worked.insert("2026-11-04".to_string(), 6.0 * 3600.0); // Wed: -60
        worked.insert("2026-11-07".to_string(), 3600.0); // Sat: +60
        worked.insert("2026-11-09".to_string(), 7.0 * 3600.0 + 30.0); // Mon: +0.5
        let keys: Vec<String> = (3..=12).map(|d| format!("2026-11-{d:02}")).collect();
        let series = overtime_balance_series(&worked, 420, &keys, "2026-11-10", 5);
        let got: Vec<(&str, i32)> = series.iter().map(|p| (p.key.as_str(), p.minutes)).collect();
        // The 2nd lies before the shown days but still counts: 5 + 60.
        assert_eq!(
            got,
            [
                ("2026-11-03", 65),
                ("2026-11-04", 5),
                ("2026-11-05", 5),
                ("2026-11-06", 5),
                ("2026-11-07", 65),
                ("2026-11-08", 65),
                ("2026-11-09", 66), // 65.5 rounds up like JS
                ("2026-11-10", 66),
            ]
        );
        // The last point matches the KPI over the same history.
        assert_eq!(overtime_balance_minutes(&worked, 420, 5), 66);
        assert!(overtime_balance_series(&BTreeMap::new(), 420, &keys, "2026-11-10", 0).is_empty());
        let early: Vec<String> = vec!["2026-10-01".into()];
        assert!(overtime_balance_series(&worked, 420, &early, "2026-11-10", 0).is_empty());
    }

    #[test]
    fn group_totals_bucket_by_ticket_and_category() {
        let mut views: Vec<EntryView> = [
            (1, "Fix TXR-1 a", "08:00", "09:00"),
            (2, "TXR-1 b", "09:00", "09:30"),
            (3, "no key", "10:00", "12:00"),
            (4, "Meeting", "12:00", "12:30"),
            (5, "zero", "13:00", "13:00"),
        ]
        .iter()
        .map(|(id, desc, from, to)| {
            let e = entry(
                *id,
                desc,
                &format!("2026-11-10T{from}:00.000Z"),
                Some(&format!("2026-11-10T{to}:00.000Z")),
            );
            to_entry_view(&e, &cfg(), &Berlin)
        })
        .collect();
        views[3].is_allgemeines = true;
        views[3].category = Some(AllgemeinesCategory::Qa);

        let totals = seconds_by_group(&views);
        let got: Vec<(&str, Option<&str>, &str, f64)> = totals
            .iter()
            .map(|t| (t.id.as_str(), t.key.as_deref(), t.label.as_str(), t.seconds))
            .collect();
        assert_eq!(
            got,
            [
                ("none", None, "kein Issue-Key", 7200.0),
                ("issue:TXR-1", Some("issue:TXR-1"), "TXR-1", 5400.0),
                ("cat:QA", Some("cat:QA"), "Allgemein · QA", 1800.0),
            ]
        );
        assert_eq!(totals[1].issue_key.as_deref(), Some("TXR-1"));
        assert_eq!(totals[2].issue_key, None);
    }

    #[test]
    fn category_resolution() {
        use AllgemeinesCategory as C;
        assert_eq!(C::resolve(false, Some(C::Qa)), None);
        assert_eq!(C::resolve(true, None), Some(C::Projektorganisation));
        assert_eq!(C::resolve(true, Some(C::Release)), Some(C::Release));
        assert_eq!(C::parse("QA"), Some(C::Qa));
        assert_eq!(C::parse("qa"), None);
    }
}
