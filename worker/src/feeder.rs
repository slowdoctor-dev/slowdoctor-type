//! Daily feeder: VOA Learning English RSS → text articles → passages in D1.
//! Runs from the cron trigger and from POST /api/feed (token-guarded).

use worker::*;

/// (zone id, program name) — see AGENTS.md "VOA extraction contract".
/// All are the `news` track; `medical` (PMC) and `classic` (Gutenberg)
/// get their own feeders in P1/P2.
pub const VOA_FEEDS: &[(&str, &str)] = &[
    ("zkm-ql-vomx-tpej-rqi", "As It Is"),
    ("zmg_pl-vomx-tpeymtm", "Science & Technology"),
    ("zmmpql-vomx-tpey-_q", "Health & Lifestyle"),
    ("zpyp_l-vomx-tpe_rym", "Arts & Culture"),
];

/// Politeness/cost cap: at most this many article fetches per feed per run.
const MAX_NEW_ARTICLES_PER_FEED: usize = 5;

#[derive(serde::Serialize, Default)]
pub struct FeedReport {
    pub feeds_ok: u32,
    pub items_seen: u32,
    pub articles_new: u32,
    pub passages_new: u32,
    pub errors: Vec<String>,
}

pub async fn run(env: &Env) -> Result<FeedReport> {
    let db = env.d1("DB")?;
    let mut report = FeedReport::default();
    for (zone, program) in VOA_FEEDS {
        match feed_one(&db, zone, program, &mut report).await {
            Ok(()) => report.feeds_ok += 1,
            Err(e) => report.errors.push(format!("{program}: {e}")),
        }
    }
    Ok(report)
}

async fn feed_one(
    db: &D1Database,
    zone: &str,
    program: &str,
    report: &mut FeedReport,
) -> Result<()> {
    let xml = http_get(&format!("https://learningenglish.voanews.com/api/{zone}")).await?;
    let mut new_here = 0usize;
    for item in extract::parse_rss_items(&xml) {
        report.items_seen += 1;
        if new_here >= MAX_NEW_ARTICLES_PER_FEED {
            break;
        }
        let Some(article_id) = extract::text_article_id(&item.link) else {
            continue; // audio-only or foreign link
        };
        let known = db
            .prepare("SELECT 1 AS x FROM articles WHERE id = ?1")
            .bind(&[article_id.as_str().into()])?
            .first::<serde_json::Value>(None)
            .await?;
        if known.is_some() {
            continue;
        }
        let html = match http_get(&item.link).await {
            Ok(h) => h,
            Err(e) => {
                report.errors.push(format!("{article_id}: {e}"));
                continue;
            }
        };
        let passages = extract::chunk_passages(&extract::extract_paragraphs(&html));
        if passages.is_empty() {
            continue; // slideshow/video page or DOM drift — skip, don't record
        }
        store_article(db, &article_id, &item, program, &passages).await?;
        report.articles_new += 1;
        report.passages_new += passages.len() as u32;
        new_here += 1;
    }
    Ok(())
}

async fn store_article(
    db: &D1Database,
    article_id: &str,
    item: &extract::RssItem,
    program: &str,
    passages: &[String],
) -> Result<()> {
    let attribution = format!("{program} — VOA Learning English (public domain)");
    db.prepare(
        "INSERT INTO articles (id, url, title, source, track, license, attribution, published_at, fetched_at) \
         VALUES (?1, ?2, ?3, 'voa', 'news', 'public-domain', ?4, ?5, datetime('now'))",
    )
    .bind(&[
        article_id.into(),
        item.link.as_str().into(),
        item.title.as_str().into(),
        attribution.as_str().into(),
        match &item.pub_date {
            Some(d) => d.as_str().into(),
            None => wasm_bindgen::JsValue::NULL,
        },
    ])?
    .run()
    .await?;

    for (seq, text) in passages.iter().enumerate() {
        db.prepare(
            "INSERT OR IGNORE INTO passages (article_id, seq, text, word_count) \
             VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(&[
            article_id.into(),
            (seq as f64).into(),
            text.as_str().into(),
            (extract::word_count(text) as f64).into(),
        ])?
        .run()
        .await?;
    }
    Ok(())
}

async fn http_get(url: &str) -> Result<String> {
    let headers = Headers::new();
    headers.set(
        "user-agent",
        "slowdoctor-type/0.1 (personal typing trainer; https://type.slowdoctor.dev)",
    )?;
    let req = Request::new_with_init(
        url,
        RequestInit::new()
            .with_method(Method::Get)
            .with_headers(headers),
    )?;
    let mut resp = Fetch::Request(req).send().await?;
    if resp.status_code() != 200 {
        return Err(Error::RustError(format!(
            "GET {url} -> {}",
            resp.status_code()
        )));
    }
    resp.text().await
}
