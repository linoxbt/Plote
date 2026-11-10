//! Blocking HTTPS for the worker: `wstd` (wasi:http) on wasm32, `ureq` natively.

/// Photos larger than this are rejected (`fetch_failed`).
pub const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;
/// AI responses are small; cap them anyway.
pub const MAX_JSON_BYTES: usize = 1024 * 1024;

/// Timeouts. OutLayer kills the worker at 60 s (SPEC 5.6), so the photo GET and
/// the AI POST together must stay well under that, and a slow or dripping server
/// (the URL is chosen by the submitter) must not be able to hold the worker.
pub const CONNECT_TIMEOUT_S: u64 = 5;
/// Time to the first byte of the response, and between body chunks.
pub const READ_TIMEOUT_S: u64 = 10;
/// Whole-request deadline for the photo download (connect + headers + body).
pub const GET_DEADLINE_S: u64 = 20;
/// Whole-request deadline for the NEAR AI call.
pub const POST_DEADLINE_S: u64 = 32;
// Photo download + AI call must finish inside OutLayer's 60 s limit.
const _: () = assert!(
    GET_DEADLINE_S + POST_DEADLINE_S < 60
        && CONNECT_TIMEOUT_S < GET_DEADLINE_S
        && READ_TIMEOUT_S < GET_DEADLINE_S
);

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
            .timeout_connect(Some(Duration::from_secs(super::CONNECT_TIMEOUT_S)))
            .timeout_recv_response(Some(Duration::from_secs(super::READ_TIMEOUT_S)))
            .timeout_per_read(Some(Duration::from_secs(super::READ_TIMEOUT_S)))
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
        let resp = agent(super::GET_DEADLINE_S)
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
        let mut req = agent(super::POST_DEADLINE_S)
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
    use std::time::Duration;
    use wstd::future::FutureExt;
    use wstd::http::body::util::BodyExt;
    use wstd::http::{Body, Client, Method, Request};

    fn t<E: std::fmt::Display>(e: E) -> FetchError {
        FetchError::Transport(e.to_string())
    }

    /// A client with per-phase timeouts (wasi:http `request-options`).
    fn client_with_timeouts() -> Client {
        let mut c = Client::new();
        c.set_connect_timeout(Duration::from_secs(super::CONNECT_TIMEOUT_S));
        c.set_first_byte_timeout(Duration::from_secs(super::READ_TIMEOUT_S));
        c.set_between_bytes_timeout(Duration::from_secs(super::READ_TIMEOUT_S));
        c
    }

    async fn read(
        client: &Client,
        req: Request<Body>,
        limit: usize,
    ) -> Result<Vec<u8>, FetchError> {
        let resp = client.send(req).await.map_err(t)?;
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

    /// Send with per-phase timeouts. wasi:http hosts may refuse `request-options`
    /// they don't implement (wstd then fails with "does not support … timeout");
    /// in that case resend once without them. Either way the whole exchange runs
    /// under `deadline_s`, enforced with wasi:clocks, which every host has.
    fn send(
        build: impl Fn() -> Result<Request<Body>, FetchError>,
        limit: usize,
        deadline_s: u64,
    ) -> Result<Vec<u8>, FetchError> {
        let deadline = wstd::time::Duration::from_secs(deadline_s);
        wstd::runtime::block_on(async {
            let attempt = async {
                match read(&client_with_timeouts(), build()?, limit).await {
                    Err(FetchError::Transport(e)) if e.contains("does not support") => {
                        eprintln!(
                            "plote-verifier: host lacks wasi:http timeouts ({e}); deadline only"
                        );
                        read(&Client::new(), build()?, limit).await
                    }
                    other => other,
                }
            };
            attempt.timeout(deadline).await.unwrap_or_else(|_| {
                Err(FetchError::Transport(format!(
                    "deadline {deadline_s}s exceeded"
                )))
            })
        })
    }

    pub fn get(url: &str, limit: usize) -> Result<Vec<u8>, FetchError> {
        let build = || {
            Request::builder()
                .method(Method::GET)
                .uri(url)
                .header("user-agent", "plote-verifier")
                .body(Body::empty())
                .map_err(t)
        };
        send(build, limit, super::GET_DEADLINE_S)
    }

    pub fn post_json(
        url: &str,
        headers: &[(&str, &str)],
        body: String,
        limit: usize,
    ) -> Result<Vec<u8>, FetchError> {
        let build = || {
            let mut b = Request::builder()
                .method(Method::POST)
                .uri(url)
                .header("content-type", "application/json")
                .header("user-agent", "plote-verifier");
            for (k, v) in headers {
                b = b.header(*k, *v);
            }
            b.body(Body::from(body.clone())).map_err(t)
        };
        send(build, limit, super::POST_DEADLINE_S)
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

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn dripping_server_hits_the_deadline() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        // A plain-HTTP server that accepts and never answers: the native client must
        // give up after READ_TIMEOUT_S rather than hang. (check_url requires https,
        // so call the inner implementation directly.)
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        let h = std::thread::spawn(move || {
            if let Ok((mut s, _)) = l.accept() {
                let mut buf = [0u8; 512];
                let _ = s.read(&mut buf);
                std::thread::sleep(std::time::Duration::from_secs(READ_TIMEOUT_S + 3));
                let _ = s.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 1\r\n\r\nx");
            }
        });
        let start = std::time::Instant::now();
        let r = imp::get(&format!("http://{addr}/x.jpg"), 100);
        assert!(matches!(r, Err(FetchError::Transport(_))), "{r:?}");
        assert!(start.elapsed().as_secs() <= READ_TIMEOUT_S + 2);
        let _ = h.join();
    }
}
