//! Jira Cloud REST client: post a worklog, check credentials.
//! Port of src/lib/jira/*.ts and `testJiraConnection` in src/lib/actions.ts.
//!
//! Auth is always Basic with the Atlassian e-mail and an API token, as in the
//! old app (`jira_auth_mode` is stored but never changed the request).
//!
//! TLS: the old app switched certificate checks off unless `JIRA_TLS_STRICT=1`.
//! This client keeps them on and trusts the Windows certificate store
//! (native-tls / SChannel), which also holds corporate CAs.

use std::time::Duration;

use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use ureq::Agent;

use crate::settings::{self, JiraAuth, SettingsInput};
use crate::time::to_iso;

/// Jira REST API base path.
pub const REST_API_PREFIX: &str = "/rest/api/2";

/// Upper bound for one request. The old fetch had none; a hanging proxy should
/// not block a booking forever.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

pub fn trim_url(url: &str) -> &str {
    url.trim_end_matches('/')
}

/// `{jira_url}/rest/api/2{path}`; `path` gets a leading `/` if it lacks one.
pub fn api_url(jira_url: &str, path: &str) -> String {
    let sep = if path.starts_with('/') { "" } else { "/" };
    format!("{}{REST_API_PREFIX}{sep}{path}", trim_url(jira_url))
}

pub fn auth_header(auth: &JiraAuth) -> String {
    let raw = format!("{}:{}", auth.user.trim(), auth.password.trim());
    format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(raw)
    )
}

/// Jira's `started` format, e.g. `2026-05-19T10:00:00.000+0000`.
pub fn to_jira_timestamp(at: DateTime<Utc>) -> String {
    to_iso(at).replace('Z', "+0000")
}

/// `HTTP <status> <text>` plus Jira's `errorMessages` / `errors` when the body
/// carries them, else the first 200 characters of the body.
pub fn format_http_error_body(status: u16, status_text: &str, body: &str) -> String {
    let base = format!("HTTP {status} {status_text}");
    if body.trim().is_empty() {
        return base;
    }
    let head: String = body.chars().take(200).collect();
    let Ok(data) = serde_json::from_str::<serde_json::Value>(body) else {
        return format!("{base} — {head}");
    };
    let mut lines: Vec<String> = Vec::new();
    if let Some(msgs) = data.get("errorMessages").and_then(|v| v.as_array()) {
        lines.extend(
            msgs.iter()
                .filter_map(|m| m.as_str())
                .filter(|m| !m.is_empty())
                .map(str::to_owned),
        );
    }
    if let Some(errors) = data.get("errors").and_then(|v| v.as_object()) {
        for (field, msg) in errors {
            match msg.as_str() {
                Some(m) if !m.is_empty() => lines.push(format!("{field}: {m}")),
                _ => {}
            }
        }
    }
    if lines.is_empty() {
        format!("{base} — {head}")
    } else {
        format!("{base} — {}", lines.join("; "))
    }
}

/// User-facing text when the server cannot be reached at all.
pub fn format_fetch_error(detail: &str) -> String {
    let lower = detail.to_lowercase();
    let tls = [
        "unable to verify",
        "certificate",
        "self signed",
        "cert",
        "tls",
        "ssl",
    ]
    .iter()
    .any(|needle| lower.contains(needle));
    if tls {
        format!(
            "Keine Verbindung zum Server (TLS/Zertifikat). Bei Proxy oder Sonderzertifikaten \
             muss das Zertifikat in Windows als vertrauenswürdig hinterlegt sein. ({detail})"
        )
    } else {
        format!("Keine Verbindung zum Server. Bitte Jira-URL prüfen. ({detail})")
    }
}

const REDIRECT: &str =
    "Redirect erkannt (z.B. http→https). Bitte Jira-URL direkt auf HTTPS setzen.";

/// One worklog as Jira receives it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorklogRequest {
    pub issue_key: String,
    /// Jira `timeSpent`, e.g. `1h 30m`.
    pub time_spent: String,
    pub started: DateTime<Utc>,
    pub comment: String,
}

/// The request body of `POST /issue/{key}/worklog`. Field order as in the old app.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorklogBody<'a> {
    time_spent: &'a str,
    started: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    comment: Option<&'a str>,
}

/// What the booking needs from Jira. A trait so tests can book without HTTP.
pub trait JiraApi {
    /// Posts one worklog. `Err` carries the German message the UI shows.
    fn post_worklog(&self, wl: &WorklogRequest) -> Result<(), String>;
}

/// The real client.
pub struct HttpJira {
    base_url: String,
    auth: JiraAuth,
    agent: Agent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CredentialCheck {
    Ok { display_name: String },
    Failed { reason: String },
}

struct RawResponse {
    status: u16,
    status_text: String,
    body: String,
}

impl HttpJira {
    pub fn new(base_url: &str, auth: JiraAuth) -> Self {
        let tls = TlsConfig::builder()
            .provider(TlsProvider::NativeTls)
            .root_certs(RootCerts::PlatformVerifier)
            .build();
        let agent: Agent = Agent::config_builder()
            .tls_config(tls)
            .http_status_as_error(false)
            // 0 = do not follow: a redirect comes back as a 3xx response.
            .max_redirects(0)
            .timeout_global(Some(REQUEST_TIMEOUT))
            .build()
            .into();
        Self {
            base_url: base_url.trim().to_owned(),
            auth,
            agent,
        }
    }

    /// The client for the saved settings, or `None` if URL, e-mail or token
    /// is missing.
    pub fn from_settings(s: &SettingsInput) -> Option<Self> {
        if s.jira_url.trim().is_empty() {
            return None;
        }
        let auth = settings::derive_jira_auth(s)?;
        Some(Self::new(&s.jira_url, auth))
    }

    fn read(mut res: ureq::http::Response<ureq::Body>) -> RawResponse {
        let status = res.status();
        RawResponse {
            status: status.as_u16(),
            status_text: status.canonical_reason().unwrap_or("").to_owned(),
            body: res.body_mut().read_to_string().unwrap_or_default(),
        }
    }

    /// `GET /rest/api/2/myself`.
    pub fn check_credentials(&self) -> CredentialCheck {
        let failed = |reason: String| CredentialCheck::Failed { reason };
        let res = match self
            .agent
            .get(api_url(&self.base_url, "/myself"))
            .header("Authorization", auth_header(&self.auth))
            .header("Accept", "application/json")
            .call()
        {
            Ok(r) => Self::read(r),
            Err(e) => return failed(format_fetch_error(&e.to_string())),
        };
        match res.status {
            300..=399 => failed(REDIRECT.to_owned()),
            401 => failed("E-Mail / API-Token ist falsch.".to_owned()),
            403 => failed(
                "Jira hat das Konto abgelehnt. Bitte im Browser anmelden und ggf. Captcha lösen."
                    .to_owned(),
            ),
            200..=299 => {
                let name = serde_json::from_str::<serde_json::Value>(&res.body)
                    .ok()
                    .and_then(|v| v.get("displayName")?.as_str().map(str::to_owned))
                    .unwrap_or_else(|| "unbekannt".to_owned());
                CredentialCheck::Ok { display_name: name }
            }
            _ => failed(format_http_error_body(
                res.status,
                &res.status_text,
                &res.body,
            )),
        }
    }
}

impl JiraApi for HttpJira {
    fn post_worklog(&self, wl: &WorklogRequest) -> Result<(), String> {
        let key = &wl.issue_key;
        let comment = wl.comment.trim();
        let body = WorklogBody {
            time_spent: &wl.time_spent,
            started: to_jira_timestamp(wl.started),
            comment: (!comment.is_empty()).then_some(comment),
        };
        let res = self
            .agent
            .post(api_url(&self.base_url, &format!("/issue/{key}/worklog")))
            .header("Authorization", auth_header(&self.auth))
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .send(serde_json::to_string(&body).expect("worklog body serializes"))
            .map(Self::read)
            .map_err(|e| format!("{} ({key})", format_fetch_error(&e.to_string())))?;
        match res.status {
            300..=399 => Err(format!(
                "Redirect erkannt (z.B. http→https). Bitte Jira-URL direkt auf HTTPS setzen. ({key})"
            )),
            200..=299 => Ok(()),
            _ => Err(format!(
                "Jira lehnte die Anfrage ab ({key}): {}",
                format_http_error_body(res.status, &res.status_text, &res.body)
            )),
        }
    }
}

/// The unsaved values of the settings form for "Verbindung testen".
#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestInput {
    pub jira_url: String,
    pub jira_token: Option<String>,
    pub jira_user: Option<String>,
    pub jira_password: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct ConnectionTestResult {
    pub ok: bool,
    pub message: String,
}

/// Checks the form values before any request: URL, e-mail and token present.
pub fn connection_test_target(input: &ConnectionTestInput) -> Result<(String, JiraAuth), String> {
    let url = input.jira_url.trim();
    if url.is_empty() {
        return Err("Bitte zuerst eine Jira-URL angeben.".to_owned());
    }
    let nonempty = |v: &Option<String>| {
        v.as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(str::to_owned)
    };
    let user = nonempty(&input.jira_user);
    let password = nonempty(&input.jira_token).or_else(|| nonempty(&input.jira_password));
    let (Some(user), Some(password)) = (user, password) else {
        return Err("Bitte Atlassian-E-Mail und API-Token angeben.".to_owned());
    };
    if !user.contains('@') {
        return Err("Bitte die Atlassian-Konto-E-Mail-Adresse angeben.".to_owned());
    }
    Ok((url.to_owned(), JiraAuth { user, password }))
}

/// Tests credentials without saving them. Blocking (one HTTP request).
pub fn test_connection(input: &ConnectionTestInput) -> ConnectionTestResult {
    let (url, auth) = match connection_test_target(input) {
        Ok(t) => t,
        Err(message) => return ConnectionTestResult { ok: false, message },
    };
    match HttpJira::new(&url, auth).check_credentials() {
        CredentialCheck::Ok { display_name } => ConnectionTestResult {
            ok: true,
            message: format!("Verbunden als {display_name}."),
        },
        CredentialCheck::Failed { reason } => ConnectionTestResult {
            ok: false,
            message: reason,
        },
    }
}

#[cfg(test)]
pub(crate) mod mock {
    //! A one-thread HTTP server for tests: answers each request with the next
    //! canned response and records what it received.

    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use std::thread;

    #[derive(Debug, Clone)]
    pub struct Received {
        pub method: String,
        pub path: String,
        pub headers: Vec<(String, String)>,
        pub body: String,
    }

    impl Received {
        pub fn header(&self, name: &str) -> Option<&str> {
            self.headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(name))
                .map(|(_, v)| v.as_str())
        }
    }

    pub struct MockServer {
        pub url: String,
        pub received: Arc<Mutex<Vec<Received>>>,
    }

    /// `responses`: (status line, extra headers, body), served in order.
    pub fn start(responses: Vec<(&'static str, &'static str, &'static str)>) -> MockServer {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let received = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&received);
        thread::spawn(move || {
            for (status, extra, body) in responses {
                let Ok((stream, _)) = listener.accept() else {
                    return;
                };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let mut parts = line.split_whitespace();
                let method = parts.next().unwrap_or("").to_owned();
                let path = parts.next().unwrap_or("").to_owned();
                let mut headers = Vec::new();
                loop {
                    let mut h = String::new();
                    reader.read_line(&mut h).unwrap();
                    let h = h.trim_end();
                    if h.is_empty() {
                        break;
                    }
                    if let Some((k, v)) = h.split_once(':') {
                        headers.push((k.trim().to_owned(), v.trim().to_owned()));
                    }
                }
                let len: usize = headers
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                    .and_then(|(_, v)| v.parse().ok())
                    .unwrap_or(0);
                let mut buf = vec![0; len];
                reader.read_exact(&mut buf).unwrap();
                log.lock().unwrap().push(Received {
                    method,
                    path,
                    headers,
                    body: String::from_utf8(buf).unwrap(),
                });
                let mut stream = stream;
                let resp = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(resp.as_bytes()).unwrap();
            }
        });
        MockServer { url, received }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::days::parse_iso;

    fn auth() -> JiraAuth {
        JiraAuth {
            user: " me@example.com ".into(),
            password: "tok ".into(),
        }
    }

    #[test]
    fn builds_urls_and_headers_like_the_old_client() {
        assert_eq!(
            api_url("https://x.atlassian.net//", "/myself"),
            "https://x.atlassian.net/rest/api/2/myself"
        );
        assert_eq!(api_url("https://x", "issue"), "https://x/rest/api/2/issue");
        // base64("me@example.com:tok")
        assert_eq!(auth_header(&auth()), "Basic bWVAZXhhbXBsZS5jb206dG9r");
        assert_eq!(
            to_jira_timestamp(parse_iso("2026-05-19T10:00:00.000Z").unwrap()),
            "2026-05-19T10:00:00.000+0000"
        );
    }

    #[test]
    fn formats_jira_error_bodies() {
        assert_eq!(
            format_http_error_body(500, "Internal Server Error", " "),
            "HTTP 500 Internal Server Error"
        );
        assert_eq!(
            format_http_error_body(
                400,
                "Bad Request",
                r#"{"errorMessages":["Kaputt",""],"errors":{"timeLogged":"Zu kurz"}}"#
            ),
            "HTTP 400 Bad Request — Kaputt; timeLogged: Zu kurz"
        );
        assert_eq!(
            format_http_error_body(400, "Bad Request", "{}"),
            "HTTP 400 Bad Request — {}"
        );
        assert_eq!(
            format_http_error_body(502, "Bad Gateway", "<html>"),
            "HTTP 502 Bad Gateway — <html>"
        );
    }

    #[test]
    fn fetch_errors_hint_at_certificates() {
        assert!(format_fetch_error("invalid certificate chain")
            .starts_with("Keine Verbindung zum Server (TLS/Zertifikat)."));
        assert_eq!(
            format_fetch_error("connection refused"),
            "Keine Verbindung zum Server. Bitte Jira-URL prüfen. (connection refused)"
        );
    }

    #[test]
    fn validates_the_connection_form() {
        let input = |url: &str, user: Option<&str>, token: Option<&str>, pw: Option<&str>| {
            ConnectionTestInput {
                jira_url: url.into(),
                jira_user: user.map(Into::into),
                jira_token: token.map(Into::into),
                jira_password: pw.map(Into::into),
            }
        };
        let err = |i: ConnectionTestInput| connection_test_target(&i).unwrap_err();
        assert_eq!(
            err(input(" ", None, None, None)),
            "Bitte zuerst eine Jira-URL angeben."
        );
        assert_eq!(
            err(input("u", Some("a@b"), Some(" "), None)),
            "Bitte Atlassian-E-Mail und API-Token angeben."
        );
        assert_eq!(
            err(input("u", Some("ab"), Some("t"), None)),
            "Bitte die Atlassian-Konto-E-Mail-Adresse angeben."
        );
        let (url, a) =
            connection_test_target(&input(" u ", Some(" a@b "), Some(""), Some("pw"))).unwrap();
        assert_eq!(
            (url.as_str(), a.user.as_str(), a.password.as_str()),
            ("u", "a@b", "pw")
        );
    }

    #[test]
    fn posts_a_worklog() {
        let server = mock::start(vec![("201 Created", "", "{}")]);
        let jira = HttpJira::new(&format!("{}/", server.url), auth());
        let wl = WorklogRequest {
            issue_key: "ABC-1".into(),
            time_spent: "1h 30m".into(),
            started: parse_iso("2026-05-19T08:00:00.000Z").unwrap(),
            comment: " Review ".into(),
        };
        jira.post_worklog(&wl).unwrap();
        let got = server.received.lock().unwrap()[0].clone();
        assert_eq!(got.method, "POST");
        assert_eq!(got.path, "/rest/api/2/issue/ABC-1/worklog");
        assert_eq!(
            got.header("authorization"),
            Some("Basic bWVAZXhhbXBsZS5jb206dG9r")
        );
        assert_eq!(got.header("content-type"), Some("application/json"));
        assert_eq!(
            got.body,
            r#"{"timeSpent":"1h 30m","started":"2026-05-19T08:00:00.000+0000","comment":"Review"}"#
        );
    }

    #[test]
    fn omits_an_empty_comment_and_reports_rejections() {
        let server = mock::start(vec![
            (
                "400 Bad Request",
                "",
                r#"{"errorMessages":["Issue existiert nicht"]}"#,
            ),
            ("302 Found", "Location: https://x/\r\n", ""),
        ]);
        let jira = HttpJira::new(&server.url, auth());
        let wl = WorklogRequest {
            issue_key: "ABC-2".into(),
            time_spent: "5m".into(),
            started: parse_iso("2026-05-19T08:00:00.000Z").unwrap(),
            comment: "  ".into(),
        };
        assert_eq!(
            jira.post_worklog(&wl).unwrap_err(),
            "Jira lehnte die Anfrage ab (ABC-2): HTTP 400 Bad Request — Issue existiert nicht"
        );
        assert!(jira
            .post_worklog(&wl)
            .unwrap_err()
            .starts_with("Redirect erkannt"));
        let got = server.received.lock().unwrap();
        assert_eq!(
            got[0].body,
            r#"{"timeSpent":"5m","started":"2026-05-19T08:00:00.000+0000"}"#
        );
    }

    #[test]
    fn checks_credentials() {
        let server = mock::start(vec![
            ("200 OK", "", r#"{"displayName":"Erika Muster"}"#),
            ("200 OK", "", "kein json"),
            ("401 Unauthorized", "", ""),
            ("403 Forbidden", "", ""),
            (
                "500 Internal Server Error",
                "",
                r#"{"errorMessages":["Boom"]}"#,
            ),
        ]);
        let jira = HttpJira::new(&server.url, auth());
        let reason = |c: CredentialCheck| match c {
            CredentialCheck::Failed { reason } => reason,
            CredentialCheck::Ok { display_name } => format!("ok {display_name}"),
        };
        assert_eq!(reason(jira.check_credentials()), "ok Erika Muster");
        assert_eq!(reason(jira.check_credentials()), "ok unbekannt");
        assert_eq!(
            reason(jira.check_credentials()),
            "E-Mail / API-Token ist falsch."
        );
        assert!(reason(jira.check_credentials()).starts_with("Jira hat das Konto abgelehnt."));
        assert_eq!(
            reason(jira.check_credentials()),
            "HTTP 500 Internal Server Error — Boom"
        );
        let got = server.received.lock().unwrap();
        assert_eq!(got[0].method, "GET");
        assert_eq!(got[0].path, "/rest/api/2/myself");
    }

    #[test]
    fn unreachable_server_is_a_connection_error() {
        // Bind and drop: the port is closed.
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let jira = HttpJira::new(&format!("http://127.0.0.1:{port}"), auth());
        match jira.check_credentials() {
            CredentialCheck::Failed { reason } => {
                assert!(
                    reason.starts_with("Keine Verbindung zum Server"),
                    "{reason}"
                )
            }
            other => panic!("{other:?}"),
        }
    }
}
