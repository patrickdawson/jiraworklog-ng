use chrono::{SecondsFormat, Utc};

/// The current instant in the format the database stores everywhere. It is
/// identical to JavaScript's `new Date().toISOString()`, e.g.
/// `2026-11-10T14:09:00.123Z`.
pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
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
}
