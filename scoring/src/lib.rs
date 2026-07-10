//! Canonical scoring formulas for slowdoctor-type.
//!
//! PARITY RULE (AGENTS.md): `web/src/scoring.ts` mirrors these formulas exactly.
//! Change both together or not at all. P2 plan: compile this crate to a
//! wasm-bindgen module and delete the TS mirror.
//!
//! Definitions:
//! - a "word" is the conventional 5 characters (spaces included)
//! - `correct_chars`: characters that are correct in the final state of the test
//! - keystrokes: character-producing presses only (backspace is not a keystroke);
//!   a keystroke counts as correct if it matched its target when pressed,
//!   even if later deleted by a subsequent mistake's correction

/// Net words per minute over the final correct characters.
pub fn wpm(correct_chars: u32, duration_ms: u32) -> f64 {
    if duration_ms == 0 {
        return 0.0;
    }
    (correct_chars as f64 / 5.0) / (duration_ms as f64 / 60_000.0)
}

/// Gross words per minute over everything typed, right or wrong.
pub fn raw_wpm(typed_chars: u32, duration_ms: u32) -> f64 {
    if duration_ms == 0 {
        return 0.0;
    }
    (typed_chars as f64 / 5.0) / (duration_ms as f64 / 60_000.0)
}

/// Percentage of keystrokes that were correct when pressed. 100 when idle.
pub fn accuracy(correct_keystrokes: u32, total_keystrokes: u32) -> f64 {
    if total_keystrokes == 0 {
        return 100.0;
    }
    100.0 * correct_keystrokes as f64 / total_keystrokes as f64
}

/// Evenness of pace: 100 * (1 - coefficient of variation) over per-second
/// raw-WPM samples, clamped to [0, 100]. Fewer than 2 samples => 100.
pub fn consistency(per_second_raw_wpm: &[f64]) -> f64 {
    if per_second_raw_wpm.len() < 2 {
        return 100.0;
    }
    let n = per_second_raw_wpm.len() as f64;
    let mean = per_second_raw_wpm.iter().sum::<f64>() / n;
    if mean <= 0.0 {
        return 0.0;
    }
    let variance = per_second_raw_wpm
        .iter()
        .map(|v| (v - mean) * (v - mean))
        .sum::<f64>()
        / n;
    let cv = variance.sqrt() / mean;
    (100.0 * (1.0 - cv)).clamp(0.0, 100.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wpm_basics() {
        assert_eq!(wpm(250, 60_000), 50.0);
        assert_eq!(wpm(0, 60_000), 0.0);
        assert_eq!(wpm(250, 0), 0.0);
        assert_eq!(wpm(125, 30_000), 50.0);
    }

    #[test]
    fn raw_wpm_basics() {
        assert_eq!(raw_wpm(300, 30_000), 120.0);
        assert_eq!(raw_wpm(300, 0), 0.0);
    }

    #[test]
    fn accuracy_basics() {
        assert_eq!(accuracy(95, 100), 95.0);
        assert_eq!(accuracy(0, 0), 100.0);
        assert_eq!(accuracy(0, 10), 0.0);
    }

    #[test]
    fn consistency_constant_pace_is_100() {
        assert_eq!(consistency(&[60.0, 60.0, 60.0]), 100.0);
    }

    #[test]
    fn consistency_extreme_swing_is_0() {
        // mean 60, population stddev 60 => cv 1 => 0
        assert_eq!(consistency(&[0.0, 120.0]), 0.0);
    }

    #[test]
    fn consistency_edge_cases() {
        assert_eq!(consistency(&[]), 100.0);
        assert_eq!(consistency(&[42.0]), 100.0);
        assert_eq!(consistency(&[0.0, 0.0]), 0.0);
    }

    #[test]
    fn consistency_moderate() {
        let c = consistency(&[50.0, 60.0, 70.0]);
        assert!(c > 80.0 && c < 90.0, "got {c}");
    }
}
