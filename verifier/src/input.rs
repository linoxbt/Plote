//! stdin contract (SPEC 6.3, INTERFACE 4). Parsing never panics: any problem
//! becomes `Err(String)` and the caller emits a `bad_input` verdict.

use serde::{Deserialize, Deserializer};

#[derive(Debug, Clone, Deserialize)]
pub struct Geofence {
    pub lat_e6: i64,
    pub lon_e6: i64,
    /// 0 means "skip the location check" (playground).
    #[serde(default)]
    pub radius_m: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Limits {
    pub max_exif_age_h: u64,
    pub max_phash_distance: u32,
    pub min_ai_confidence: u8,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_exif_age_h: 72,
            max_phash_distance: 8,
            min_ai_confidence: 70,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Input {
    #[serde(deserialize_with = "de_u64")]
    pub evidence_id: u64,
    #[serde(default)]
    pub url: Option<String>,
    /// Optional extra storage location the estate allows photos from, besides the
    /// compiled-in `fetch::ALLOWED_PHOTO_PREFIXES`: a strict `https://host/path/`
    /// prefix ending in `/` (no IP literals or local names). Empty means none.
    #[serde(default)]
    pub allowed_url_prefix: Option<String>,
    /// Offline/testing: use these bytes instead of fetching `url`. The sha256
    /// check still binds them to the on-chain commitment.
    #[serde(default)]
    pub image_base64: Option<String>,
    pub sha256: String,
    /// The app's capture time (its own EXIF read, else the submit time). Not trusted
    /// for freshness (EXIF `DateTimeOriginal` is); a gap of more than 30 min to the
    /// EXIF time adds the `captured_at_mismatch` warning.
    #[serde(default, deserialize_with = "de_opt_u64")]
    pub captured_at: Option<u64>,
    #[serde(default)]
    pub device_gps: Option<[i64; 2]>,
    #[serde(deserialize_with = "de_u64")]
    pub now: u64,
    pub milestone: String,
    pub geofence: Geofence,
    #[serde(default)]
    pub known_phashes: Vec<String>,
    #[serde(default)]
    pub limits: Limits,
    #[serde(default)]
    pub demo_mode: bool,
    #[serde(default)]
    pub playground: bool,
    pub challenge: String,
    #[serde(deserialize_with = "de_u64")]
    pub challenge_opened_at: u64,
}

/// Parsed input plus the pre-decoded known pHashes.
#[derive(Debug, Clone)]
pub struct Parsed {
    pub input: Input,
    pub known: Vec<u64>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum NumOrStr {
    N(u64),
    S(String),
}

fn num_or_str(v: NumOrStr) -> Result<u64, String> {
    match v {
        NumOrStr::N(n) => Ok(n),
        NumOrStr::S(s) => s.trim().parse::<u64>().map_err(|e| e.to_string()),
    }
}

fn de_u64<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    num_or_str(NumOrStr::deserialize(d)?).map_err(serde::de::Error::custom)
}

fn de_opt_u64<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
    match Option::<NumOrStr>::deserialize(d)? {
        None => Ok(None),
        Some(v) => num_or_str(v).map(Some).map_err(serde::de::Error::custom),
    }
}

/// Parse a 16-hex-digit pHash into a u64 (big-endian, same order we print).
pub fn parse_phash(s: &str) -> Option<u64> {
    let s = s.trim();
    if s.len() != 16 {
        return None;
    }
    u64::from_str_radix(s, 16).ok()
}

/// Best-effort evidence id for a `bad_input` verdict.
pub fn sniff_evidence_id(raw: &str) -> Option<u64> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    match v.get("evidence_id")? {
        serde_json::Value::Number(n) => n.as_u64(),
        serde_json::Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

pub fn parse(raw: &str) -> Result<Parsed, String> {
    let mut input: Input = serde_json::from_str(raw).map_err(|e| format!("json: {e}"))?;
    if input
        .allowed_url_prefix
        .as_deref()
        .is_some_and(|p| p.trim().is_empty())
    {
        input.allowed_url_prefix = None;
    }
    if let Some(p) = &input.allowed_url_prefix {
        if !crate::fetch::valid_prefix(p) {
            return Err("allowed_url_prefix must be an https://host/path/ prefix".into());
        }
    }
    let mut known = Vec::with_capacity(input.known_phashes.len());
    for h in &input.known_phashes {
        known.push(parse_phash(h).ok_or_else(|| format!("known_phashes: bad entry {h:?}"))?);
    }
    if input.url.is_none() && input.image_base64.is_none() {
        return Err("need url or image_base64".into());
    }
    if !(input.geofence.radius_m.is_finite() && input.geofence.radius_m >= 0.0) {
        return Err("geofence.radius_m must be >= 0".into());
    }
    let sha = input.sha256.trim();
    if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("sha256 must be 64 hex chars".into());
    }
    Ok(Parsed { input, known })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: &str = r#"{"evidence_id":"17","url":"https://x/y.jpg",
        "sha256":"9f2c000000000000000000000000000000000000000000000000000000000000",
        "now":1793743600000000000,"milestone":"roofing",
        "geofence":{"lat_e6":6447000,"lon_e6":3474000,"radius_m":300},
        "challenge":"K7RQ4M","challenge_opened_at":"1793739000000000000"}"#;

    #[test]
    fn parses_minimal_with_defaults_and_string_numbers() {
        let p = parse(MIN).unwrap();
        assert_eq!(p.input.evidence_id, 17);
        assert_eq!(p.input.challenge_opened_at, 1_793_739_000_000_000_000);
        assert_eq!(p.input.limits.max_exif_age_h, 72);
        assert_eq!(p.input.limits.max_phash_distance, 8);
        assert_eq!(p.input.limits.min_ai_confidence, 70);
        assert!(!p.input.demo_mode && !p.input.playground);
        assert!(p.known.is_empty());
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse("").is_err());
        assert!(parse("[]").is_err());
        assert!(parse(r#"{"evidence_id":1}"#).is_err());
        let bad_hash = MIN.replace("\"milestone\"", "\"known_phashes\":[\"zz\"],\"milestone\"");
        assert!(parse(&bad_hash).is_err());
        assert_eq!(sniff_evidence_id(r#"{"evidence_id":5}"#), Some(5));
        assert_eq!(sniff_evidence_id("nope"), None);
    }

    #[test]
    fn allowed_url_prefix_validated() {
        let with = |p: &str| {
            MIN.replace(
                "\"milestone\"",
                &format!("\"allowed_url_prefix\":{p},\"milestone\""),
            )
        };
        assert_eq!(parse(MIN).unwrap().input.allowed_url_prefix, None);
        assert_eq!(parse(&with("\"\"")).unwrap().input.allowed_url_prefix, None);
        assert_eq!(parse(&with("null")).unwrap().input.allowed_url_prefix, None);
        assert_eq!(
            parse(&with("\"https://cdn.example.org/plote/\""))
                .unwrap()
                .input
                .allowed_url_prefix
                .as_deref(),
            Some("https://cdn.example.org/plote/")
        );
        for bad in [
            "\"http://cdn.example.org/plote/\"",
            "\"https://127.0.0.1/\"",
            "\"https://cdn.example.org/plote\"",
            "42",
        ] {
            assert!(parse(&with(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn phash_hex_roundtrip() {
        assert_eq!(parse_phash("c3a1f0e29b7d4410"), Some(0xc3a1_f0e2_9b7d_4410));
        assert_eq!(parse_phash("c3a1"), None);
    }
}
