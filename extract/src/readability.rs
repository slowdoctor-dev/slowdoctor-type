//! Flesch-Kincaid grade level, computed at ingest so passages can be
//! filtered by difficulty (Roadmap: "Passage difficulty"). The syllable
//! counter is the usual vowel-group heuristic (~90% accurate) — fine for
//! banding passages, not for linguistics.

use crate::word_count;

/// FK grade = 0.39*(words/sentences) + 11.8*(syllables/words) - 15.59,
/// clamped to 0..=18 and rounded to one decimal. Returns None for texts too
/// short to score meaningfully.
pub fn fk_grade(text: &str) -> Option<f64> {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() < 10 {
        return None;
    }
    let sentences = sentence_count(text).max(1) as f64;
    let syllables: usize = words.iter().map(|w| syllables(w)).sum();
    let w = words.len() as f64;
    let grade = 0.39 * (w / sentences) + 11.8 * (syllables as f64 / w) - 15.59;
    Some((grade.clamp(0.0, 18.0) * 10.0).round() / 10.0)
}

fn sentence_count(text: &str) -> usize {
    let mut n = 0;
    let mut prev_end = false;
    for c in text.chars() {
        let end = matches!(c, '.' | '!' | '?');
        if end && !prev_end {
            n += 1;
        }
        prev_end = end;
    }
    n.max(1)
}

/// Vowel-group heuristic: each run of vowels is a syllable; a trailing
/// silent 'e' is dropped (but "-le" after a consonant keeps it); minimum 1.
fn syllables(word: &str) -> usize {
    let w: Vec<char> = word
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if w.is_empty() {
        return 1;
    }
    let is_vowel = |c: char| matches!(c, 'a' | 'e' | 'i' | 'o' | 'u' | 'y');
    let mut count = 0;
    let mut in_group = false;
    for &c in &w {
        if is_vowel(c) {
            if !in_group {
                count += 1;
            }
            in_group = true;
        } else {
            in_group = false;
        }
    }
    let n = w.len();
    if n >= 2 && w[n - 1] == 'e' && !is_vowel(w[n - 2]) && count > 1 {
        // silent final e ("make"), except consonant+"le" ("table")
        if !(w[n - 2] == 'l' && n >= 3 && !is_vowel(w[n - 3])) {
            count -= 1;
        }
    }
    count.max(1)
}

/// Convenience used by the feeder: passage word count + grade together.
pub fn passage_stats(text: &str) -> (usize, Option<f64>) {
    (word_count(text), fk_grade(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn syllable_heuristic() {
        assert_eq!(syllables("the"), 1);
        assert_eq!(syllables("make"), 1); // silent e
        assert_eq!(syllables("table"), 2); // consonant + le keeps it
        assert_eq!(syllables("banana"), 3);
        assert_eq!(syllables("readily"), 3);
        assert_eq!(syllables("strength"), 1);
    }

    #[test]
    fn simple_text_scores_low_complex_scores_high() {
        let simple = "The cat sat on the mat. The dog ran to the park. We like to play games.";
        let complex = "Notwithstanding considerable methodological heterogeneity, contemporary \
            investigations demonstrate statistically significant improvements following \
            standardized rehabilitation protocols administered longitudinally.";
        let s = fk_grade(simple).unwrap();
        let c = fk_grade(complex).unwrap();
        assert!(s < 5.0, "simple got {s}");
        assert!(c > 14.0, "complex got {c}");
        assert!(s < c);
    }

    #[test]
    fn too_short_is_unscored_and_range_clamped() {
        assert_eq!(fk_grade("Just five words right here."), None);
        let long_easy = "Go now. ".repeat(20);
        let g = fk_grade(&long_easy).unwrap();
        assert!((0.0..=18.0).contains(&g));
    }
}
