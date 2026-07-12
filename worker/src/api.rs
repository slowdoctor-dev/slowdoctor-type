//! Public API handlers: health, random passage, anonymous results, manual
//! feed. Sign-in endpoints live in `auth`; routing in `lib.rs`.

use worker::*;

use crate::no_store;

/// Must list the same keys as web/src/tracks.ts (see AGENTS.md conventions).
const TRACKS: &[&str] = &["news", "daily", "pmc", "federal", "vocab", "code"];

/// Must list the same keys as CODE_LANGS in web/src/tracks.ts. Each language
/// is one seeded article with id `code-<lang>` (scripts/gen_code_seed.py).
const CODE_LANGS: &[&str] = &["cpp", "java", "python", "go", "rust"];

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

/// GET /api/passages?tracks=<a,b>&fk_min=&fk_max=&langs=<x,y> — one random
/// passage. Multi-track requests distribute evenly across the selected tracks
/// that have matches (never biased toward the biggest track); the optional
/// Flesch-Kincaid range filters by difficulty (unscored rows never match);
/// `langs` restricts code passages to the given languages (other tracks are
/// unaffected). `track=` (single) is kept for back-compat.
pub async fn passages(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let url = req.url()?;
    let q = |name: &str| {
        url.query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.to_string())
    };
    let tracks_param = q("tracks").or_else(|| q("track")).unwrap_or_else(|| "news".to_string());
    let selected: Vec<String> = tracks_param
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    if selected.is_empty() || selected.iter().any(|t| !TRACKS.contains(&t.as_str())) {
        return Response::error("unknown track", 400);
    }
    let fk_min = q("fk_min").and_then(|v| v.parse::<f64>().ok());
    let fk_max = q("fk_max").and_then(|v| v.parse::<f64>().ok());
    let range = if fk_min.is_some() || fk_max.is_some() {
        Some((fk_min.unwrap_or(0.0), fk_max.unwrap_or(18.0)))
    } else {
        None
    };
    let langs: Option<Vec<String>> = q("langs").map(|v| {
        v.split(',')
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect()
    });
    if let Some(ls) = &langs {
        if ls.is_empty() || ls.iter().any(|l| !CODE_LANGS.contains(&l.as_str())) {
            return Response::error("unknown code language", 400);
        }
    }
    let db = ctx.env.d1("DB")?;

    // filter tail shared by the count and pick queries (appended after each
    // query's own track condition, so placeholders stay positional)
    let mut cond = String::new();
    let mut cond_binds: Vec<wasm_bindgen::JsValue> = Vec::new();
    if let Some((lo, hi)) = range {
        cond.push_str(" AND p.fk_grade >= ? AND p.fk_grade <= ?");
        cond_binds.push(lo.into());
        cond_binds.push(hi.into());
    }
    if let Some(ls) = &langs {
        let ph = vec!["?"; ls.len()].join(",");
        cond.push_str(&format!(" AND (a.track != 'code' OR a.id IN ({ph}))"));
        for l in ls {
            cond_binds.push(format!("code-{l}").into());
        }
    }

    // pick the track first, uniformly among selected tracks with matches —
    // one GROUP BY query covers all selected tracks
    let track_ph = vec!["?"; selected.len()].join(",");
    let mut count_binds: Vec<wasm_bindgen::JsValue> =
        selected.iter().map(|t| t.as_str().into()).collect();
    count_binds.extend(cond_binds.iter().cloned());
    #[derive(serde::Deserialize)]
    struct TrackCount {
        track: String,
        n: i64,
    }
    let candidates: Vec<String> = db
        .prepare(&format!(
            "SELECT a.track AS track, COUNT(*) AS n FROM passages p \
             JOIN articles a ON a.id = p.article_id WHERE a.track IN ({track_ph}){cond} \
             GROUP BY a.track"
        ))
        .bind(&count_binds)?
        .all()
        .await?
        .results::<TrackCount>()?
        .into_iter()
        .filter(|r| r.n > 0)
        .map(|r| r.track)
        .collect();
    let Some(track) = pick_random(&candidates) else {
        return no_store(Response::from_json(&serde_json::json!({
            "passage": null,
            "hint": "no passages match the selected tracks/difficulty/languages — widen the filters or wait for the daily cron"
        }))?);
    };

    // two-step pick: shuffle over narrow ids only, then fetch one row
    // by PK — ORDER BY RANDOM() over full rows drags every passage's
    // text through the sorter and grows linearly with the feed.
    let mut pick_binds: Vec<wasm_bindgen::JsValue> = vec![track.as_str().into()];
    pick_binds.extend(cond_binds.iter().cloned());
    let picked = db
        .prepare(&format!(
            "SELECT p.id AS id FROM passages p JOIN articles a ON a.id = p.article_id \
             WHERE a.track = ?{cond} ORDER BY RANDOM() LIMIT 1"
        ))
        .bind(&pick_binds)?
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
        let len = db
            .prepare("SELECT length(text) AS len FROM passages WHERE id = ?1")
            .bind(&[(pid as f64).into()])?
            .first::<serde_json::Value>(None)
            .await?
            .and_then(|v| v.get("len").and_then(|n| n.as_i64()));
        let Some(len) = len else {
            return Response::error("unknown passage", 400);
        };
        // perfect pace = every char correct: chars/5 per minute, same unit as
        // net wpm — net can never beat it (word-based bounds under-estimate
        // for long-token passages like vocab/code and false-reject fast runs)
        let perfect_wpm = (len as f64 / 5.0) / (r.duration_ms as f64 / 60_000.0);
        if perfect_wpm > 400.0 || r.wpm > perfect_wpm * 1.1 + 5.0 {
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

/// Uniform random element (entropy from getrandom, same as session tokens).
fn pick_random(items: &[String]) -> Option<&String> {
    if items.is_empty() {
        return None;
    }
    let mut b = [0u8; 4];
    getrandom::getrandom(&mut b).ok()?;
    let n = u32::from_le_bytes(b) as usize;
    items.get(n % items.len())
}

/// GET /api/rankings?days=1|7|30 — top net WPM among signed-in users.
pub async fn rankings(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let url = req.url()?;
    let days = url
        .query_pairs()
        .find(|(k, _)| k == "days")
        .map(|(_, v)| v.to_string())
        .unwrap_or_else(|| "7".to_string());
    let modifier = match days.as_str() {
        "1" => "-1 days",
        "7" => "-7 days",
        "30" => "-30 days",
        _ => return Response::error("days must be 1, 7 or 30", 400),
    };
    let db = ctx.env.d1("DB")?;
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Row {
        nickname: String,
        avatar: String,
        wpm: f64,
    }
    let rows = db
        .prepare(
            "SELECT u.nickname AS nickname, u.avatar AS avatar, MAX(r.wpm) AS wpm \
             FROM results r JOIN users u ON u.id = r.user_id \
             WHERE r.created_at >= datetime('now', ?1) \
             GROUP BY r.user_id ORDER BY wpm DESC LIMIT 10",
        )
        .bind(&[modifier.into()])?
        .all()
        .await?
        .results::<Row>()?;
    no_store(Response::from_json(&serde_json::json!({ "days": days, "top": rows }))?)
}

/// GET /api/history — the signed-in user's synced history blob (or []).
pub async fn get_history(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let db = ctx.env.d1("DB")?;
    let Some(user_id) = crate::auth::session_user_id(&db, &req).await? else {
        return Response::error("unauthorized", 401);
    };
    let data = db
        .prepare("SELECT data FROM user_history WHERE user_id = ?1")
        .bind(&[(user_id as f64).into()])?
        .first::<serde_json::Value>(None)
        .await?
        .and_then(|v| v.get("data").and_then(|d| d.as_str().map(str::to_string)))
        .unwrap_or_else(|| "[]".to_string());
    let mut resp = Response::ok(data)?;
    resp.headers_mut().set("content-type", "application/json")?;
    no_store(resp)
}

/// PUT /api/history — replace the blob (client sends the merged result).
pub async fn put_history(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    if !crate::auth::same_origin(&req) {
        return Response::error("forbidden", 403);
    }
    let db = ctx.env.d1("DB")?;
    let Some(user_id) = crate::auth::session_user_id(&db, &req).await? else {
        return Response::error("unauthorized", 401);
    };
    let body = req.text().await?;
    if body.len() > 512 * 1024 {
        return Response::error("history too large", 413);
    }
    // must be a JSON array — reject anything else outright
    match serde_json::from_str::<serde_json::Value>(&body) {
        Ok(v) if v.is_array() => {}
        _ => return Response::error("bad json", 400),
    }
    db.prepare(
        "INSERT INTO user_history (user_id, data, updated_at) VALUES (?1, ?2, datetime('now')) \
         ON CONFLICT(user_id) DO UPDATE SET data = ?2, updated_at = datetime('now')",
    )
    .bind(&[(user_id as f64).into(), body.as_str().into()])?
    .run()
    .await?;
    Response::from_json(&serde_json::json!({ "ok": true }))
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
