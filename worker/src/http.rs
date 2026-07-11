//! Shared outbound HTTP helpers and percent-encoding for the feeder (RSS /
//! article fetches) and auth (OAuth token + profile endpoints).

use worker::*;

const USER_AGENT: &str =
    "slowdoctor-type/0.1 (personal typing trainer; https://type.slowdoctor.dev)";

fn base_headers() -> Result<Headers> {
    let headers = Headers::new();
    headers.set("user-agent", USER_AGENT)?;
    Ok(headers)
}

async fn send_expect_200(req: Request, url: &str) -> Result<String> {
    let mut resp = Fetch::Request(req).send().await?;
    let status = resp.status_code();
    let text = resp.text().await?;
    if status != 200 {
        return Err(Error::RustError(format!("{url} -> {status}")));
    }
    Ok(text)
}

/// GET returning the body as text (feeds, article pages).
pub(crate) async fn get_text(url: &str) -> Result<String> {
    let req = Request::new_with_init(
        url,
        RequestInit::new()
            .with_method(Method::Get)
            .with_headers(base_headers()?),
    )?;
    send_expect_200(req, url).await
}

/// GET returning JSON, optionally authenticated (provider profile APIs).
pub(crate) async fn get_json(url: &str, bearer: Option<&str>) -> Result<serde_json::Value> {
    let headers = base_headers()?;
    headers.set("accept", "application/json")?;
    if let Some(token) = bearer {
        headers.set("authorization", &format!("Bearer {token}"))?;
    }
    let req = Request::new_with_init(
        url,
        RequestInit::new()
            .with_method(Method::Get)
            .with_headers(headers),
    )?;
    let text = send_expect_200(req, url).await?;
    serde_json::from_str(&text).map_err(|e| Error::RustError(format!("{url}: bad json: {e}")))
}

/// POST a form-encoded body, expecting JSON back (OAuth token endpoints;
/// the accept header matters — GitHub answers form-encoded without it).
pub(crate) async fn post_form(url: &str, body: &str) -> Result<serde_json::Value> {
    let headers = base_headers()?;
    headers.set("content-type", "application/x-www-form-urlencoded")?;
    headers.set("accept", "application/json")?;
    let req = Request::new_with_init(
        url,
        RequestInit::new()
            .with_method(Method::Post)
            .with_headers(headers)
            .with_body(Some(body.into())),
    )?;
    let text = send_expect_200(req, url).await?;
    serde_json::from_str(&text).map_err(|e| Error::RustError(format!("{url}: bad json: {e}")))
}

/// Minimal RFC 3986 percent-encoding (unreserved chars kept).
pub(crate) fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
