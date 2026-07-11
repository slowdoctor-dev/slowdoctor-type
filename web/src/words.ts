// Mistyped-word tracking: pure logic + localStorage persistence.
// Pure functions are node-testable (scripts/selftest.ts); storage helpers
// are browser-only and must only be called from the app.

export interface WordStat {
  miss: number;
  seen: number;
  last: string; // ISO datetime of last encounter
}

export type WordStats = Record<string, WordStat>;

const KEY = "sdtype.words";
const MAX_TRACKED = 400;

/** Canonical key for a typed word; null when not worth tracking. */
export function keyOf(word: string): string | null {
  const k = word
    .toLowerCase()
    .replace(/^[^a-z']+/, "")
    .replace(/[^a-z']+$/, "");
  if (k.length < 3) return null;
  if (!/^[a-z][a-z']*$/.test(k)) return null;
  return k;
}

/** Unique trackable word keys in a passage, in order of appearance. */
export function passageWords(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(" ")) {
    const k = keyOf(raw);
    if (k) seen.add(k);
  }
  return [...seen];
}

/**
 * Words whose character range contains at least one wrong keystroke.
 * `wrongIndices` are char positions into `text` (spaces count as positions;
 * a wrong space is attributed to the word before it).
 */
export function computeMissedWords(text: string, wrongIndices: Iterable<number>): string[] {
  const wrong = new Set(wrongIndices);
  const missed = new Set<string>();
  let start = 0;
  const flush = (end: number) => {
    // include the boundary space so a fumbled space blames the preceding word
    for (let i = start; i <= Math.min(end, text.length - 1); i++) {
      if (wrong.has(i)) {
        const k = keyOf(text.slice(start, end));
        if (k) missed.add(k);
        break;
      }
    }
  };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " ") {
      flush(i);
      start = i + 1;
    }
  }
  flush(text.length);
  return [...missed];
}

/** Build a practice text from problem words (word-soup, monkeytype style). */
export function buildPracticeText(
  words: string[],
  targetWords = 42,
  rand: () => number = Math.random,
): string {
  if (words.length === 0) return "";
  const out: string[] = [];
  let pool: string[] = [];
  while (out.length < targetWords) {
    if (pool.length === 0) {
      pool = [...words].sort(() => rand() - 0.5);
      // avoid immediate repeats across pool refills
      if (out.length > 0 && pool[0] === out[out.length - 1] && pool.length > 1) {
        pool.push(pool.shift() as string);
      }
    }
    out.push(pool.shift() as string);
  }
  return out.join(" ");
}

// --- browser-only persistence ---

export function loadWordStats(): WordStats {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as WordStats) : {};
  } catch {
    return {};
  }
}

function saveWordStats(stats: WordStats): void {
  const entries = Object.entries(stats);
  if (entries.length > MAX_TRACKED) {
    entries.sort((a, b) => (a[1].last < b[1].last ? 1 : -1));
    stats = Object.fromEntries(entries.slice(0, MAX_TRACKED));
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    /* storage full or blocked — non-fatal */
  }
}

/** Update stats after a completed test. */
export function recordTest(text: string, missedWords: string[], at: string): void {
  const stats = loadWordStats();
  for (const w of passageWords(text)) {
    const s = stats[w] ?? { miss: 0, seen: 0, last: at };
    s.seen++;
    s.last = at;
    stats[w] = s;
  }
  for (const w of missedWords) {
    const s = stats[w] ?? { miss: 0, seen: 1, last: at };
    s.miss++;
    stats[w] = s;
  }
  saveWordStats(stats);
}

/** Worst words: missed at least twice, weighted by miss rate and recency. */
export function problemWords(limit = 12): { word: string; miss: number; seen: number }[] {
  const stats = loadWordStats();
  return Object.entries(stats)
    .filter(([, s]) => s.miss >= 2)
    .sort((a, b) => b[1].miss / Math.max(b[1].seen, 1) - a[1].miss / Math.max(a[1].seen, 1))
    .slice(0, limit)
    .map(([word, s]) => ({ word, miss: s.miss, seen: s.seen }));
}
