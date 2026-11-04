//! NEP-297 events under the `plote` standard.

use near_sdk::env;
use near_sdk::serde_json::{json, Value};

pub const STANDARD: &str = "plote";
pub const VERSION: &str = "1.0.0";

pub fn emit(event: &str, data: Value) {
    let log = json!({ "standard": STANDARD, "version": VERSION, "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{}", log));
}
