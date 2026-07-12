//! VOA Learning English article contract (verified live 2026-07-10 — see
//! AGENTS.md): slug URLs are text articles, body lives in `div.wsw`, cut at
//! the "Words in This Story" glossary, drop player/separator boilerplate.

use crate::{p_blocks, word_count};

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

fn is_body_paragraph(text: &str) -> bool {
    if text.contains("No media source currently available") {
        return false;
    }
    if text.starts_with("___") {
        return false;
    }
    word_count(text) >= 4
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
