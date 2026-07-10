// TS mirror of the canonical formulas in scoring/src/lib.rs.
// PARITY RULE (AGENTS.md): change both together or not at all.

export function wpm(correctChars: number, durationMs: number): number {
  if (durationMs === 0) return 0;
  return correctChars / 5 / (durationMs / 60_000);
}

export function rawWpm(typedChars: number, durationMs: number): number {
  if (durationMs === 0) return 0;
  return typedChars / 5 / (durationMs / 60_000);
}

export function accuracy(correctKeystrokes: number, totalKeystrokes: number): number {
  if (totalKeystrokes === 0) return 100;
  return (100 * correctKeystrokes) / totalKeystrokes;
}

export function consistency(perSecondRawWpm: number[]): number {
  if (perSecondRawWpm.length < 2) return 100;
  const n = perSecondRawWpm.length;
  const mean = perSecondRawWpm.reduce((a, b) => a + b, 0) / n;
  if (mean <= 0) return 0;
  const variance = perSecondRawWpm.reduce((a, v) => a + (v - mean) * (v - mean), 0) / n;
  const cv = Math.sqrt(variance) / mean;
  return Math.min(100, Math.max(0, 100 * (1 - cv)));
}
