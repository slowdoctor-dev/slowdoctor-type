//! Public API handlers: health, random passage, anonymous results, manual
//! feed. Sign-in endpoints live in `auth`; routing in `lib.rs`.

use worker::*;

use crate::no_store;

/// Must list the same keys as web/src/tracks.ts (see AGENTS.md conventions).
const TRACKS: &[&str] = &["news", "daily", "pmc", "federal"];

#[derive(serde::Serialize, serde::Deserialize)]
struct Passage {
    id: i64,
    text: String,
    word_count: i64,
    title: String,
    url: String,
    attribution: String,
    track: String,
}

#[derive(serde::Deserialize)]
struct ResultIn {
    passage_id: Option<i64>,
    wpm: f64,
    raw_wpm: f64,
    accuracy: f64,
    consistency: f64,
    duration_ms: i64,
}

/// GET /api/health — counts, per-track counts, last feeder run.
pub async fn health(_req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let db = ctx.env.d1("DB")?;
    let articles = count(&db, "articles").await?;
    let passages = count(&db, "passages").await?;
    #[derive(serde::Deserialize)]
    struct TrackRow {
        track: String,
        n: i64,
    }
    let rows = db
        .prepare(
            "SELECT a.track AS track, COUNT(*) AS n FROM passages p \
             JOIN articles a ON a.id = p.article_id GROUP BY a.track",
        )
        .all()
        .await?
        .results::<TrackRow>()?;
    let mut tracks = serde_json::Map::new();
    for t in TRACKS {
        tracks.insert(t.to_string(), serde_json::json!(0));
    }
    for r in rows {
        tracks.insert(r.track, serde_json::json!(r.n));
    }
    // latest feeder run — articles_new stuck at 0 or errors piling up
    // means a source contract drifted (see AGENTS.md extraction notes)
    let mut last_feed = db
        .prepare(
            "SELECT at, feeds_ok, items_seen, articles_new, passages_new, errors \
             FROM feed_log ORDER BY id DESC LIMIT 1",
        )
        .first::<serde_json::Value>(None)
        .await
        .unwrap_or(None);
    // errors is stored as a JSON string — surface it as a real array
    if let Some(obj) = last_feed.as_mut().and_then(|v| v.as_object_mut()) {
        if let Some(parsed) = obj
            .get("errors")
            .and_then(|e| e.as_str())
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        {
            obj.insert("errors".into(), parsed);
        }
    }
    no_store(Response::from_json(&serde_json::json!({
        "ok": true, "articles": articles, "passages": passages, "tracks": tracks,
        "last_feed": last_feed
    }))?)
}

/// GET /api/passages?track=<t> — one random passage from the track.
pub async fn passages(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let url = req.url()?;
    let track = url
        .query_pairs()
        .find(|(k, _)| k == "track")
        .map(|(_, v)| v.to_string())
        .unwrap_or_else(|| "news".to_string());
    if !TRACKS.contains(&track.as_str()) {
        return Response::error("unknown track", 400);
    }
    let db = ctx.env.d1("DB")?;
    // two-step pick: shuffle over narrow ids only, then fetch one row
    // by PK — ORDER BY RANDOM() over full rows drags every passage's
    // text through the sorter and grows linearly with the feed.
    let picked = db
        .prepare(
            "SELECT p.id AS id FROM passages p JOIN articles a ON a.id = p.article_id \
             WHERE a.track = ?1 ORDER BY RANDOM() LIMIT 1",
        )
        .bind(&[track.as_str().into()])?
        .first::<serde_json::Value>(None)
        .await?
        .and_then(|v| v.get("id").and_then(|n| n.as_i64()));
    let row = match picked {
        Some(pid) => {
            db.prepare(
                "SELECT p.id, p.text, p.word_count, a.title, a.url, a.attribution, a.track \
                 FROM passages p JOIN articles a ON a.id = p.article_id WHERE p.id = ?1",
            )
            .bind(&[(pid as f64).into()])?
            .first::<Passage>(None)
            .await?
        }
        None => None,
    };
    let resp = match row {
        Some(p) => Response::from_json(&serde_json::json!({ "passage": p })),
        None => Response::from_json(&serde_json::json!({
            "passage": null,
            "hint": "track is empty — run the feeder (POST /api/feed) or wait for the daily cron"
        })),
    }?;
    no_store(resp)
}

/// POST /api/results — anonymous aggregate stats (user-tagged when signed in).
pub async fn post_result(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let Ok(r) = req.json::<ResultIn>().await else {
        return Response::error("bad json", 400);
    };
    let sane = (0.0..=400.0).contains(&r.wpm)
        && (0.0..=500.0).contains(&r.raw_wpm)
        && (0.0..=100.0).contains(&r.accuracy)
        && (0.0..=100.0).contains(&r.consistency)
        && (3_000..=1_800_000).contains(&r.duration_ms);
    if !sane {
        return Response::error("result out of range", 400);
    }
    let db = ctx.env.d1("DB")?;
    // server-side plausibility: the claimed pace cannot meaningfully
    // exceed what the referenced passage allows in the claimed time.
    // Client stats stay client-computed; this only rejects nonsense.
    if let Some(pid) = r.passage_id {
        let wc = db
            .prepare("SELECT word_count AS wc FROM passages WHERE id = ?1")
            .bind(&[(pid as f64).into()])?
            .first::<serde_json::Value>(None)
            .await?
            .and_then(|v| v.get("wc").and_then(|n| n.as_i64()));
        let Some(wc) = wc else {
            return Response::error("unknown passage", 400);
        };
        let implied_wpm = wc as f64 / (r.duration_ms as f64 / 60_000.0);
        if implied_wpm > 400.0 || r.wpm > implied_wpm * 1.5 + 10.0 {
            return Response::error("result implausible", 400);
        }
    }
    let user_id = crate::auth::session_user_id(&db, &req).await?; // for future ranking
    db.prepare(
        "INSERT INTO results (passage_id, wpm, raw_wpm, accuracy, consistency, duration_ms, user_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(&[
        match r.passage_id {
            Some(id) => (id as f64).into(),
            None => wasm_bindgen::JsValue::NULL,
        },
        r.wpm.into(),
        r.raw_wpm.into(),
        r.accuracy.into(),
        r.consistency.into(),
        (r.duration_ms as f64).into(),
        match user_id {
            Some(id) => (id as f64).into(),
            None => wasm_bindgen::JsValue::NULL,
        },
    ])?
    .run()
    .await?;
    Response::from_json(&serde_json::json!({ "ok": true }))
}

/// POST /api/feed — token-guarded manual feeder run.
pub async fn feed(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    // intentionally-unset token is "not configured", not a server bug
    let Ok(token) = ctx.env.secret("FEED_TOKEN") else {
        return Response::error("feed token not configured", 503);
    };
    let expected = format!("Bearer {token}");
    let got = req.headers().get("authorization")?.unwrap_or_default();
    if got != expected {
        return Response::error("unauthorized", 401);
    }
    let report = crate::feeder::run(&ctx.env).await?;
    Response::from_json(&report)
}

async fn count(db: &D1Database, table: &str) -> Result<i64> {
    // `table` comes from internal call sites only — never user input
    let row = db
        .prepare(&format!("SELECT COUNT(*) AS n FROM {table}"))
        .first::<serde_json::Value>(None)
        .await?;
    Ok(row
        .and_then(|v| v.get("n").and_then(|n| n.as_i64()))
        .unwrap_or(0))
}
