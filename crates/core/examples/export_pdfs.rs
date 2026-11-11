//! Writes both PDF reports and their data (JSON) for a database copy, for
//! comparing with the old react-pdf output.
//!
//!   cargo run -p jwl-core --example export_pdfs -- <db> <out dir> <range>[:<anchor>] ...
//!
//! For each `range[:anchor]` (e.g. `month:2026-10-01`, `week:2026-10-14`,
//! `all`) it writes `rs-stundenzettel-<slug>.pdf` and
//! `rs-axapta-bericht-<yyyy-mm>.pdf` (the month of the anchor), plus
//! `rs-worklog-<range>_<anchor>.json` and `rs-category-<yyyy-mm>.json`.

use std::path::Path;

use chrono::{Local, Utc};
use jwl_core::report_range::RangeKind;
use jwl_core::{category_report, db, pdf, worklog_report};

const USAGE: &str = "usage: export_pdfs <db> <out dir> <range>[:<anchor>] ...";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 3 {
        return Err(USAGE.into());
    }
    let (conn, _) = db::open(Path::new(&args[0]))?;
    let out = Path::new(&args[1]);
    for spec in &args[2..] {
        let (kind, anchor) = match spec.split_once(':') {
            Some((k, a)) => (k, Some(a)),
            None => (spec.as_str(), None),
        };
        let (report, range) = worklog_report::load(
            &conn,
            RangeKind::parse(Some(kind)),
            anchor,
            Utc::now(),
            &Local,
        )?;
        std::fs::write(
            out.join(format!("rs-worklog-{}.json", spec.replace(':', "_"))),
            serde_json::to_string_pretty(&report)?,
        )?;
        std::fs::write(
            out.join(format!("rs-stundenzettel-{}.pdf", range.slug)),
            pdf::worklog_pdf(&report, &Local),
        )?;

        let (cat, month) = category_report::load(&conn, anchor, Utc::now(), &Local)?;
        std::fs::write(
            out.join(format!("rs-category-{}.json", month.slug)),
            serde_json::to_string_pretty(&cat)?,
        )?;
        std::fs::write(
            out.join(format!("rs-axapta-bericht-{}.pdf", month.slug)),
            pdf::category_pdf(&cat),
        )?;
    }
    Ok(())
}
