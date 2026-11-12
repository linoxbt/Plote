//! Blocking HTTPS for the worker: `wstd` (wasi:http) on wasm32, `ureq` natively.

/// Photos larger than this are rejected (`fetch_failed`).
pub const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;
/// AI responses are small; cap them anyway.
pub const MAX_JSON_BYTES: usize = 1024 * 1024;

/// Timeouts. OutLayer kills the worker at 60 s (SPEC 5.6), so the photo GET and
/// the whole AI stage (`ai::AI_BUDGET_S`, retry included) together must stay well
/// under that, and a slow or dripping server must not be able to hold the worker.
pub const CONNECT_TIMEOUT_S: u64 = 5;
/// Time to the first byte of the photo response, and between body chunks.
pub const READ_TIMEOUT_S: u64 = 10;
/// Whole-request deadline for the photo download (connect + headers + body).
pub const GET_DEADLINE_S: u64 = 15;
const _: () = assert!(CONNECT_TIMEOUT_S < GET_DEADLINE_S && READ_TIMEOUT_S < GET_DEADLINE_S);

/// Storage locations a photo may be fetched from (SPEC 6.5: the app uploads to the
/// Supabase bucket `evidence` and submits its public URL). Anything else is refused
/// with `url_not_allowed` before any request is made, so the worker can't be
/// pointed at internal services or used as a hash oracle for arbitrary URLs. An
/// estate may add one more prefix through the input's `allowed_url_prefix`.
pub const ALLOWED_PHOTO_PREFIXES: &[&str] =
    &["https://oshxsrhnynauyxcraymy.supabase.co/storage/v1/object/public/evidence/"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchError {
    BadUrl(String),
    TooLarge,
    Status(u16),
    Transport(String),
}

impl FetchError {
    /// Worth one more try: rate limiting, server errors, gateway timeouts and
    /// transport failures (connect errors, resets, timeouts).
    pub fn is_transient(&self) -> bool {
        match self {
            FetchError::Status(s) => *s == 408 || *s == 429 || (500..600).contains(s),
            FetchError::Transport(_) => true,
            FetchError::BadUrl(_) | FetchError::TooLarge => false,
        }
    }
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

/// An `https://` URL split into its (lowercase) host and its path (with query).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpsUrl<'a> {
    pub host: String,
    pub path: &'a str,
}

/// A DNS name we are willing to connect to: no IP literals (v4 in any notation,
/// v6 in brackets), no single-label or local names.
fn public_dns_host(host: &str) -> bool {
    let labels: Vec<&str> = host.split('.').collect();
    let well_formed = host.len() <= 253
        && labels.len() >= 2
        && labels.iter().all(|l| {
            !l.is_empty()
                && l.len() <= 63
                && !l.starts_with('-')
                && !l.ends_with('-')
                && l.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        });
    if !well_formed {
        return false;
    }
    let last = labels[labels.len() - 1];
    // A numeric last label means an IPv4 literal (dotted, octal or hex forms all end in one); no TLD is numeric.
    let numeric_tld = last.bytes().all(|b| b.is_ascii_digit()) || last.starts_with("0x");
    let local = host == "localhost"
        || [
            "localhost",
            "local",
            "internal",
            "localdomain",
            "lan",
            "home",
            "arpa",
            "corp",
        ]
        .contains(&last);
    !numeric_tld && !local
}

/// Parse a strict `https://host[:443]/path[?query]` URL. Rejects userinfo, other
/// ports, IP literals, local names, fragments, backslashes, whitespace, and
/// paths with dot segments or encoded dots/slashes (which could climb out of an
/// allowed prefix once the server decodes them).
pub fn parse_https(url: &str) -> Result<HttpsUrl<'_>, FetchError> {
    let bad = || FetchError::BadUrl(url.chars().take(200).collect());
    if url.len() >= 4096
        || url
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '\\' || c == '#')
    {
        return Err(bad());
    }
    let rest = url.strip_prefix("https://").ok_or_else(bad)?;
    let slash = rest.find('/').ok_or_else(bad)?;
    let (authority, path) = rest.split_at(slash);
    if authority.contains(['@', '[', ']', '?']) {
        return Err(bad());
    }
    let host = match authority.split_once(':') {
        None => authority,
        Some((h, "443")) => h,
        Some(_) => return Err(bad()),
    };
    let host = host.to_ascii_lowercase();
    if !public_dns_host(&host) {
        return Err(bad());
    }
    let path_only = path.split('?').next().unwrap_or_default();
    let lower = path_only.to_ascii_lowercase();
    if path_only.contains("//")
        || path_only.split('/').any(|seg| seg == "." || seg == "..")
        || ["%2e", "%2f", "%5c", "%00"]
            .iter()
            .any(|e| lower.contains(e))
    {
        return Err(bad());
    }
    Ok(HttpsUrl { host, path })
}

/// Only strict `https://` URLs to public DNS names are fetched (`parse_https`).
pub fn check_url(url: &str) -> Result<(), FetchError> {
    parse_https(url).map(|_| ())
}

/// A usable allowed prefix: a strict https URL whose path ends with `/`, so
/// `…/evidence/` can't match `…/evidence-other/…`.
pub fn valid_prefix(prefix: &str) -> bool {
    prefix.len() <= 512
        && !prefix.contains('?')
        && parse_https(prefix).is_ok_and(|p| p.path.ends_with('/'))
}

/// The photo URL must be a strict https URL on an allowed storage host, under an
/// allowed path prefix: one of `ALLOWED_PHOTO_PREFIXES` or the estate's `extra`.
pub fn photo_url_allowed(url: &str, extra: Option<&str>) -> bool {
    let Ok(u) = parse_https(url) else {
        return false;
    };
    let path_only = u.path.split('?').next().unwrap_or_default();
    ALLOWED_PHOTO_PREFIXES
        .iter()
        .copied()
        .chain(extra.filter(|p| valid_prefix(p)))
        .filter_map(|p| parse_https(p).ok())
        .any(|p| {
            p.host == u.host && path_only.starts_with(p.path) && path_only.len() > p.path.len()
        })
}

/// GET `url`, at most `limit` bytes. Redirects are never followed (a 3xx is a
/// failure), so an allowed URL can't bounce the worker to another host or to http.
pub fn get(url: &str, limit: usize) -> Result<Vec<u8>, FetchError> {
    check_url(url)?;
    imp::get(url, limit)
}

/// POST a JSON body with headers; returns the response body (≤ `limit`). The
/// whole exchange (connect, wait for the answer, body) must finish in `deadline`.
/// Redirects are never followed.
pub fn post_json(
    url: &str,
    headers: &[(&str, &str)],
    body: String,
    limit: usize,
    deadline: std::time::Duration,
) -> Result<Vec<u8>, FetchError> {
    check_url(url)?;
    imp::post_json(url, headers, body, limit, deadline)
}

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    use super::FetchError;
    use std::io::Read;
    use std::time::Duration;

    /// `deadline` bounds the whole request; `first_byte` the wait for the response
    /// head. Redirects are off: a 3xx comes back as-is and fails as `Status`.
    /// `https_only` is false only in tests that talk to a local plain-HTTP server.
    fn agent(deadline: Duration, first_byte: Duration, https_only: bool) -> ureq::Agent {
        ureq::Agent::config_builder()
            .timeout_global(Some(deadline))
            .timeout_connect(Some(Duration::from_secs(super::CONNECT_TIMEOUT_S)))
            .timeout_recv_response(Some(first_byte))
            .timeout_per_read(Some(Duration::from_secs(super::READ_TIMEOUT_S)))
            .max_redirects(0)
            .https_only(https_only)
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
        get_with(url, limit, true)
    }

    pub(super) fn get_with(
        url: &str,
        limit: usize,
        https_only: bool,
    ) -> Result<Vec<u8>, FetchError> {
        let resp = agent(
            Duration::from_secs(super::GET_DEADLINE_S),
            Duration::from_secs(super::READ_TIMEOUT_S),
            https_only,
        )
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
        deadline: Duration,
    ) -> Result<Vec<u8>, FetchError> {
        // A non-streaming completion sends nothing until the answer is ready, so the
        // first-byte wait is bounded by the attempt deadline only.
        let mut req = agent(deadline, deadline, true)
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
    fn client_with_timeouts(first_byte: Duration) -> Client {
        let mut c = Client::new();
        c.set_connect_timeout(Duration::from_secs(super::CONNECT_TIMEOUT_S));
        c.set_first_byte_timeout(first_byte);
        c.set_between_bytes_timeout(Duration::from_secs(super::READ_TIMEOUT_S));
        c
    }

    async fn read(
        client: &Client,
        req: Request<Body>,
        limit: usize,
    ) -> Result<Vec<u8>, FetchError> {
        // wasi:http never follows redirects itself; a 3xx lands here and fails, so
        // the worker can't be bounced to another host or to plain http.
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
    /// under `deadline`, enforced with wasi:clocks, which every host has.
    fn send(
        build: impl Fn() -> Result<Request<Body>, FetchError>,
        limit: usize,
        deadline: Duration,
        first_byte: Duration,
    ) -> Result<Vec<u8>, FetchError> {
        let ms = deadline.as_millis();
        let deadline: wstd::time::Duration = deadline.into();
        wstd::runtime::block_on(async {
            let attempt = async {
                match read(&client_with_timeouts(first_byte), build()?, limit).await {
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
                Err(FetchError::Transport(format!("deadline {ms} ms exceeded")))
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
        send(
            build,
            limit,
            Duration::from_secs(super::GET_DEADLINE_S),
            Duration::from_secs(super::READ_TIMEOUT_S),
        )
    }

    pub fn post_json(
        url: &str,
        headers: &[(&str, &str)],
        body: String,
        limit: usize,
        deadline: Duration,
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
        // A non-streaming completion sends nothing until the answer is ready.
        send(build, limit, deadline, deadline)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OK: &str = "https://oshxsrhnynauyxcraymy.supabase.co/storage/v1/object/public/evidence/harmattan-court/17.jpg";

    #[test]
    fn only_https() {
        assert!(check_url("https://x.supabase.co/a.jpg").is_ok());
        assert!(check_url("https://x.supabase.co:443/a.jpg").is_ok());
        assert!(check_url("http://x.supabase.co/a.jpg").is_err());
        assert!(check_url("file:///etc/passwd").is_err());
        assert!(check_url("https://").is_err());
        assert!(check_url("https:///x").is_err());
        assert!(check_url("https://x.supabase.co").is_err());
        assert!(check_url("https://x.supabase.co/a b.jpg").is_err());
        assert!(matches!(get("ftp://x", 10), Err(FetchError::BadUrl(_))));
    }

    #[test]
    fn no_ip_literals_local_names_or_tricks() {
        for bad in [
            "https://127.0.0.1/a.jpg",
            "https://10.0.0.5/a.jpg",
            "https://169.254.169.254/latest/meta-data/",
            "https://2130706433/a.jpg",
            "https://0x7f.0x0.0x0.0x1/a.jpg",
            "https://0177.0.0.1/a.jpg",
            "https://[::1]/a.jpg",
            "https://[fd00::1]/a.jpg",
            "https://localhost/a.jpg",
            "https://foo.localhost/a.jpg",
            "https://metadata.google.internal/a.jpg",
            "https://printer.local/a.jpg",
            "https://intranet/a.jpg",
            "https://user:pw@x.supabase.co/a.jpg",
            "https://x.supabase.co@evil.com/a.jpg",
            "https://x.supabase.co:8443/a.jpg",
            "https://x.supabase.co:80/a.jpg",
            "https://x.supabase.co./a.jpg",
            "https://x.supabase.co\\@evil.com/a.jpg",
            "https://x.supabase.co/a.jpg#frag",
            "https://x.supabase.co/a/../b.jpg",
            "https://x.supabase.co/a/%2e%2e/b.jpg",
            "https://x.supabase.co/a%2Fb.jpg",
            "https://x.supabase.co//b.jpg",
            "https://-x.supabase.co/a.jpg",
            "https://x_y.supabase.co/a.jpg",
        ] {
            assert!(check_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn photo_allowlist() {
        assert!(photo_url_allowed(OK, None));
        assert!(photo_url_allowed(
            &OK.replace("https://oshx", "https://OSHX"),
            None
        ));
        assert!(photo_url_allowed(&format!("{OK}?v=2"), None));
        for bad in [
            // Other hosts, other buckets, other schemes.
            "https://example.supabase.co/storage/v1/object/public/evidence/x/17.jpg",
            "https://oshxsrhnynauyxcraymy.supabase.co/storage/v1/object/public/other/x.jpg",
            "https://oshxsrhnynauyxcraymy.supabase.co/storage/v1/object/public/evidence-x/a.jpg",
            "https://oshxsrhnynauyxcraymy.supabase.co/storage/v1/object/sign/evidence/a.jpg",
            "https://oshxsrhnynauyxcraymy.supabase.co/storage/v1/object/public/evidence/",
            "http://oshxsrhnynauyxcraymy.supabase.co/storage/v1/object/public/evidence/a.jpg",
            "https://oshxsrhnynauyxcraymy.supabase.co.evil.com/storage/v1/object/public/evidence/a.jpg",
            "https://evil.com/oshxsrhnynauyxcraymy.supabase.co/storage/v1/object/public/evidence/a.jpg",
            // Climbing out of the prefix.
            "https://oshxsrhnynauyxcraymy.supabase.co/storage/v1/object/public/evidence/../../../rest/v1/x",
            "https://oshxsrhnynauyxcraymy.supabase.co/storage/v1/object/public/evidence/%2e%2e/secret",
            "https://169.254.169.254/storage/v1/object/public/evidence/a.jpg",
        ] {
            assert!(!photo_url_allowed(bad, None), "{bad}");
        }
        // The estate's extra prefix.
        let extra = Some("https://cdn.example.org/plote/");
        assert!(photo_url_allowed(
            "https://cdn.example.org/plote/a.jpg",
            extra
        ));
        assert!(!photo_url_allowed(
            "https://cdn.example.org/plote2/a.jpg",
            extra
        ));
        assert!(!photo_url_allowed(
            "https://cdn.example.org/plote/a.jpg",
            None
        ));
        assert!(photo_url_allowed(OK, extra));
        // Unusable extra prefixes are ignored.
        for p in [
            "https://cdn.example.org/plote",
            "http://cdn.example.org/plote/",
            "https://127.0.0.1/",
            "https://localhost/x/",
            "https://cdn.example.org/plote/?x=1",
        ] {
            assert!(!valid_prefix(p), "{p}");
            assert!(!photo_url_allowed(&format!("{p}a.jpg"), Some(p)), "{p}");
        }
        assert!(valid_prefix("https://cdn.example.org/"));
    }

    #[test]
    fn transient_errors() {
        for e in [
            FetchError::Status(429),
            FetchError::Status(500),
            FetchError::Status(503),
            FetchError::Status(408),
            FetchError::Transport("deadline exceeded".into()),
        ] {
            assert!(e.is_transient(), "{e}");
        }
        for e in [
            FetchError::Status(400),
            FetchError::Status(401),
            FetchError::Status(403),
            FetchError::Status(302),
            FetchError::TooLarge,
            FetchError::BadUrl("x".into()),
        ] {
            assert!(!e.is_transient(), "{e}");
        }
    }

    /// A one-shot local plain-HTTP server answering `reply` (tests only).
    #[cfg(not(target_arch = "wasm32"))]
    fn serve_once(reply: &'static [u8], delay_s: u64) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        let h = std::thread::spawn(move || {
            if let Ok((mut s, _)) = l.accept() {
                let mut buf = [0u8; 512];
                let _ = s.read(&mut buf);
                std::thread::sleep(std::time::Duration::from_secs(delay_s));
                let _ = s.write_all(reply);
            }
        });
        (format!("http://{addr}"), h)
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn redirects_are_not_followed() {
        let (base, h) = serve_once(
            b"HTTP/1.1 302 Found\r\nlocation: http://127.0.0.1:1/other.jpg\r\ncontent-length: 0\r\n\r\n",
            0,
        );
        // (get() requires https; the inner implementation is called on plain http here.)
        let r = imp::get_with(&format!("{base}/x.jpg"), 100, false);
        assert_eq!(r, Err(FetchError::Status(302)));
        let _ = h.join();
        // The production client refuses plain http outright.
        assert!(imp::get("http://127.0.0.1:1/x.jpg", 100).is_err());
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn dripping_server_hits_the_deadline() {
        // A plain-HTTP server that accepts and never answers in time: the native client
        // must give up after READ_TIMEOUT_S rather than hang.
        let (base, h) = serve_once(
            b"HTTP/1.1 200 OK\r\ncontent-length: 1\r\n\r\nx",
            READ_TIMEOUT_S + 3,
        );
        let start = std::time::Instant::now();
        let r = imp::get_with(&format!("{base}/x.jpg"), 100, false);
        assert!(matches!(r, Err(FetchError::Transport(_))), "{r:?}");
        assert!(start.elapsed().as_secs() <= READ_TIMEOUT_S + 2);
        let _ = h.join();
    }
}
