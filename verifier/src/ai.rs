//! NEAR AI Cloud vision stage check (OpenAI-compatible chat completions).

use base64::Engine;
use serde_json::{json, Value};

pub const ENDPOINT: &str = "https://cloud-api.near.ai/v1/chat/completions";
pub const DEFAULT_MODEL: &str = "Qwen/Qwen3-VL-30B-A3B-Instruct";

/// SPEC 6.4 system prompt, verbatim.
pub const SYSTEM_PROMPT: &str = r#"You are a construction-stage inspector for residential buildings in West Africa.
You look at ONE photo and classify the visible construction stage.
Stages, in order:
- "site_clearing": bare or cleared land, no structure
- "foundation": excavation, footings, blinding, foundation walls or ground-floor slab; no walls above knee height
- "walls": block or concrete walls rising, columns, lintels; no roof structure
- "roofing": roof trusses, roof sheets or tiles being installed or complete; windows/finishes absent
- "finishing": plastering, screeding, windows, doors, tiling, painting, electrical/plumbing fixtures
- "complete": finished building, landscaping, ready to occupy
- "not_construction": not a construction site
Also decide whether the image is a photo of a screen, a printout, or a render/CGI.
The photo should show a sheet of paper with a short handwritten or printed code. Copy it exactly, or null if there is none.
Answer with JSON only, no prose:
{"stage": <one of the stages>, "confidence": <0-100 integer>,
 "is_photo_of_screen_or_print": <true|false>, "is_render": <true|false>,
 "challenge_read": <string or null>,
 "observations": [<up to 4 short strings>]}"#;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiAnswer {
    pub stage: String,
    pub confidence: u8,
    pub is_photo_of_screen_or_print: bool,
    pub is_render: bool,
    pub challenge_read: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AiOutcome {
    Answer {
        chat_id: Option<String>,
        answer: AiAnswer,
        /// The answer came from `PLOTE_AI_MOCK`, not NEAR AI.
        mocked: bool,
    },
    Unavailable(String),
}

#[derive(Debug, Clone, Default)]
pub struct AiConfig {
    pub api_key: Option<String>,
    pub model: String,
    /// Model answer to use instead of calling NEAR AI (tests / offline runs).
    pub mock: Option<String>,
}

impl AiConfig {
    /// From env: `NEAR_AI_API_KEY`, `NEAR_AI_MODEL`, and `PLOTE_AI_MOCK`
    /// (honoured natively always; on wasm only with the `ai-mock` feature).
    pub fn from_env() -> Self {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        let mock = if cfg!(any(not(target_arch = "wasm32"), feature = "ai-mock")) {
            var("PLOTE_AI_MOCK")
        } else {
            None
        };
        AiConfig {
            api_key: var("NEAR_AI_API_KEY").map(|k| k.trim().to_string()),
            model: var("NEAR_AI_MODEL").unwrap_or_else(|| DEFAULT_MODEL.to_string()),
            mock,
        }
    }
}

pub fn user_text(milestone: &str) -> String {
    format!("Milestone being claimed: \"{milestone}\". Classify this photo.")
}

pub fn build_request(model: &str, milestone: &str, jpeg: &[u8]) -> Value {
    let b64 = base64::engine::general_purpose::STANDARD.encode(jpeg);
    json!({
        "model": model,
        "temperature": 0,
        "max_tokens": 300,
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": [
                { "type": "text", "text": user_text(milestone) },
                { "type": "image_url", "image_url": { "url": format!("data:image/jpeg;base64,{b64}") } }
            ]}
        ]
    })
}

/// Pull `(id, assistant text)` out of a chat-completions response.
pub fn parse_completion(body: &[u8]) -> Result<(Option<String>, String), String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("response json: {e}"))?;
    let id = v.get("id").and_then(Value::as_str).map(str::to_string);
    let content = v
        .pointer("/choices/0/message/content")
        .ok_or("no choices[0].message.content")?;
    let text = match content {
        Value::String(s) => s.clone(),
        // Some servers return content parts.
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        _ => return Err("content is not text".into()),
    };
    Ok((id, text))
}

/// Find the matching `}` for the `{` at `start`, respecting strings.
fn balanced_object(s: &str, start: usize) -> Option<&str> {
    let (mut depth, mut in_str, mut esc) = (0i32, false, false);
    for (i, c) in s[start..].char_indices() {
        if in_str {
            match (esc, c) {
                (true, _) => esc = false,
                (false, '\\') => esc = true,
                (false, '"') => in_str = false,
                _ => {}
            }
            continue;
        }
        match c {
            '"' => in_str = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&s[start..start + i + 1]);
                }
            }
            _ => {}
        }
    }
    None
}

/// Extract the first JSON object from model output: tolerates ```json
/// fences, <think> blocks and surrounding prose.
pub fn extract_json(text: &str) -> Option<Value> {
    let mut t = text;
    if let Some(end) = t.rfind("</think>") {
        t = &t[end + "</think>".len()..];
    }
    let t = t.trim();
    if let Ok(v @ Value::Object(_)) = serde_json::from_str::<Value>(t) {
        return Some(v);
    }
    let mut from = 0;
    while let Some(off) = t[from..].find('{') {
        let start = from + off;
        if let Some(obj) = balanced_object(t, start) {
            if let Ok(v @ Value::Object(_)) = serde_json::from_str::<Value>(obj) {
                return Some(v);
            }
        }
        from = start + 1;
    }
    None
}

fn as_bool(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => s.trim().eq_ignore_ascii_case("true"),
        Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0),
        _ => false,
    }
}

fn as_confidence(v: Option<&Value>) -> Option<u8> {
    let x = match v? {
        Value::Number(n) => n.as_f64()?,
        Value::String(s) => s.trim().trim_end_matches('%').trim().parse().ok()?,
        _ => return None,
    };
    if !x.is_finite() {
        return None;
    }
    // A fraction like 0.88 means 88.
    let x = if x > 0.0 && x < 1.0 { x * 100.0 } else { x };
    Some(x.round().clamp(0.0, 100.0) as u8)
}

pub fn parse_answer(text: &str) -> Result<AiAnswer, String> {
    let v = extract_json(text).ok_or("no JSON object in model output")?;
    let stage = v
        .get("stage")
        .and_then(Value::as_str)
        .ok_or("missing stage")?
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '-'], "_");
    let confidence = as_confidence(v.get("confidence")).ok_or("missing confidence")?;
    let challenge_read = match v.get("challenge_read") {
        Some(Value::String(s))
            if !s.trim().is_empty() && !s.trim().eq_ignore_ascii_case("null") =>
        {
            Some(s.trim().to_string())
        }
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    };
    Ok(AiAnswer {
        stage,
        confidence,
        is_photo_of_screen_or_print: as_bool(v.get("is_photo_of_screen_or_print")),
        is_render: as_bool(v.get("is_render")),
        challenge_read,
    })
}

/// Ask the model about `jpeg` (already downscaled). Never panics.
pub fn classify(cfg: &AiConfig, milestone: &str, jpeg: &[u8]) -> AiOutcome {
    if let Some(mock) = &cfg.mock {
        if mock.trim().eq_ignore_ascii_case("unavailable") {
            return AiOutcome::Unavailable("mock: unavailable".into());
        }
        return match parse_answer(mock) {
            Ok(answer) => AiOutcome::Answer {
                chat_id: Some("mock".into()),
                answer,
                mocked: true,
            },
            Err(e) => AiOutcome::Unavailable(format!("mock: {e}")),
        };
    }
    let Some(key) = &cfg.api_key else {
        return AiOutcome::Unavailable("NEAR_AI_API_KEY not set".into());
    };
    let body = build_request(&cfg.model, milestone, jpeg).to_string();
    let auth = format!("Bearer {key}");
    let resp = match crate::fetch::post_json(
        ENDPOINT,
        &[
            ("authorization", auth.as_str()),
            ("accept", "application/json"),
        ],
        body,
        crate::fetch::MAX_JSON_BYTES,
    ) {
        Ok(r) => r,
        Err(e) => return AiOutcome::Unavailable(e.to_string()),
    };
    let (chat_id, text) = match parse_completion(&resp) {
        Ok(x) => x,
        Err(e) => return AiOutcome::Unavailable(e),
    };
    match parse_answer(&text) {
        Ok(answer) => AiOutcome::Answer {
            chat_id,
            answer,
            mocked: false,
        },
        Err(e) => AiOutcome::Unavailable(format!("unparseable model output: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_contains_challenge_lines() {
        assert!(SYSTEM_PROMPT.contains("sheet of paper with a short handwritten or printed code"));
        assert!(SYSTEM_PROMPT.contains("\"challenge_read\": <string or null>"));
        assert!(SYSTEM_PROMPT.starts_with("You are a construction-stage inspector"));
    }

    #[test]
    fn request_shape() {
        let r = build_request(DEFAULT_MODEL, "roofing", &[0xFF, 0xD8, 0xFF]);
        assert_eq!(r["model"], DEFAULT_MODEL);
        assert_eq!(r["temperature"], 0);
        assert_eq!(r["max_tokens"], 300);
        assert_eq!(r["messages"][0]["content"], SYSTEM_PROMPT);
        assert_eq!(
            r["messages"][1]["content"][0]["text"],
            "Milestone being claimed: \"roofing\". Classify this photo."
        );
        let url = r["messages"][1]["content"][1]["image_url"]["url"]
            .as_str()
            .unwrap();
        assert_eq!(url, "data:image/jpeg;base64,/9j/");
    }

    #[test]
    fn parses_plain_fenced_and_think_wrapped() {
        let plain = r#"{"stage":"roofing","confidence":88,"is_photo_of_screen_or_print":false,"is_render":false,"challenge_read":"K7RQ4M","observations":["trusses"]}"#;
        let a = parse_answer(plain).unwrap();
        assert_eq!(a.stage, "roofing");
        assert_eq!(a.confidence, 88);
        assert_eq!(a.challenge_read.as_deref(), Some("K7RQ4M"));
        assert!(!a.is_photo_of_screen_or_print && !a.is_render);

        let fenced = format!("Here you go:\n```json\n{plain}\n```\nThanks");
        assert_eq!(parse_answer(&fenced).unwrap(), a);

        let think = format!("<think>maybe {{\"stage\":\"walls\"}}</think>\n{plain}");
        assert_eq!(parse_answer(&think).unwrap(), a);
    }

    #[test]
    fn lenient_field_types() {
        let a = parse_answer(
            r#"{"stage":"Site Clearing","confidence":"0.75","is_photo_of_screen_or_print":"true","challenge_read":null}"#,
        )
        .unwrap();
        assert_eq!(a.stage, "site_clearing");
        assert_eq!(a.confidence, 75);
        assert!(a.is_photo_of_screen_or_print);
        assert_eq!(a.challenge_read, None);
        let b =
            parse_answer(r#"{"stage":"walls","confidence":250,"challenge_read":"null"}"#).unwrap();
        assert_eq!(b.confidence, 100);
        assert_eq!(b.challenge_read, None);
        // braces inside strings don't confuse the scanner
        let c = parse_answer(
            r#"note {x} ```{"stage":"walls","confidence":70,"challenge_read":"A}B"}```"#,
        )
        .unwrap();
        assert_eq!(c.challenge_read.as_deref(), Some("A}B"));
    }

    #[test]
    fn rejects_unusable_output() {
        assert!(parse_answer("I cannot help with that").is_err());
        assert!(parse_answer(r#"{"confidence":80}"#).is_err());
        assert!(parse_answer(r#"{"stage":"roofing","confidence":8"#).is_err()); // truncated
    }

    #[test]
    fn completion_envelope() {
        let body = br#"{"id":"chatcmpl-123","choices":[{"message":{"role":"assistant","content":"{\"stage\":\"roofing\",\"confidence\":90}"}}]}"#;
        let (id, text) = parse_completion(body).unwrap();
        assert_eq!(id.as_deref(), Some("chatcmpl-123"));
        assert_eq!(parse_answer(&text).unwrap().confidence, 90);
        assert!(parse_completion(b"{}").is_err());
        assert!(parse_completion(b"<html>").is_err());
    }

    #[test]
    fn mock_and_missing_key() {
        let cfg = AiConfig {
            mock: Some(r#"{"stage":"roofing","confidence":90}"#.into()),
            ..Default::default()
        };
        assert!(matches!(
            classify(&cfg, "roofing", &[]),
            AiOutcome::Answer { mocked: true, .. }
        ));
        let cfg = AiConfig {
            mock: Some("unavailable".into()),
            ..Default::default()
        };
        assert!(matches!(
            classify(&cfg, "roofing", &[]),
            AiOutcome::Unavailable(_)
        ));
        let cfg = AiConfig::default();
        assert!(matches!(
            classify(&cfg, "roofing", &[]),
            AiOutcome::Unavailable(_)
        ));
    }
}
