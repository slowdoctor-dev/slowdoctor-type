//! Social sign-in: Google / Kakao / GitHub OAuth 2.0 code flow with
//! D1-backed sessions and account linking (one user, N provider identities).
//!
//! Privacy stance (Director 2026-07-11): no email collection — only the
//! provider's stable uid and a display name snapshot. Google scope is
//! `openid profile` (no email); Kakao/GitHub use their default public scopes.
//!
//! Secrets (Cloudflare → Worker → Settings → Variables and Secrets):
//! GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, KAKAO_CLIENT_ID/KAKAO_CLIENT_SECRET,
//! GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET. A provider with missing secrets
//! answers 503 and the rest keep working.

use worker::*;

const SESSION_COOKIE: &str = "sdtype_session";
const STATE_COOKIE: &str = "sdtype_oauth";
const SESSION_DAYS: u32 = 30;

/// Avatar = generated 8×8 mirrored pattern × background hue, stored as
/// `<8 hex chars>|<hue 0-359>` (32 pattern bits; the client renders them as
/// a symmetric identicon). Randomly assigned at signup; rerolled/customized
/// in the account panel — no image uploads. Rendering lives in
/// web/src/account.ts (`avatarSvg`). The 0006 migration's column default is
/// a legacy placeholder; the server always writes an explicit value.
fn random_avatar() -> String {
    let mut buf = [0u8; 6];
    getrandom::getrandom(&mut buf).expect("entropy");
    let hue = (u32::from(buf[4]) << 8 | u32::from(buf[5])) % 360;
    format!(
        "{:02x}{:02x}{:02x}{:02x}|{hue}",
        buf[0], buf[1], buf[2], buf[3]
    )
}

/// `<8 hex chars>|<hue 0-359>`.
fn valid_avatar(avatar: &str) -> bool {
    let Some((hex, hue)) = avatar.split_once('|') else {
        return false;
    };
    let hex_ok = hex.len() == 8 && hex.bytes().all(|b| b.is_ascii_hexdigit());
    let hue_ok = hue.parse::<u32>().map(|h| h < 360).unwrap_or(false);
    hex_ok && hue_ok
}

struct Provider {
    key: &'static str,
    authorize: &'static str,
    token: &'static str,
    scope: &'static str,
    id_var: &'static str,
    secret_var: &'static str,
}

fn provider(key: &str) -> Option<Provider> {
    match key {
        "google" => Some(Provider {
            key: "google",
            authorize: "https://accounts.google.com/o/oauth2/v2/auth",
            token: "https://oauth2.googleapis.com/token",
            scope: "openid profile",
            id_var: "GOOGLE_CLIENT_ID",
            secret_var: "GOOGLE_CLIENT_SECRET",
        }),
        "kakao" => Some(Provider {
            key: "kakao",
            authorize: "https://kauth.kakao.com/oauth/authorize",
            token: "https://kauth.kakao.com/oauth/token",
            scope: "",
            id_var: "KAKAO_CLIENT_ID",
            secret_var: "KAKAO_CLIENT_SECRET",
        }),
        "github" => Some(Provider {
            key: "github",
            authorize: "https://github.com/login/oauth/authorize",
            token: "https://github.com/login/oauth/access_token",
            scope: "",
            id_var: "GITHUB_CLIENT_ID",
            secret_var: "GITHUB_CLIENT_SECRET",
        }),
        _ => None,
    }
}

// --- route handlers ---

/// GET /auth/login/:provider[?link=1] — redirect to the provider's consent page.
pub async fn login(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let Some(p) = ctx.param("provider").and_then(|s| provider(s)) else {
        return Response::error("unknown provider", 404);
    };
    let Ok(client_id) = ctx.env.secret(p.id_var) else {
        return Response::error("provider not configured", 503);
    };
    let link = req
        .url()?
        .query_pairs()
        .any(|(k, v)| k == "link" && v == "1");
    let state = rand_hex(16);
    let redirect_uri = callback_uri(&req, p.key)?;
    let mut url = format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&state={}",
        p.authorize,
        urlencode(&client_id.to_string()),
        urlencode(&redirect_uri),
        state
    );
    if !p.scope.is_empty() {
        url.push_str(&format!("&scope={}", urlencode(p.scope)));
    }
    let mode = if link { "link" } else { "login" };
    let mut resp = Response::redirect(Url::parse(&url)?)?;
    resp.headers_mut().append(
        "set-cookie",
        &format!("{STATE_COOKIE}={state}.{mode}; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax"),
    )?;
    Ok(resp)
}

/// GET /auth/callback/:provider — code exchange, identity upsert, session.
pub async fn callback(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let Some(p) = ctx.param("provider").and_then(|s| provider(s)) else {
        return Response::error("unknown provider", 404);
    };
    let url = req.url()?;
    let q = |name: &str| {
        url.query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.to_string())
    };
    let (Some(code), Some(state)) = (q("code"), q("state")) else {
        return finish(&req, "denied", None); // user cancelled on consent page
    };
    let Some(state_cookie) = cookie(&req, STATE_COOKIE) else {
        return finish(&req, "expired", None);
    };
    let (want_state, mode) = state_cookie.split_once('.').unwrap_or((state_cookie.as_str(), "login"));
    if want_state != state {
        return finish(&req, "expired", None);
    }
    let linking = mode == "link";

    let client_id = ctx.env.secret(p.id_var)?.to_string();
    let client_secret = ctx.env.secret(p.secret_var)?.to_string();
    let token_body = format!(
        "grant_type=authorization_code&code={}&client_id={}&client_secret={}&redirect_uri={}",
        urlencode(&code),
        urlencode(&client_id),
        urlencode(&client_secret),
        urlencode(&callback_uri(&req, p.key)?)
    );
    let token_json = http_post_form(p.token, &token_body).await?;
    let Some(access_token) = token_json["access_token"].as_str() else {
        return Err(Error::RustError(format!("{}: no access_token", p.key)));
    };

    let (uid, display) = fetch_identity(p.key, access_token).await?;

    let db = ctx.env.d1("DB")?;
    let current = session_user_id(&db, &req).await?;
    let existing: Option<i64> = db
        .prepare("SELECT user_id FROM identities WHERE provider = ?1 AND provider_uid = ?2")
        .bind(&[p.key.into(), uid.as_str().into()])?
        .first::<serde_json::Value>(None)
        .await?
        .and_then(|v| v.get("user_id").and_then(|n| n.as_i64()));

    let user_id = match (existing, linking, current) {
        // identity already bound elsewhere while linking → refuse, keep session
        (Some(owner), true, Some(me)) if owner != me => {
            return finish(&req, "conflict", None);
        }
        (Some(owner), _, _) => owner,
        (None, true, Some(me)) => {
            insert_identity(&db, p.key, &uid, me, &display).await?;
            me
        }
        // "link" clicked but the session died mid-flow — creating a fresh
        // account here would silently split the user's profile in two
        (None, true, None) => {
            return finish(&req, "expired", None);
        }
        (None, _, _) => {
            let nickname: String = display.chars().take(20).collect();
            db.prepare("INSERT INTO users (nickname, avatar) VALUES (?1, ?2)")
                .bind(&[nickname.as_str().into(), random_avatar().as_str().into()])?
                .run()
                .await?;
            let id = db
                .prepare("SELECT last_insert_rowid() AS id")
                .first::<serde_json::Value>(None)
                .await?
                .and_then(|v| v.get("id").and_then(|n| n.as_i64()))
                .ok_or_else(|| Error::RustError("user insert: no id".into()))?;
            insert_identity(&db, p.key, &uid, id, &display).await?;
            id
        }
    };

    let token = rand_hex(32);
    db.prepare(
        "INSERT INTO sessions (token, user_id, expires_at) \
         VALUES (?1, ?2, datetime('now', ?3))",
    )
    .bind(&[
        token.as_str().into(),
        (user_id as f64).into(),
        format!("+{SESSION_DAYS} days").into(),
    ])?
    .run()
    .await?;

    finish(&req, if linking { "linked" } else { "ok" }, Some(&token))
}

/// POST /auth/logout — drop the session row and clear the cookie.
pub async fn logout(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    if !same_origin(&req) {
        return Response::error("forbidden", 403);
    }
    let db = ctx.env.d1("DB")?;
    if let Some(token) = cookie(&req, SESSION_COOKIE) {
        db.prepare("DELETE FROM sessions WHERE token = ?1")
            .bind(&[token.as_str().into()])?
            .run()
            .await?;
    }
    let mut resp = Response::from_json(&serde_json::json!({ "ok": true }))?;
    resp.headers_mut().append("set-cookie", &clear_cookie(SESSION_COOKIE))?;
    Ok(resp)
}

/// POST /auth/unlink/:provider — detach an identity (never the last one).
pub async fn unlink(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    if !same_origin(&req) {
        return Response::error("forbidden", 403);
    }
    let Some(p) = ctx.param("provider").and_then(|s| provider(s)) else {
        return Response::error("unknown provider", 404);
    };
    let db = ctx.env.d1("DB")?;
    let Some(user_id) = session_user_id(&db, &req).await? else {
        return Response::error("unauthorized", 401);
    };
    let n = count_identities(&db, user_id).await?;
    if n <= 1 {
        return Response::error("cannot unlink the last sign-in method", 400);
    }
    db.prepare("DELETE FROM identities WHERE user_id = ?1 AND provider = ?2")
        .bind(&[(user_id as f64).into(), p.key.into()])?
        .run()
        .await?;
    Response::from_json(&serde_json::json!({ "ok": true }))
}

/// GET /api/me — profile + linked providers, or `{"user": null}`.
pub async fn me(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let db = ctx.env.d1("DB")?;
    let Some(user_id) = session_user_id(&db, &req).await? else {
        return crate::no_store(Response::from_json(&serde_json::json!({ "user": null }))?);
    };
    let user = db
        .prepare("SELECT nickname, avatar FROM users WHERE id = ?1")
        .bind(&[(user_id as f64).into()])?
        .first::<serde_json::Value>(None)
        .await?;
    #[derive(serde::Deserialize)]
    struct Ident {
        provider: String,
    }
    let providers: Vec<String> = db
        .prepare("SELECT provider FROM identities WHERE user_id = ?1 ORDER BY created_at")
        .bind(&[(user_id as f64).into()])?
        .all()
        .await?
        .results::<Ident>()?
        .into_iter()
        .map(|i| i.provider)
        .collect();
    crate::no_store(Response::from_json(
        &serde_json::json!({ "user": user, "providers": providers }),
    )?)
}

/// POST /api/me — update nickname and/or emoji avatar.
pub async fn update_me(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    if !same_origin(&req) {
        return Response::error("forbidden", 403);
    }
    let db = ctx.env.d1("DB")?;
    let Some(user_id) = session_user_id(&db, &req).await? else {
        return Response::error("unauthorized", 401);
    };
    #[derive(serde::Deserialize)]
    struct Update {
        nickname: Option<String>,
        avatar: Option<String>,
    }
    let Ok(u) = req.json::<Update>().await else {
        return Response::error("bad json", 400);
    };
    if let Some(nick) = &u.nickname {
        let nick = nick.trim();
        if nick.is_empty() || nick.chars().count() > 20 {
            return Response::error("nickname must be 1-20 chars", 400);
        }
        db.prepare("UPDATE users SET nickname = ?1 WHERE id = ?2")
            .bind(&[nick.into(), (user_id as f64).into()])?
            .run()
            .await?;
    }
    if let Some(avatar) = &u.avatar {
        let avatar = avatar.trim();
        if !valid_avatar(avatar) {
            return Response::error("avatar must be <emoji>|<hue 0-359>", 400);
        }
        db.prepare("UPDATE users SET avatar = ?1 WHERE id = ?2")
            .bind(&[avatar.into(), (user_id as f64).into()])?
            .run()
            .await?;
    }
    Response::from_json(&serde_json::json!({ "ok": true }))
}

/// Signed-in user for a request, if any (used here and to tag results).
pub async fn session_user_id(db: &D1Database, req: &Request) -> Result<Option<i64>> {
    let Some(token) = cookie(req, SESSION_COOKIE) else {
        return Ok(None);
    };
    let row = db
        .prepare(
            "SELECT user_id, expires_at FROM sessions WHERE token = ?1 \
             AND expires_at > datetime('now')",
        )
        .bind(&[token.as_str().into()])?
        .first::<serde_json::Value>(None)
        .await?;
    Ok(row.and_then(|v| v.get("user_id").and_then(|n| n.as_i64())))
}

// --- helpers ---

async fn insert_identity(
    db: &D1Database,
    provider: &str,
    uid: &str,
    user_id: i64,
    display: &str,
) -> Result<()> {
    db.prepare(
        "INSERT INTO identities (provider, provider_uid, user_id, display) \
         VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(&[
        provider.into(),
        uid.into(),
        (user_id as f64).into(),
        display.into(),
    ])?
    .run()
    .await?;
    Ok(())
}

async fn count_identities(db: &D1Database, user_id: i64) -> Result<i64> {
    let row = db
        .prepare("SELECT COUNT(*) AS n FROM identities WHERE user_id = ?1")
        .bind(&[(user_id as f64).into()])?
        .first::<serde_json::Value>(None)
        .await?;
    Ok(row.and_then(|v| v.get("n").and_then(|n| n.as_i64())).unwrap_or(0))
}

/// Provider profile → (stable uid, display name).
async fn fetch_identity(provider: &str, access_token: &str) -> Result<(String, String)> {
    match provider {
        "google" => {
            let v = http_get_json(
                "https://openidconnect.googleapis.com/v1/userinfo",
                access_token,
            )
            .await?;
            let uid = v["sub"]
                .as_str()
                .ok_or_else(|| Error::RustError("google: no sub".into()))?
                .to_string();
            let name = v["name"].as_str().unwrap_or("typist").to_string();
            Ok((uid, name))
        }
        "kakao" => {
            let v = http_get_json("https://kapi.kakao.com/v2/user/me", access_token).await?;
            let uid = v["id"]
                .as_i64()
                .ok_or_else(|| Error::RustError("kakao: no id".into()))?
                .to_string();
            let name = v["properties"]["nickname"]
                .as_str()
                .or_else(|| v["kakao_account"]["profile"]["nickname"].as_str())
                .unwrap_or("typist")
                .to_string();
            Ok((uid, name))
        }
        "github" => {
            let v = http_get_json("https://api.github.com/user", access_token).await?;
            let uid = v["id"]
                .as_i64()
                .ok_or_else(|| Error::RustError("github: no id".into()))?
                .to_string();
            let name = v["login"].as_str().unwrap_or("typist").to_string();
            Ok((uid, name))
        }
        _ => Err(Error::RustError("unknown provider".into())),
    }
}

/// Post-callback redirect to `/?auth=<status>`, optionally setting the session.
fn finish(req: &Request, status: &str, session_token: Option<&str>) -> Result<Response> {
    let mut home = req.url()?;
    home.set_path("/");
    home.set_query(Some(&format!("auth={status}")));
    let mut resp = Response::redirect(home)?;
    if let Some(token) = session_token {
        let max_age = SESSION_DAYS * 86_400;
        resp.headers_mut().append(
            "set-cookie",
            &format!("{SESSION_COOKIE}={token}; Max-Age={max_age}; Path=/; HttpOnly; Secure; SameSite=Lax"),
        )?;
    }
    resp.headers_mut().append("set-cookie", &clear_cookie(STATE_COOKIE))?;
    Ok(resp)
}

fn clear_cookie(name: &str) -> String {
    format!("{name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax")
}

fn callback_uri(req: &Request, provider: &str) -> Result<String> {
    let url = req.url()?;
    let origin = url.origin().ascii_serialization();
    Ok(format!("{origin}/auth/callback/{provider}"))
}

fn cookie(req: &Request, name: &str) -> Option<String> {
    let header = req.headers().get("cookie").ok().flatten()?;
    for part in header.split(';') {
        let (k, v) = part.trim().split_once('=')?;
        if k == name {
            return Some(v.to_string());
        }
    }
    None
}

/// Browser-sent mutations must come from our own origin (CSRF guard on top
/// of SameSite=Lax; requests without an Origin header are non-browser tools).
fn same_origin(req: &Request) -> bool {
    let Ok(Some(origin)) = req.headers().get("origin") else {
        return true;
    };
    req.url()
        .map(|u| origin == u.origin().ascii_serialization())
        .unwrap_or(false)
}

fn rand_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).expect("entropy");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn urlencode(s: &str) -> String {
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

async fn http_post_form(url: &str, body: &str) -> Result<serde_json::Value> {
    let headers = Headers::new();
    headers.set("content-type", "application/x-www-form-urlencoded")?;
    headers.set("accept", "application/json")?; // github answers form-encoded otherwise
    headers.set("user-agent", "slowdoctor-type/0.1 (https://type.slowdoctor.dev)")?;
    let req = Request::new_with_init(
        url,
        RequestInit::new()
            .with_method(Method::Post)
            .with_headers(headers)
            .with_body(Some(body.into())),
    )?;
    let mut resp = Fetch::Request(req).send().await?;
    let text = resp.text().await?;
    if resp.status_code() != 200 {
        return Err(Error::RustError(format!("POST {url} -> {}", resp.status_code())));
    }
    serde_json::from_str(&text).map_err(|e| Error::RustError(format!("{url}: bad json: {e}")))
}

async fn http_get_json(url: &str, bearer: &str) -> Result<serde_json::Value> {
    let headers = Headers::new();
    headers.set("authorization", &format!("Bearer {bearer}"))?;
    headers.set("accept", "application/json")?;
    headers.set("user-agent", "slowdoctor-type/0.1 (https://type.slowdoctor.dev)")?;
    let req = Request::new_with_init(
        url,
        RequestInit::new()
            .with_method(Method::Get)
            .with_headers(headers),
    )?;
    let mut resp = Fetch::Request(req).send().await?;
    let text = resp.text().await?;
    if resp.status_code() != 200 {
        return Err(Error::RustError(format!("GET {url} -> {}", resp.status_code())));
    }
    serde_json::from_str(&text).map_err(|e| Error::RustError(format!("{url}: bad json: {e}")))
}
