//! PMC (PubMed Central) JATS XML parsing for the `pmc` track.
//!
//! Same dependency-free philosophy as the VOA parser. Contract verified live
//! 2026-07-10 against efetch db=pmc retmode=xml:
//! - id: `<article-id pub-id-type="pmcid">PMC13348900</article-id>`
//! - license: `<license>` block with a creativecommons.org href; ONLY plain
//!   `/licenses/by/` qualifies (by-nc / by-nc-nd / by-nd are excluded — the
//!   `by` must be followed by `/` or `"` to avoid prefix false-positives)
//! - abstract: first `<abstract>` that is not abstract-type="graphical";
//!   `<p>` blocks inside (section titles live in `<title>`, dropped by design)

use crate::{chunk_passages, normalize, word_count};

pub struct PmcArticle {
    pub pmcid: String, // digits only, no "PMC" prefix
    pub title: String,
    pub journal: String,
    pub year: Option<String>,
    pub first_author: Option<String>,
    pub cc_by: bool,
    pub passages: Vec<String>,
}

/// Parse an efetch `pmc-articleset` response into per-article records.
pub fn parse_articleset(xml: &str) -> Vec<PmcArticle> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<article ") {
        let end = rest[start..]
            .find("</article>")
            .map(|e| start + e)
            .unwrap_or(rest.len());
        let block = &rest[start..end];
        if let Some(a) = parse_article(block) {
            out.push(a);
        }
        rest = &rest[end..];
        match rest.find('>') {
            Some(gt) => rest = &rest[gt + 1..],
            None => break,
        }
    }
    out
}

fn parse_article(block: &str) -> Option<PmcArticle> {
    let pmcid = pmcid_of(block)?;
    let title = clean(crate::tag_inner(block, "article-title")?);
    let journal = clean(crate::tag_inner(block, "journal-title")?);
    let year = crate::tag_inner(block, "year").map(|y| y.trim().to_string());
    let first_author = crate::tag_inner(block, "surname").map(clean);
    let cc_by = is_cc_by(block);
    let paragraphs = abstract_paragraphs(block);
    let passages = chunk_passages(&paragraphs);
    Some(PmcArticle {
        pmcid,
        title,
        journal,
        year,
        first_author,
        cc_by,
        passages,
    })
}

fn pmcid_of(block: &str) -> Option<String> {
    let marker = r#"pub-id-type="pmcid">"#;
    let at = block.find(marker)? + marker.len();
    let raw: String = block[at..]
        .chars()
        .take_while(|c| *c != '<')
        .collect::<String>()
        .trim()
        .to_string();
    let digits = raw.strip_prefix("PMC").unwrap_or(&raw);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(digits.to_string())
}

/// Only links inside `<license>` blocks count — a CC BY URL cited in the
/// body or references of a non-CC-BY article must not qualify it.
fn is_cc_by(block: &str) -> bool {
    let mut rest = block;
    while let Some(at) = crate::find_tag_open(rest, "license") {
        let after = &rest[at..];
        let end = after.find("</license>").unwrap_or(after.len());
        if cc_link_grants_reuse(&after[..end]) {
            return true;
        }
        rest = &after[end..];
        match rest.find('>') {
            Some(gt) => rest = &rest[gt + 1..],
            None => break,
        }
    }
    false
}

fn cc_link_grants_reuse(license_block: &str) -> bool {
    let mut rest = license_block;
    while let Some(at) = rest.find("creativecommons.org/licenses/") {
        let tail = &rest[at + "creativecommons.org/licenses/".len()..];
        let code: String = tail
            .chars()
            .take_while(|c| c.is_ascii_lowercase() || *c == '-')
            .collect();
        if code == "by" {
            return true;
        }
        rest = tail;
    }
    // CC0 dedications are also fine for a public typing feed
    license_block.contains("creativecommons.org/publicdomain/")
}

fn abstract_paragraphs(block: &str) -> Vec<String> {
    let mut rest = block;
    while let Some(at) = rest.find("<abstract") {
        let tag_end = match rest[at..].find('>') {
            Some(gt) => at + gt + 1,
            None => return Vec::new(),
        };
        let open_tag = &rest[at..tag_end];
        let body_end = rest[tag_end..]
            .find("</abstract>")
            .map(|e| tag_end + e)
            .unwrap_or(rest.len());
        if !open_tag.contains(r#"abstract-type="graphical""#) {
            return crate::p_blocks(&rest[tag_end..body_end])
                .into_iter()
                .filter(|p| word_count(p) >= 4)
                .collect();
        }
        rest = &rest[body_end..];
    }
    Vec::new()
}

fn clean(s: String) -> String {
    normalize(&crate::decode_entities(&crate::strip_tags(&s)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"<pmc-articleset><article article-type="research-article">
      <journal-title>Skin Research</journal-title>
      <article-id pub-id-type="pmcid">PMC1234567</article-id>
      <article-id pub-id-type="pmid">99887766</article-id>
      <article-title>Laser <italic>resurfacing</italic> outcomes&#8212;a study</article-title>
      <contrib contrib-type="author"><name><surname>Kim</surname><given-names>J</given-names></name></contrib>
      <pub-date pub-type="epub"><year>2026</year></pub-date>
      <license><license-p>This is an open access article under the <ext-link xlink:href="http://creativecommons.org/licenses/by/4.0/">CC BY</ext-link> license.</license-p></license>
      <abstract abstract-type="graphical"><p>graphic only</p></abstract>
      <abstract><sec><title>Background</title><p>Fractional lasers are widely used for scar revision and the evidence base has grown quickly over the last decade across many indications and skin types worldwide today.</p></sec>
      <sec><title>Results</title><p>Outcomes improved in most groups studied here with careful energy settings and repeated sessions over months of structured follow up in the clinic setting overall.</p></sec></abstract>
    </article>
    <article article-type="case-report">
      <journal-title>Derm Cases</journal-title>
      <article-id pub-id-type="pmcid">PMC7654321</article-id>
      <article-title>A by-nc-nd case</article-title>
      <license><license-p><ext-link xlink:href="http://creativecommons.org/licenses/by-nc-nd/4.0/">CC BY-NC-ND</ext-link></license-p></license>
      <abstract><p>Not usable because the license does not permit unrestricted reuse in public settings anywhere at all.</p></abstract>
    </article></pmc-articleset>"#;

    #[test]
    fn parses_cc_by_article_with_structured_abstract() {
        let arts = parse_articleset(FIXTURE);
        assert_eq!(arts.len(), 2);
        let a = &arts[0];
        assert_eq!(a.pmcid, "1234567");
        assert_eq!(a.title, "Laser resurfacing outcomes-a study");
        assert_eq!(a.journal, "Skin Research");
        assert_eq!(a.year.as_deref(), Some("2026"));
        assert_eq!(a.first_author.as_deref(), Some("Kim"));
        assert!(a.cc_by);
        // graphical abstract skipped; two ~27-word paragraphs merge then flush at >=40
        assert!(!a.passages.is_empty());
        assert!(a.passages[0].starts_with("Fractional lasers"));
    }

    #[test]
    fn by_nc_nd_is_not_cc_by() {
        let arts = parse_articleset(FIXTURE);
        assert!(!arts[1].cc_by);
    }

    #[test]
    fn prefix_by_variants_rejected() {
        let lic = |href: &str| format!(r#"<license><p href="{href}">x</p></license>"#);
        assert!(!is_cc_by(&lic("http://creativecommons.org/licenses/by-nc/4.0/")));
        assert!(!is_cc_by(&lic("http://creativecommons.org/licenses/by-nd/4.0/")));
        assert!(is_cc_by(&lic("https://creativecommons.org/licenses/by/3.0/")));
        assert!(is_cc_by(&lic("https://creativecommons.org/publicdomain/zero/1.0/")));
    }

    #[test]
    fn cc_link_outside_license_block_does_not_qualify() {
        // a CC BY URL cited in the article body must not grant reuse
        assert!(!is_cc_by(
            r#"<body><p>see http://creativecommons.org/licenses/by/4.0/ for details</p></body>"#
        ));
        // and <license-p> alone (no <license> wrapper) is not a license block
        assert!(!is_cc_by(
            r#"<license-p href="http://creativecommons.org/licenses/by/4.0/">x</license-p>"#
        ));
    }
}
