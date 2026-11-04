//! Stable error codes. Every panic message starts with `E_<CODE>:` so the app can map it.

use near_sdk::env;

pub fn fail(code: &str, msg: impl AsRef<str>) -> ! {
    env::panic_str(&format!("{}: {}", code, msg.as_ref()))
}

#[macro_export]
macro_rules! ensure {
    ($cond:expr, $code:expr, $($arg:tt)+) => {
        if !$cond {
            $crate::errors::fail($code, format!($($arg)+));
        }
    };
}
