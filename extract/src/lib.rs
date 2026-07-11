//! VOA Learning English parsing: RSS items, article body extraction,
//! normalization, and passage chunking.
//!
//! Dependency-free by design — keeps the wasm bundle small and compile times
//! short. The trade-off is VOA-specific brittleness; the extraction contract
//! (AGENTS.md) documents the live-verified DOM assumptions. If
//! `extract_paragraphs` starts returning nothing, re-derive the container
//! from a live article before touching this code.

pub mod federal;
pub mod pmc;

pub struct RssItem {
    pub title: String,
    pub link: String,
    pub pub_date: Option<String>,
}

/// Words per passage: flush once a chunk reaches MIN, never merge past MAX,
/// drop leftovers under FLOOR.
const MIN_WORDS: usize = 40;
const MAX_WORDS: usize = 85;
const FLOOR_WORDS: usize = 25;

pub fn parse_rss_items(xml: &str) -> Vec<RssItem> {
    let mut items = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<item>") {
        let Some(end) = rest[start..].find("</item>") else {
            break;
        };
        let block = &rest[start..start + end];
        if let (Some(title), Some(link)) = (tag_inner(block, "title"), tag_inner(block, "link")) {
            items.push(RssItem {
                title: normalize(&decode_entities(&title)),
                link: link.trim().to_string(),
                pub_date: tag_inner(block, "pubDate").map(|d| d.trim().to_string()),
            });
        }
        rest = &rest[start + end + "</item>".len()..];
    }
    items
}

/// Slug-URL filter: `/a/<slug>/<id>.html` is a text article (returns the id);
/// bare-numeric `/a/<id>.html` is an audio-only item (returns None).
pub fn text_article_id(link: &str) -> Option<String> {
    let path = link.strip_prefix("https://learningenglish.voanews.com/a/")?;
    let (slug, file) = path.rsplit_once('/')?;
    if slug.is_empty() {
        return None;
    }
    let id = file.strip_suffix(".html")?;
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(id.to_string())
}

/// Pull cleaned body paragraphs out of a VOA article page.
pub fn extract_paragraphs(html: &str) -> Vec<String> {
    let Some(start) = html.find("class=\"wsw\"") else {
        return Vec::new();
    };
    let after = &html[start..];
    let end = after
        .find("Words in This Story")
        .or_else(|| after.find("id=\"comments\""))
        .unwrap_or(after.len());
    let body = &after[..end];
    p_blocks(body)
        .into_iter()
        .filter(|t| is_body_paragraph(t))
        .collect()
}

/// All `<p>…</p>` blocks in `html`, tag-stripped, entity-decoded, normalized.
pub(crate) fn p_blocks(html: &str) -> Vec<String> {
    let mut paragraphs = Vec::new();
    let mut rest = html;
    while let Some(p_start) = find_tag_open(rest, "p") {
        let Some(gt) = rest[p_start..].find('>') else {
            break;
        };
        let content_start = p_start + gt + 1;
        let Some(p_end) = rest[content_start..].find("</p>") else {
            break;
        };
        let inner = &rest[content_start..content_start + p_end];
        paragraphs.push(normalize(&decode_entities(&strip_tags(inner))));
        rest = &rest[content_start + p_end + "</p>".len()..];
    }
    paragraphs
}

fn is_body_paragraph(text: &str) -> bool {
    if text.contains("No media source currently available") {
        return false;
    }
    if text.starts_with("___") {
        return false;
    }
    word_count(text) >= 4
}

/// Merge paragraphs into typeable passages of roughly MIN..=MAX words,
/// splitting oversized paragraphs at sentence boundaries.
pub fn chunk_passages(paragraphs: &[String]) -> Vec<String> {
    let mut chunks: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut cur_words = 0usize;

    let flush = |cur: &mut String, cur_words: &mut usize, chunks: &mut Vec<String>| {
        if *cur_words >= FLOOR_WORDS {
            chunks.push(cur.trim().to_string());
        }
        cur.clear();
        *cur_words = 0;
    };

    for para in paragraphs {
        let w = word_count(para);
        if w > MAX_WORDS {
            flush(&mut cur, &mut cur_words, &mut chunks);
            chunks.extend(split_long_paragraph(para));
            continue;
        }
        if cur_words > 0 && cur_words + w > MAX_WORDS {
            flush(&mut cur, &mut cur_words, &mut chunks);
        }
        if !cur.is_empty() {
            cur.push(' ');
        }
        cur.push_str(para);
        cur_words += w;
        if cur_words >= MIN_WORDS {
            flush(&mut cur, &mut cur_words, &mut chunks);
        }
    }
    flush(&mut cur, &mut cur_words, &mut chunks);
    chunks
}

fn split_long_paragraph(para: &str) -> Vec<String> {
    let mut pieces: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut cur_words = 0usize;
    for sentence in split_sentences(para) {
        let w = word_count(&sentence);
        if cur_words > 0 && cur_words + w > MAX_WORDS {
            pieces.push(cur.trim().to_string());
            cur.clear();
            cur_words = 0;
        }
        if !cur.is_empty() {
            cur.push(' ');
        }
        cur.push_str(&sentence);
        cur_words += w;
    }
    let tail = cur.trim().to_string();
    if !tail.is_empty() {
        if word_count(&tail) >= FLOOR_WORDS || pieces.is_empty() {
            pieces.push(tail);
        } else if let Some(last) = pieces.last_mut() {
            // small tail: allow the previous piece to run slightly over MAX
            last.push(' ');
            last.push_str(&tail);
        }
    }
    pieces.retain(|p| word_count(p) >= FLOOR_WORDS);
    pieces
}

fn split_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut cur = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        cur.push(c);
        if matches!(c, '.' | '?' | '!') && chars.peek().is_none_or(|n| n.is_whitespace()) {
            sentences.push(cur.trim().to_string());
            cur.clear();
        }
    }
    if !cur.trim().is_empty() {
        sentences.push(cur.trim().to_string());
    }
    sentences
}

pub fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

/// Make text typeable: straighten quotes/dashes, expand ellipsis,
/// convert exotic spaces, collapse whitespace runs.
pub fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last_space = true; // leading whitespace gets trimmed
    for c in text.chars() {
        let mapped: Option<char> = match c {
            '\u{2018}' | '\u{2019}' | '\u{02BC}' | '`' | '\u{00B4}' => Some('\''),
            '\u{201C}' | '\u{201D}' | '\u{201E}' => Some('"'),
            '\u{2010}' | '\u{2011}' | '\u{2013}' | '\u{2014}' | '\u{2212}' => Some('-'),
            '\u{00A0}' | '\u{2009}' | '\u{200A}' | '\u{202F}' => Some(' '),
            '\u{2026}' => {
                out.push_str("...");
                last_space = false;
                continue;
            }
            _ => None,
        };
        let c = mapped.unwrap_or(c);
        if c.is_whitespace() {
            if !last_space {
                out.push(' ');
                last_space = true;
            }
        } else {
            out.push(c);
            last_space = false;
        }
    }
    out.trim_end().to_string()
}

fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => {
                in_tag = true;
                // tags never glue words together
                out.push(' ');
            }
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

pub(crate) fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let tail = &rest[amp..];
        match tail[1..].find(';') {
            // entities are short; anything longer is a stray ampersand
            Some(semi) if semi <= 8 => {
                let name = &tail[1..1 + semi];
                match decode_entity(name) {
                    Some(s) => out.push_str(&s),
                    None => out.push('&'),
                }
                if decode_entity(name).is_some() {
                    rest = &tail[semi + 2..];
                } else {
                    rest = &tail[1..];
                }
            }
            _ => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn decode_entity(name: &str) -> Option<String> {
    let named = match name {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        "nbsp" => Some(' '),
        "rsquo" | "lsquo" => Some('\''),
        "rdquo" | "ldquo" => Some('"'),
        "mdash" | "ndash" => Some('-'),
        "hellip" => return Some("...".to_string()),
        _ => None,
    };
    if let Some(c) = named {
        return Some(c.to_string());
    }
    let code = if let Some(hex) = name.strip_prefix("#x").or_else(|| name.strip_prefix("#X")) {
        u32::from_str_radix(hex, 16).ok()?
    } else if let Some(dec) = name.strip_prefix('#') {
        dec.parse::<u32>().ok()?
    } else {
        return None;
    };
    Some(char::from_u32(code)?.to_string())
}

/// Inner text of the first `<tag>…</tag>` in `block`, unwrapping CDATA.
pub(crate) fn tag_inner(block: &str, tag: &str) -> Option<String> {
    let open = find_tag_open(block, tag)?;
    let gt = block[open..].find('>')? + open;
    let close = block[gt + 1..].find(&format!("</{tag}>"))? + gt + 1;
    let inner = block[gt + 1..close].trim();
    let inner = inner
        .strip_prefix("<![CDATA[")
        .and_then(|s| s.strip_suffix("]]>"))
        .unwrap_or(inner);
    Some(inner.to_string())
}

pub(crate) fn find_tag_open(html: &str, tag: &str) -> Option<usize> {
    let mut from = 0;
    let needle = format!("<{tag}");
    while let Some(pos) = html[from..].find(&needle) {
        let abs = from + pos;
        let after = html.as_bytes().get(abs + needle.len());
        if matches!(after, Some(b'>') | Some(b' ') | Some(b'\t') | Some(b'\n')) {
            return Some(abs);
        }
        from = abs + needle.len();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rss_items_plain_and_cdata() {
        let xml = r#"<rss><channel>
          <item><title>Plain &amp; Simple</title><link> https://x/a/b/1.html </link><pubDate>Fri, 10 Jul 2026</pubDate></item>
          <item><title><![CDATA[Wrapped Title]]></title><link>https://x/a/2.html</link></item>
        </channel></rss>"#;
        let items = parse_rss_items(xml);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Plain & Simple");
        assert_eq!(items[0].link, "https://x/a/b/1.html");
        assert_eq!(items[0].pub_date.as_deref(), Some("Fri, 10 Jul 2026"));
        assert_eq!(items[1].title, "Wrapped Title");
        assert_eq!(items[1].pub_date, None);
    }

    #[test]
    fn slug_urls_are_text_articles() {
        assert_eq!(
            text_article_id("https://learningenglish.voanews.com/a/some-slug-here/7997203.html"),
            Some("7997203".to_string())
        );
        // bare numeric = audio-only
        assert_eq!(
            text_article_id("https://learningenglish.voanews.com/a/8010609.html"),
            None
        );
        assert_eq!(text_article_id("https://voanews.com/a/x/1.html"), None);
    }

    #[test]
    fn extracts_wsw_paragraphs_and_cuts_glossary() {
        let html = r#"<html><div class="content"><p>navigation junk before body</p></div>
          <div class="wsw"><p>No media source currently available</p>
          <p>In 2024, the number of babies born in South Korea <a href="/x">increased</a> for the first time in nine years.</p>
          <p>_____________________________________</p>
          <p>The agency said the country&#8217;s fertility rate was 0.75 in 2024.</p>
          <h2>Words in This Story</h2>
          <p>fertility &mdash; n. the state of being able to have babies</p></div></html>"#;
        let paras = extract_paragraphs(html);
        assert_eq!(paras.len(), 2);
        assert!(paras[0].starts_with("In 2024, the number of babies"));
        assert_eq!(
            paras[1],
            "The agency said the country's fertility rate was 0.75 in 2024."
        );
    }

    #[test]
    fn extract_returns_empty_without_wsw() {
        assert!(extract_paragraphs("<html><p>hello world one two</p></html>").is_empty());
    }

    #[test]
    fn normalize_makes_text_typeable() {
        assert_eq!(
            normalize("It\u{2019}s \u{201C}fine\u{201D}\u{00A0}\u{2014} really\u{2026}  ok"),
            r#"It's "fine" - really... ok"#
        );
    }

    #[test]
    fn entities_decode() {
        assert_eq!(
            decode_entities("a &amp; b &#8217;s &#x27;x&#x27; &unknown; &"),
            "a & b \u{2019}s 'x' &unknown; &"
        );
    }

    #[test]
    fn chunking_merges_small_and_flushes_at_min() {
        let p20 = (0..20).map(|i| format!("w{i}")).collect::<Vec<_>>().join(" ");
        let paras = vec![p20.clone(), p20.clone(), p20.clone()];
        let chunks = chunk_passages(&paras);
        // 20+20 => 40 >= MIN flushes; trailing 20 < FLOOR dropped
        assert_eq!(chunks.len(), 1);
        assert_eq!(word_count(&chunks[0]), 40);
    }

    #[test]
    fn chunking_splits_long_paragraph_at_sentences() {
        let sentence = "This sentence has exactly seven words in it.";
        let long = std::iter::repeat_n(sentence, 20).collect::<Vec<_>>().join(" ");
        let chunks = chunk_passages(&[long]);
        assert!(chunks.len() > 1);
        for c in &chunks {
            assert!(word_count(c) <= MAX_WORDS + 10, "chunk too long: {}", word_count(c));
            assert!(c.ends_with('.'), "chunk must end at a sentence: {c}");
        }
    }
}
