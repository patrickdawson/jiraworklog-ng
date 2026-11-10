//! Splits a description `<Merksatz> <Projekt-Key> <Worklogtext>`.
//! Port of src/lib/parse-description.ts.

use regex::RegexBuilder;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDescription {
    /// Free-text label before the issue key; ignored for Jira.
    pub memo: String,
    /// Upper-cased Jira issue key, if one was found.
    pub issue_key: Option<String>,
    /// Worklog comment for Jira: the text after the issue key.
    pub comment: String,
}

/// Same pattern as the TS version, `(.*)((?:KEYS)-\d+)\s*(.*)` case-insensitive.
/// The greedy first group means the LAST key in the text wins.
pub fn parse_description(description: &str, project_keys: &[String]) -> ParsedDescription {
    let keys: Vec<String> = project_keys
        .iter()
        .map(|k| k.trim())
        .filter(|k| !k.is_empty())
        .map(regex::escape)
        .collect();

    if !keys.is_empty() {
        // [0-9] rather than \d: JavaScript's \d is ASCII-only.
        let pattern = format!(r"(.*)((?:{})-[0-9]+)\s*(.*)", keys.join("|"));
        let re = RegexBuilder::new(&pattern)
            .case_insensitive(true)
            .build()
            .expect("escaped keys form a valid pattern");
        if let Some(c) = re.captures(description) {
            return ParsedDescription {
                memo: c[1].trim().to_owned(),
                issue_key: Some(c[2].to_uppercase()),
                comment: c[3].trim().to_owned(),
            };
        }
    }

    ParsedDescription {
        memo: description.trim().to_owned(),
        issue_key: None,
        comment: description.trim().to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn splits_memo_key_and_comment() {
        let p = parse_description("Review tx4b-123 Code review done", &keys(&["TX4B", "TXR"]));
        assert_eq!(p.memo, "Review");
        assert_eq!(p.issue_key.as_deref(), Some("TX4B-123"));
        assert_eq!(p.comment, "Code review done");
    }

    #[test]
    fn last_key_wins_and_prefix_keys_do_not_shadow_longer_ones() {
        let p = parse_description("TXR-1 then TXRS-22 fix", &keys(&["TXR", "TXRS"]));
        assert_eq!(p.issue_key.as_deref(), Some("TXRS-22"));
        assert_eq!(p.memo, "TXR-1 then");
        assert_eq!(p.comment, "fix");
    }

    #[test]
    fn no_key_keeps_the_text_as_memo_and_comment() {
        let p = parse_description("  Meeting  ", &keys(&["TXR"]));
        assert_eq!(p.issue_key, None);
        assert_eq!(
            (p.memo.as_str(), p.comment.as_str()),
            ("Meeting", "Meeting")
        );
        assert_eq!(parse_description("TXR-1", &[]).issue_key, None);
    }

    #[test]
    fn keys_are_escaped() {
        let p = parse_description("A.B-7 x", &keys(&["A.B"]));
        assert_eq!(p.issue_key.as_deref(), Some("A.B-7"));
        assert_eq!(parse_description("AXB-7", &keys(&["A.B"])).issue_key, None);
    }
}
