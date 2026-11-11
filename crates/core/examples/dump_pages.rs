//! Prints the Kalender or Auswertung view model as JSON, for comparing with
//! the old TypeScript implementation on the same database copy.
//!
//!   cargo run -p jwl-core --example dump_pages -- <db> kalender [anchor]
//!   cargo run -p jwl-core --example dump_pages -- <db> auswertung [range] [anchor]

use chrono::{Local, Utc};
use jwl_core::report_range::RangeKind;
use jwl_core::{auswertung, db, kalender};

const USAGE: &str = "usage: dump_pages <db> kalender [anchor] | auswertung [range] [anchor]";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize| args.get(i).map(String::as_str).filter(|s| !s.is_empty());
    let path = arg(0).ok_or(USAGE)?;
    let (conn, _) = db::open(std::path::Path::new(path))?;
    let json = match arg(1) {
        Some("kalender") => {
            serde_json::to_string_pretty(&kalender::load(&conn, arg(2), Utc::now(), &Local)?)?
        }
        Some("auswertung") => serde_json::to_string_pretty(&auswertung::load(
            &conn,
            RangeKind::parse(arg(2)),
            arg(3),
            Utc::now(),
            &Local,
        )?)?,
        _ => return Err(USAGE.into()),
    };
    println!("{json}");
    Ok(())
}
