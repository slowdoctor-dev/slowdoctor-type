//! `federal` track: U.S. federal government works (public domain).
//!
//! v1 sources are WordPress sites (NASA, ShareAmerica) whose RSS feeds carry
//! the full article body in `<content:encoded>` — so ingest needs no second
//! page fetch and no per-site DOM contract, only feed parsing plus paragraph
//! cleanup. Sources without full-content feeds (e.g. NOAA on Drupal) need
//! their own extraction contract and are deliberately not in v1.
//!
//! CONTRACT STATUS: written against the standard WordPress feed format;
//! live-verify on the first cron run (per-track counts in /api/health).
//! If a source yields 0 items, fetch its feed by hand and re-derive the
//! structure before touching this code.

// Feed parsing is the shared `crate::parse_rss_items` — WordPress feeds are
// plain RSS whose items carry the body in `content_html`.
use crate::{p_blocks, word_count};

/// Stable article id from a post URL: the last path segment (WP post slug).
/// `https://www.nasa.gov/news-release/some-slug/` → `some-slug`.
pub fn slug_from_link(link: &str) -> Option<String> {
    let no_scheme = link.split("://").nth(1)?;
    let path = no_scheme.split_once('/')?.1;
    let path = path.split(['?', '#']).next().unwrap_or(path);
    let slug = path.rsplit('/').find(|s| !s.is_empty())?;
    let slug: String = slug
        .chars()
        .map(|c| c.to_ascii_lowercase())
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(80)
        .collect();
    if slug.len() < 3 {
        return None;
    }
    Some(slug)
}

/// Body paragraphs from a `<content:encoded>` HTML fragment, with government
/// press boilerplate (credits, contacts, link farms) filtered out.
pub fn extract_content_paragraphs(html: &str) -> Vec<String> {
    p_blocks(html)
        .into_iter()
        .filter(|t| is_body_paragraph(t))
        .collect()
}

fn is_body_paragraph(text: &str) -> bool {
    if word_count(text) < 4 {
        return false;
    }
    let lower = text.to_ascii_lowercase();
    const BOILERPLATE_PREFIXES: &[&str] = &[
        "credit:",
        "credits:",
        "image credit",
        "photo credit",
        "banner image",
        "editor's note",
        "editors' note",
        "media contact",
        "news media contact",
        "for more information",
        "to learn more",
        "learn more about",
        "read more",
        "read the full",
        "follow ",
        "download ",
        "keep exploring",
        "related:",
        "share this",
        "this article was written",
        "a version of this",
        "sign up",
        "subscribe",
    ];
    if BOILERPLATE_PREFIXES.iter().any(|p| lower.starts_with(p)) {
        return false;
    }
    // contact blocks and visible links are not worth typing
    if lower.contains('@') || lower.contains("http") || lower.contains("www.") {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"<?xml version="1.0"?>
      <rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
      <item>
        <title>NASA&#8217;s New Telescope Opens Its Eyes</title>
        <link>https://www.nasa.gov/news-release/new-telescope-opens-eyes/</link>
        <pubDate>Fri, 10 Jul 2026 14:00:00 +0000</pubDate>
        <content:encoded><![CDATA[
          <figure><img src="x.jpg"/><figcaption>The telescope. Credit: NASA</figcaption></figure>
          <p>Credit: NASA/JPL-Caltech</p>
          <p>NASA&#8217;s newest space telescope returned its first images this week, giving scientists an early look at distant galaxies formed billions of years ago.</p>
          <p>The team spent nearly a decade building the instrument. &#8220;We are thrilled,&#8221; said the project scientist, adding that early data already exceeded expectations for clarity and depth.</p>
          <p>Media contact: Jane Doe, 202-555-0100, jane.doe@nasa.gov</p>
          <p>Learn more about the mission at https://nasa.gov/mission</p>
        ]]></content:encoded>
      </item>
      <item>
        <title>Photo of the Week</title>
        <link>https://www.nasa.gov/image-article/photo-week-12/</link>
      </item>
      </channel></rss>"#;

    #[test]
    fn wp_items_carry_full_content() {
        let items = crate::parse_rss_items(FIXTURE);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "NASA's New Telescope Opens Its Eyes");
        assert_eq!(
            items[0].link,
            "https://www.nasa.gov/news-release/new-telescope-opens-eyes/"
        );
        assert!(items[0].content_html.is_some());
        assert!(items[1].content_html.is_none());
    }

    #[test]
    fn content_paragraphs_drop_boilerplate() {
        let items = crate::parse_rss_items(FIXTURE);
        let paras = extract_content_paragraphs(items[0].content_html.as_deref().unwrap());
        assert_eq!(paras.len(), 2, "got: {paras:?}");
        assert!(paras[0].starts_with("NASA's newest space telescope"));
        assert!(paras[1].contains("\"We are thrilled,\""));
    }

    #[test]
    fn slug_ids_are_stable_and_sane() {
        assert_eq!(
            slug_from_link("https://www.nasa.gov/news-release/new-telescope-opens-eyes/"),
            Some("new-telescope-opens-eyes".to_string())
        );
        assert_eq!(
            slug_from_link("https://share.america.gov/how-americans-celebrate/?utm=x"),
            Some("how-americans-celebrate".to_string())
        );
        assert_eq!(slug_from_link("https://example.gov/"), None);
        assert_eq!(slug_from_link("not a url"), None);
    }

    #[test]
    fn boilerplate_filters() {
        assert!(!is_body_paragraph("Credit: NASA/JPL"));
        assert!(!is_body_paragraph("Media contact: Jane Doe at HQ"));
        assert!(!is_body_paragraph("Write to jane.doe@nasa.gov for details today"));
        assert!(!is_body_paragraph("See the gallery at www.nasa.gov right now"));
        assert!(!is_body_paragraph("too short here"));
        assert!(is_body_paragraph(
            "The mission launched from Florida early on Tuesday morning."
        ));
    }
}
