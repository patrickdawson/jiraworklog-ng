use chrono::{DateTime, SecondsFormat, Utc};

/// An instant in the format the database stores everywhere. It is identical
/// to JavaScript's `Date.prototype.toISOString()`, e.g.
/// `2026-11-10T14:09:00.123Z`, so stored strings sort chronologically.
pub fn to_iso(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// The current instant as [`to_iso`].
pub fn now_iso() -> String {
    to_iso(Utc::now())
}

/// JavaScript's `Math.round`: halves round towards +∞ (`-2.5` → `-2`), unlike
/// `f64::round`, which rounds them away from zero.
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_iso_matches_the_javascript_format() {
        let s = now_iso();
        assert_eq!(s.len(), "2026-11-10T14:09:00.123Z".len(), "{s}");
        assert!(s.ends_with('Z'), "{s}");
        assert_eq!(&s[10..11], "T", "{s}");
    }

    #[test]
    fn js_round_rounds_halves_up() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(-2.6), -3.0);
    }
}
