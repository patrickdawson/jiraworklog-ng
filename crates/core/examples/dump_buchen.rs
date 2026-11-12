//! Prints the Buchen page's view model as JSON, for comparing with the old
//! TypeScript implementation on the same database copy.
//!
//!   cargo run -p jwl-core --example dump_buchen -- <db> [days|all]

use chrono::{Local, Utc};
use jwl_core::{buchen, db};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let path = args.next().ok_or("usage: dump_buchen <db> [days|all]")?;
    let days = match args.next().as_deref() {
        None => Some(30),
        Some("all") => None,
        Some(n) => Some(n.parse()?),
    };
    let (conn, _) = db::open(std::path::Path::new(&path))?;
    let data = buchen::load(&conn, days, false, Utc::now(), &Local)?;
    println!("{}", serde_json::to_string_pretty(&data)?);
    Ok(())
}
