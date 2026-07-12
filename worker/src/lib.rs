//! Worker entry: routing + the daily cron. Handlers live in `api` (public
//! endpoints) and `auth` (sign-in); `feeder` ingests sources; `http` holds
//! shared outbound helpers. Pure decision logic is in the `authcore` crate.

mod api;
mod auth;
mod feeder;
mod http;

use worker::*;

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    console_error_panic_hook::set_once();
    Router::new()
        .get_async("/api/health", api::health)
        .get_async("/api/passages", api::passages)
        .post_async("/api/results", api::post_result)
        .post_async("/api/feed", api::feed)
        .get_async("/auth/login/:provider", auth::login)
        .get_async("/auth/callback/:provider", auth::callback)
        .post_async("/auth/logout", auth::logout)
        .post_async("/auth/unlink/:provider", auth::unlink)
        .get_async("/api/me", auth::me)
        .post_async("/api/me", auth::update_me)
        .run(req, env)
        .await
}

#[event(scheduled)]
async fn scheduled(_event: ScheduledEvent, env: Env, _ctx: ScheduleContext) {
    console_error_panic_hook::set_once();
    match feeder::run(&env).await {
        Ok(r) => console_log!(
            "feeder: {} feeds ok, {} new articles, {} new passages, errors: {:?}",
            r.feeds_ok,
            r.articles_new,
            r.passages_new,
            r.errors
        ),
        Err(e) => console_error!("feeder failed: {e}"),
    }
}

/// Random-passage, count, and session-scoped responses must never be cached.
pub(crate) fn no_store(mut resp: Response) -> Result<Response> {
    resp.headers_mut().set("cache-control", "no-store")?;
    Ok(resp)
}
