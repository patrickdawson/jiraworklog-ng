//! The single settings row (`id = 1`). Port of `getSettings` (src/db/queries.ts),
//! `updateSettings` + `settingsSchema` (src/lib/actions.ts), src/lib/settings.ts
//! and `parseBreaks` (src/lib/work-time.ts).

use rusqlite::{Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{Error, Result};
use crate::time::now_iso;

/// How finished entries are turned into Jira worklogs.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum BookingMode {
    #[default]
    Grouped,
    Individual,
}

/// Which Jira credentials the user entered.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum JiraAuthMode {
    Token,
    #[default]
    Basic,
}

/// UI theme: follow the OS or force one.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}

/// A fixed daily break, e.g. lunch from `12:00` to `12:30`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct BreakWindow {
    pub start: String,
    pub end: String,
}

/// The editable settings, as the settings form sends them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInput {
    pub regular_work_minutes: i32,
    pub daily_target_minutes: i32,
    pub breaks: Vec<BreakWindow>,
    pub auto_pause_enabled: bool,
    pub booking_mode: BookingMode,
    pub data_retention_days: i32,
    pub jira_url: String,
    pub jira_project_keys: Vec<String>,
    pub jira_auth_mode: JiraAuthMode,
    pub jira_token: Option<String>,
    pub jira_user: Option<String>,
    pub jira_password: Option<String>,
    pub overtime_baseline_minutes: i32,
    pub theme_mode: ThemeMode,
    pub sprint_anchor_date: String,
    pub sprint_length_days: i32,
    pub concrete_issue_target_percent: i32,
    pub overtime_corridor_center_hours: i32,
    pub overtime_corridor_range_hours: i32,
    pub away_check_enabled: bool,
    /// How many suggestions the description dropdown offers.
    pub recent_entries_limit: i32,
}

/// Bounds of `recent_entries_limit`. The upper one keeps the dropdown usable.
pub const RECENT_ENTRIES_LIMIT_MIN: i32 = 1;
pub const RECENT_ENTRIES_LIMIT_MAX: i32 = 50;

/// The suggestion count to use, clamped in case the stored value is out of range.
pub fn recent_entries_limit(s: &SettingsInput) -> usize {
    s.recent_entries_limit
        .clamp(RECENT_ENTRIES_LIMIT_MIN, RECENT_ENTRIES_LIMIT_MAX) as usize
}

/// The stored settings: the editable values plus when they last changed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(flatten)]
    pub values: SettingsInput,
    pub updated_at: String,
}

/// Jira Cloud credentials: Atlassian e-mail + API token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JiraAuth {
    pub user: String,
    pub password: String,
}

const COLUMNS: &str = "regular_work_minutes, daily_target_minutes, breaks, auto_pause_enabled,
    booking_mode, data_retention_days, jira_url, jira_project_keys, jira_auth_mode, jira_token,
    jira_user, jira_password, overtime_baseline_minutes, theme_mode, sprint_anchor_date,
    sprint_length_days, concrete_issue_target_percent, overtime_corridor_center_hours,
    overtime_corridor_range_hours, away_check_enabled, recent_entries_limit, updated_at";

/// Returns the settings row, creating it with the column defaults on first use.
pub fn get(conn: &Connection) -> Result<Settings> {
    if let Some(s) = read(conn)? {
        return Ok(s);
    }
    conn.execute("INSERT INTO settings (id) VALUES (1)", [])?;
    Ok(read(conn)?.expect("settings row was just inserted"))
}

fn read(conn: &Connection) -> Result<Option<Settings>> {
    let sql = format!("SELECT {COLUMNS} FROM settings WHERE id = 1");
    Ok(conn.query_row(&sql, [], from_row).optional()?)
}

fn from_row(r: &Row) -> rusqlite::Result<Settings> {
    Ok(Settings {
        values: SettingsInput {
            regular_work_minutes: r.get(0)?,
            daily_target_minutes: r.get(1)?,
            breaks: parse_breaks(r.get::<_, Option<String>>(2)?.as_deref()),
            auto_pause_enabled: r.get(3)?,
            booking_mode: parse_enum(r.get(4)?),
            data_retention_days: r.get(5)?,
            jira_url: r.get(6)?,
            jira_project_keys: parse_project_keys(r.get::<_, Option<String>>(7)?.as_deref()),
            jira_auth_mode: parse_enum(r.get(8)?),
            jira_token: r.get(9)?,
            jira_user: r.get(10)?,
            jira_password: r.get(11)?,
            overtime_baseline_minutes: r.get(12)?,
            theme_mode: parse_enum(r.get(13)?),
            sprint_anchor_date: r.get(14)?,
            sprint_length_days: r.get(15)?,
            concrete_issue_target_percent: r.get(16)?,
            overtime_corridor_center_hours: r.get(17)?,
            overtime_corridor_range_hours: r.get(18)?,
            away_check_enabled: r.get(19)?,
            recent_entries_limit: r.get(20)?,
        },
        updated_at: r.get(21)?,
    })
}

/// Reads a stored enum value; anything unknown falls back to the default
/// instead of making the whole settings row unreadable.
fn parse_enum<T: for<'de> Deserialize<'de> + Default>(raw: String) -> T {
    serde_json::from_value(serde_json::Value::String(raw)).unwrap_or_default()
}

/// Saves the settings form. Same rules and normalisation as the old
/// `updateSettings` server action.
pub fn update(conn: &Connection, input: &SettingsInput) -> Result<()> {
    validate(input)?;
    get(conn)?; // ensure the row exists

    let breaks = serde_json::to_string(&input.breaks).expect("breaks serialise");
    let keys: Vec<String> = input
        .jira_project_keys
        .iter()
        .map(|k| k.trim().to_uppercase())
        .filter(|k| !k.is_empty())
        .collect();
    let keys = serde_json::to_string(&keys).expect("keys serialise");

    conn.execute(
        "UPDATE settings SET
            regular_work_minutes = ?1, daily_target_minutes = ?2, breaks = ?3,
            auto_pause_enabled = ?4, booking_mode = ?5, data_retention_days = ?6,
            jira_url = ?7, jira_project_keys = ?8, jira_auth_mode = ?9, jira_token = ?10,
            jira_user = ?11, jira_password = ?12, overtime_baseline_minutes = ?13,
            theme_mode = ?14, sprint_anchor_date = ?15, sprint_length_days = ?16,
            concrete_issue_target_percent = ?17, overtime_corridor_center_hours = ?18,
            overtime_corridor_range_hours = ?19, away_check_enabled = ?20,
            recent_entries_limit = ?21, updated_at = ?22
         WHERE id = 1",
        rusqlite::params![
            input.regular_work_minutes,
            input.daily_target_minutes,
            breaks,
            input.auto_pause_enabled,
            text(&input.booking_mode),
            input.data_retention_days,
            input.jira_url.trim(),
            keys,
            text(&input.jira_auth_mode),
            input.jira_token,
            input.jira_user,
            input.jira_password,
            input.overtime_baseline_minutes,
            text(&input.theme_mode),
            input.sprint_anchor_date,
            input.sprint_length_days,
            input.concrete_issue_target_percent,
            input.overtime_corridor_center_hours,
            input.overtime_corridor_range_hours,
            input.away_check_enabled,
            input.recent_entries_limit,
            now_iso(),
        ],
    )?;
    Ok(())
}

/// The stored text of a unit enum, e.g. `ThemeMode::Dark` → `"dark"`.
fn text<T: Serialize>(v: &T) -> String {
    match serde_json::to_value(v) {
        Ok(serde_json::Value::String(s)) => s,
        _ => unreachable!("unit enums serialise to strings"),
    }
}

/// The zod `settingsSchema`. Like the old action, any violation yields the
/// one message the form shows.
fn validate(s: &SettingsInput) -> Result<()> {
    let ok = (0..=1440).contains(&s.regular_work_minutes)
        && (0..=1440).contains(&s.daily_target_minutes)
        && s.breaks
            .iter()
            .all(|b| is_clock(&b.start) && is_clock(&b.end))
        && (1..=3650).contains(&s.data_retention_days)
        && is_date(&s.sprint_anchor_date)
        && (1..=365).contains(&s.sprint_length_days)
        && (0..=100).contains(&s.concrete_issue_target_percent)
        && (-9999..=9999).contains(&s.overtime_corridor_center_hours)
        && (1..=9999).contains(&s.overtime_corridor_range_hours)
        && (RECENT_ENTRIES_LIMIT_MIN..=RECENT_ENTRIES_LIMIT_MAX).contains(&s.recent_entries_limit);
    if ok {
        Ok(())
    } else {
        Err(Error::Validation("Ungültige Einstellungen.".into()))
    }
}

/// `^\d{1,2}:\d{2}$`
fn is_clock(s: &str) -> bool {
    matches!(s.split_once(':'), Some((h, m))
        if (1..=2).contains(&h.len()) && m.len() == 2 && all_digits(h) && all_digits(m))
}

/// `^\d{4}-\d{2}-\d{2}$`
fn is_date(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    matches!(parts.as_slice(), [y, m, d]
        if y.len() == 4 && m.len() == 2 && d.len() == 2 && parts.iter().all(|p| all_digits(p)))
}

fn all_digits(s: &str) -> bool {
    s.bytes().all(|b| b.is_ascii_digit())
}

/// Parses the `breaks` JSON column, dropping malformed entries.
pub fn parse_breaks(json: Option<&str>) -> Vec<BreakWindow> {
    let Some(items) = json
        .and_then(|j| serde_json::from_str::<serde_json::Value>(j).ok())
        .and_then(|v| v.as_array().cloned())
    else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|b| {
            let start = b.get("start")?.as_str()?;
            let end = b.get("end")?.as_str()?;
            (is_clock(start) && is_clock(end)).then(|| BreakWindow {
                start: start.to_owned(),
                end: end.to_owned(),
            })
        })
        .collect()
}

/// Parses the `jira_project_keys` JSON column into trimmed, upper-case keys.
pub fn parse_project_keys(json: Option<&str>) -> Vec<String> {
    let Some(items) = json
        .and_then(|j| serde_json::from_str::<serde_json::Value>(j).ok())
        .and_then(|v| v.as_array().cloned())
    else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|k| k.as_str())
        .map(str::trim)
        .filter(|k| !k.is_empty())
        .map(str::to_uppercase)
        .collect()
}

/// API token from settings: `jira_token`, or the legacy `jira_password`.
fn resolve_api_token(s: &SettingsInput) -> Option<String> {
    [&s.jira_token, &s.jira_password]
        .into_iter()
        .flatten()
        .map(|t| t.trim())
        .find(|t| !t.is_empty())
        .map(str::to_owned)
}

/// Jira Cloud auth, or `None` if the user or the token is missing.
pub fn derive_jira_auth(s: &SettingsInput) -> Option<JiraAuth> {
    let user = s
        .jira_user
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())?;
    let password = resolve_api_token(s)?;
    Some(JiraAuth {
        user: user.to_owned(),
        password,
    })
}

/// Whether Jira is configured well enough to attempt a booking.
pub fn is_jira_configured(s: &SettingsInput) -> bool {
    !s.jira_url.trim().is_empty() && derive_jira_auth(s).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn first_read_creates_the_row_with_column_defaults() {
        let conn = open_in_memory().unwrap();
        let s = get(&conn).unwrap().values;
        assert_eq!(s.regular_work_minutes, 420);
        assert_eq!(s.daily_target_minutes, 420);
        assert!(s.breaks.is_empty());
        assert!(s.auto_pause_enabled);
        assert_eq!(s.booking_mode, BookingMode::Grouped);
        assert_eq!(s.data_retention_days, 90);
        assert_eq!(
            s.jira_project_keys,
            ["DS", "TXAT", "TXPIV", "TXR", "TXRS", "TX4B", "TX3B", "TXAM", "PQX"]
        );
        // The column default from migration 0000, not the "basic" in schema.ts.
        assert_eq!(s.jira_auth_mode, JiraAuthMode::Token);
        assert_eq!(s.theme_mode, ThemeMode::System);
        assert_eq!(s.sprint_anchor_date, "2026-01-07");
        assert_eq!(s.overtime_corridor_center_hours, 100);
        assert_eq!(s.overtime_corridor_range_hours, 40);
        assert!(s.away_check_enabled);
        assert_eq!(s.recent_entries_limit, 15);
    }

    #[test]
    fn update_normalises_and_round_trips() {
        let conn = open_in_memory().unwrap();
        let mut input = get(&conn).unwrap().values;
        input.jira_url = "  https://example.atlassian.net  ".into();
        input.jira_project_keys = vec![" abc ".into(), "".into(), "Def".into()];
        input.breaks = vec![BreakWindow {
            start: "12:00".into(),
            end: "12:30".into(),
        }];
        input.theme_mode = ThemeMode::Dark;
        input.overtime_corridor_center_hours = -20;
        input.recent_entries_limit = 50;
        update(&conn, &input).unwrap();

        let s = get(&conn).unwrap().values;
        assert_eq!(s.jira_url, "https://example.atlassian.net");
        assert_eq!(s.jira_project_keys, ["ABC", "DEF"]);
        assert_eq!(s.breaks, input.breaks);
        assert_eq!(s.theme_mode, ThemeMode::Dark);
        assert_eq!(s.overtime_corridor_center_hours, -20);
        assert_eq!(s.recent_entries_limit, 50);

        let raw: String = conn
            .query_row("SELECT breaks FROM settings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(raw, r#"[{"start":"12:00","end":"12:30"}]"#); // = JSON.stringify
    }

    type Change = dyn Fn(&mut SettingsInput);

    #[test]
    fn update_rejects_out_of_range_values() {
        let conn = open_in_memory().unwrap();
        let base = get(&conn).unwrap().values;
        let cases: Vec<Box<Change>> = vec![
            Box::new(|s| s.regular_work_minutes = 1441),
            Box::new(|s| s.daily_target_minutes = -1),
            Box::new(|s| s.data_retention_days = 0),
            Box::new(|s| s.sprint_anchor_date = "7.1.2026".into()),
            Box::new(|s| s.sprint_length_days = 366),
            Box::new(|s| s.concrete_issue_target_percent = 101),
            Box::new(|s| s.overtime_corridor_range_hours = 0),
            Box::new(|s| s.recent_entries_limit = 0),
            Box::new(|s| s.recent_entries_limit = 51),
            Box::new(|s| {
                s.breaks = vec![BreakWindow {
                    start: "12".into(),
                    end: "12:30".into(),
                }]
            }),
        ];
        for change in cases {
            let mut input = base.clone();
            change(&mut input);
            let err = update(&conn, &input).unwrap_err();
            assert_eq!(err.to_string(), "Ungültige Einstellungen.");
        }
        assert_eq!(get(&conn).unwrap().values, base);
    }

    #[test]
    fn unknown_enum_values_fall_back_to_the_default() {
        let conn = open_in_memory().unwrap();
        get(&conn).unwrap();
        conn.execute("UPDATE settings SET theme_mode = 'neon'", [])
            .unwrap();
        assert_eq!(get(&conn).unwrap().values.theme_mode, ThemeMode::System);
    }

    #[test]
    fn recent_entries_limit_is_clamped_on_use() {
        let conn = open_in_memory().unwrap();
        let mut s = get(&conn).unwrap().values;
        assert_eq!(recent_entries_limit(&s), 15);
        s.recent_entries_limit = 500;
        assert_eq!(recent_entries_limit(&s), 50);
        s.recent_entries_limit = -3;
        assert_eq!(recent_entries_limit(&s), 1);
    }

    #[test]
    fn lenient_json_parsing() {
        assert!(parse_breaks(None).is_empty());
        assert!(parse_breaks(Some("not json")).is_empty());
        assert_eq!(
            parse_breaks(Some(r#"[{"start":"9:00","end":"9:15"},{"start":"x"},7]"#)).len(),
            1
        );
        assert_eq!(parse_project_keys(Some(r#"[" tx4b ", 3, ""]"#)), ["TX4B"]);
        assert!(parse_project_keys(Some("{}")).is_empty());
    }

    #[test]
    fn jira_auth_prefers_the_token_and_falls_back_to_the_password() {
        let conn = open_in_memory().unwrap();
        let mut s = get(&conn).unwrap().values;
        assert!(derive_jira_auth(&s).is_none());

        s.jira_user = Some(" me@example.com ".into());
        s.jira_password = Some("legacy".into());
        assert_eq!(derive_jira_auth(&s).unwrap().password, "legacy");

        s.jira_token = Some(" tok ".into());
        let auth = derive_jira_auth(&s).unwrap();
        assert_eq!(
            (auth.user.as_str(), auth.password.as_str()),
            ("me@example.com", "tok")
        );

        assert!(!is_jira_configured(&s));
        s.jira_url = "https://example.atlassian.net".into();
        assert!(is_jira_configured(&s));
    }
}
