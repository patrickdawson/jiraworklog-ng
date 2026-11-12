use thiserror::Error;

/// Every failure the core can report. `Validation` carries a German message
/// that the UI shows as it is, matching the old server actions.
#[derive(Debug, Error)]
pub enum Error {
    #[error("Datenbankfehler: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Dateifehler: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Validation(String),
}

pub type Result<T> = std::result::Result<T, Error>;
