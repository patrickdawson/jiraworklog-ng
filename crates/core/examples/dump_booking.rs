//! Prints the Jira booking previews as JSON (all open entries, and every day
//! with entries, each without and with force booking), for comparing with the
//! old TypeScript implementation on the same database copy. Sends nothing.
//!
//!   cargo run -p jwl-core --example dump_booking -- <db>

use std::collections::BTreeMap;

use chrono::Local;
use jwl_core::booking::{self, BookingPlan};
use jwl_core::{days, db, store};
use serde::Serialize;

#[derive(Serialize)]
struct DayPlans {
    open: BookingPlan,
    force: BookingPlan,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Dump {
    all_open: BookingPlan,
    all_force: BookingPlan,
    days: BTreeMap<String, DayPlans>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args().nth(1).ok_or("usage: dump_booking <db>")?;
    let (conn, _) = db::open(std::path::Path::new(&path))?;
    let mut out = Dump {
        all_open: booking::plan_all_open(&conn, false, &Local)?.preview(),
        all_force: booking::plan_all_open(&conn, true, &Local)?.preview(),
        days: BTreeMap::new(),
    };
    for e in store::all_entries(&conn)? {
        let key = days::day_key_of(&e.started_at, &Local);
        if out.days.contains_key(&key) {
            continue;
        }
        let plans = DayPlans {
            open: booking::plan_day(&conn, &key, false, &Local)?.preview(),
            force: booking::plan_day(&conn, &key, true, &Local)?.preview(),
        };
        out.days.insert(key, plans);
    }
    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(())
}
