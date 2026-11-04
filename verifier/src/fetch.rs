//! Blocking HTTPS for the worker: `wstd` (wasi:http) on wasm32, `ureq` natively.

/// Photos larger than this are rejected (`fetch_failed`).
pub const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;
/// AI responses are small; cap them anyway.
pub const MAX_JSON_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchError {
    BadUrl(String),
    TooLarge,
    Status(u16),
    Transport(String),
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FetchError::BadUrl(u) => write!(f, "bad url: {u}"),
            FetchError::TooLarge => write!(f, "response too large"),
            FetchError::Status(s) => write!(f, "http status {s}"),
            FetchError::Transport(e) => write!(f, "transport: {e}"),
        }
    }
}

/// Only plain `https://` URLs are fetched.
pub fn check_url(url: &str) -> Result<(), FetchError> {
    let ok = url.len() < 4096
        && url
            .strip_prefix("https://")
            .is_some_and(|rest| !rest.is_empty() && !rest.starts_with('/'))
        && !url.chars().any(|c| c.is_whitespace() || c.is_control());
    if ok {
        Ok(())
    } else {
        Err(FetchError::BadUrl(url.chars().take(200).collect()))
    }
}

/// GET `url`, at most `limit` bytes.
pub fn get(url: &str, limit: usize) -> Result<Vec<u8>, FetchError> {
    check_url(url)?;
    imp::get(url, limit)
}

/// POST a JSON body with headers; returns the response body (≤ `limit`).
pub fn post_json(
    url: &str,
    headers: &[(&str, &str)],
    body: String,
    limit: usize,
) -> Result<Vec<u8>, FetchError> {
    check_url(url)?;
    imp::post_json(url, headers, body, limit)
}

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    use super::FetchError;
    use std::io::Read;
    use std::time::Duration;

    fn agent(timeout_s: u64) -> ureq::Agent {
        ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(timeout_s)))
            .http_status_as_error(false)
            .build()
            .new_agent()
    }

    fn read_capped(
        mut resp: ureq::http::Response<ureq::Body>,
        limit: usize,
    ) -> Result<Vec<u8>, FetchError> {
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(FetchError::Status(status));
        }
        let mut out = Vec::new();
        resp.body_mut()
            .as_reader()
            .take(limit as u64 + 1)
            .read_to_end(&mut out)
            .map_err(|e| FetchError::Transport(e.to_string()))?;
        if out.len() > limit {
            return Err(FetchError::TooLarge);
        }
        Ok(out)
    }

    pub fn get(url: &str, limit: usize) -> Result<Vec<u8>, FetchError> {
        let resp = agent(30)
            .get(url)
            .call()
            .map_err(|e| FetchError::Transport(e.to_string()))?;
        read_capped(resp, limit)
    }

    pub fn post_json(
        url: &str,
        headers: &[(&str, &str)],
        body: String,
        limit: usize,
    ) -> Result<Vec<u8>, FetchError> {
        let mut req = agent(90)
            .post(url)
            .header("content-type", "application/json");
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        let resp = req
            .send(body)
            .map_err(|e| FetchError::Transport(e.to_string()))?;
        read_capped(resp, limit)
    }
}

#[cfg(target_arch = "wasm32")]
mod imp {
    use super::FetchError;
    use wstd::http::body::util::BodyExt;
    use wstd::http::{Body, Client, Method, Request};

    fn t<E: std::fmt::Display>(e: E) -> FetchError {
        FetchError::Transport(e.to_string())
    }

    async fn send(req: Request<Body>, limit: usize) -> Result<Vec<u8>, FetchError> {
        let resp = Client::new().send(req).await.map_err(t)?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(FetchError::Status(status));
        }
        let body = resp.into_body();
        if body.content_length().is_some_and(|n| n > limit as u64) {
            return Err(FetchError::TooLarge);
        }
        let mut body = body.into_boxed_body();
        let mut out = Vec::new();
        while let Some(frame) = body.frame().await {
            let frame = frame.map_err(t)?;
            if let Some(data) = frame.data_ref() {
                if out.len() + data.len() > limit {
                    return Err(FetchError::TooLarge);
                }
                out.extend_from_slice(data);
            }
        }
        Ok(out)
    }

    pub fn get(url: &str, limit: usize) -> Result<Vec<u8>, FetchError> {
        let req = Request::builder()
            .method(Method::GET)
            .uri(url)
            .header("user-agent", "plote-verifier")
            .body(Body::empty())
            .map_err(t)?;
        wstd::runtime::block_on(send(req, limit))
    }

    pub fn post_json(
        url: &str,
        headers: &[(&str, &str)],
        body: String,
        limit: usize,
    ) -> Result<Vec<u8>, FetchError> {
        let mut b = Request::builder()
            .method(Method::POST)
            .uri(url)
            .header("content-type", "application/json")
            .header("user-agent", "plote-verifier");
        for (k, v) in headers {
            b = b.header(*k, *v);
        }
        let req = b.body(Body::from(body)).map_err(t)?;
        wstd::runtime::block_on(send(req, limit))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https() {
        assert!(check_url("https://x.supabase.co/a.jpg").is_ok());
        assert!(check_url("http://x/a.jpg").is_err());
        assert!(check_url("file:///etc/passwd").is_err());
        assert!(check_url("https://").is_err());
        assert!(check_url("https:///x").is_err());
        assert!(check_url("https://x/a b.jpg").is_err());
        assert!(matches!(get("ftp://x", 10), Err(FetchError::BadUrl(_))));
    }
}
