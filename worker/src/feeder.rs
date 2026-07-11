//! Daily feeder: openly licensed sources → passages in D1.
//! Runs from the cron trigger and from POST /api/feed (token-guarded).
//!
//! Sources: VOA Learning English RSS (`news`, public domain) and PMC
//! open-access CC BY abstracts (`medical`). `classic` is a static Gutenberg
//! seed shipped as a D1 migration, not fed here.

use worker::*;

/// (zone id, program name) — see AGENTS.md "VOA extraction contract".
pub const VOA_FEEDS: &[(&str, &str)] = &[
    ("zkm-ql-vomx-tpej-rqi", "As It Is"),
    ("zmg_pl-vomx-tpeymtm", "Science & Technology"),
    ("zmmpql-vomx-tpey-_q", "Health & Lifestyle"),
    ("zpyp_l-vomx-tpe_rym", "Arts & Culture"),
];

/// PMC E-utilities contract verified live 2026-07-10 (see extract::pmc docs).
const PMC_QUERY: &str = r#"(dermatology OR "plastic surgery" OR "skin rejuvenation" OR "laser therapy" OR "aesthetic medicine" OR "wound healing" OR "scar treatment") AND "open access"[filter]"#;
const PMC_SEARCH_RETMAX: usize = 40;

/// Politeness/cost caps per run.
const MAX_NEW_ARTICLES_PER_FEED: usize = 5;
const MAX_NEW_PMC: usize = 8;
const MAX_EFETCH_IDS: usize = 8;

#[derive(serde::Serialize, Default)]
pub struct FeedReport {
    pub feeds_ok: u32,
    pub items_seen: u32,
    pub articles_new: u32,
    pub passages_new: u32,
    pub errors: Vec<String>,
}

struct ArticleMeta {
    id: String,
    url: String,
    title: String,
    source: &'static str,
    track: &'static str,
    license: &'static str,
    attribution: String,
    published_at: Option<String>,
}

pub async fn run(env: &Env) -> Result<FeedReport> {
    let db = env.d1("DB")?;
    let mut report = FeedReport::default();
    for (zone, program) in VOA_FEEDS {
        match feed_voa(&db, zone, program, &mut report).await {
            Ok(()) => report.feeds_ok += 1,
            Err(e) => report.errors.push(format!("voa/{program}: {e}")),
        }
    }
    match feed_pmc(&db, &mut report).await {
        Ok(()) => report.feeds_ok += 1,
        Err(e) => report.errors.push(format!("pmc: {e}")),
    }
    Ok(report)
}

async fn feed_voa(
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
        if article_exists(db, &article_id).await? {
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
        let meta = ArticleMeta {
            id: article_id,
            url: item.link.clone(),
            title: item.title.clone(),
            source: "voa",
            track: "news",
            license: "public-domain",
            attribution: format!("{program} — VOA Learning English (public domain)"),
            published_at: item.pub_date.clone(),
        };
        store_article(db, &meta, &passages).await?;
        report.articles_new += 1;
        report.passages_new += passages.len() as u32;
        new_here += 1;
    }
    Ok(())
}

async fn feed_pmc(db: &D1Database, report: &mut FeedReport) -> Result<()> {
    let search_url = format!(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&retmode=json&retmax={PMC_SEARCH_RETMAX}&sort=pub+date&term={}",
        urlencode(PMC_QUERY)
    );
    let body = http_get(&search_url).await?;
    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| Error::RustError(format!("esearch json: {e}")))?;
    let ids: Vec<String> = v["esearchresult"]["idlist"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    report.items_seen += ids.len() as u32;

    let mut unknown = Vec::new();
    for pmcid in &ids {
        if unknown.len() >= MAX_EFETCH_IDS {
            break;
        }
        if !article_exists(db, &format!("pmc-{pmcid}")).await? {
            unknown.push(pmcid.clone());
        }
    }
    if unknown.is_empty() {
        return Ok(());
    }

    let fetch_url = format!(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&retmode=xml&id={}",
        unknown.join(",")
    );
    let xml = http_get(&fetch_url).await?;
    let mut new_here = 0usize;
    for art in extract::pmc::parse_articleset(&xml) {
        if new_here >= MAX_NEW_PMC {
            break;
        }
        if !art.cc_by || art.passages.is_empty() {
            continue; // non-CC-BY licenses never enter the public feed
        }
        let author = art.first_author.clone().unwrap_or_else(|| "Authors".to_string());
        let year = art.year.clone().unwrap_or_default();
        let meta = ArticleMeta {
            id: format!("pmc-{}", art.pmcid),
            url: format!("https://pmc.ncbi.nlm.nih.gov/articles/PMC{}/", art.pmcid),
            title: art.title.clone(),
            source: "pmc",
            track: "medical",
            license: "cc-by",
            attribution: format!("{author} et al., {} ({year}) — CC BY", art.journal),
            published_at: art.year.clone(),
        };
        store_article(db, &meta, &art.passages).await?;
        report.articles_new += 1;
        report.passages_new += art.passages.len() as u32;
        new_here += 1;
    }
    Ok(())
}

async fn article_exists(db: &D1Database, id: &str) -> Result<bool> {
    let row = db
        .prepare("SELECT 1 AS x FROM articles WHERE id = ?1")
        .bind(&[id.into()])?
        .first::<serde_json::Value>(None)
        .await?;
    Ok(row.is_some())
}

async fn store_article(db: &D1Database, meta: &ArticleMeta, passages: &[String]) -> Result<()> {
    db.prepare(
        "INSERT INTO articles (id, url, title, source, track, license, attribution, published_at, fetched_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))",
    )
    .bind(&[
        meta.id.as_str().into(),
        meta.url.as_str().into(),
        meta.title.as_str().into(),
        meta.source.into(),
        meta.track.into(),
        meta.license.into(),
        meta.attribution.as_str().into(),
        match &meta.published_at {
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
            meta.id.as_str().into(),
            (seq as f64).into(),
            text.as_str().into(),
            (extract::word_count(text) as f64).into(),
        ])?
        .run()
        .await?;
    }
    Ok(())
}

/// Minimal RFC 3986 percent-encoding (unreserved chars kept).
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
