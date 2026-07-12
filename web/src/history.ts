export interface HistoryEntry {
  at: string; // ISO datetime
  wpm: number;
  rawWpm: number;
  accuracy: number;
  consistency: number;
  durationMs: number;
  track: string;
  passageId: number | null;
}

const KEY = "sdtype.history";
const MAX_ENTRIES = 1000;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Overwrite the stored history (sync merge result). */
export function replaceHistory(entries: HistoryEntry[]): void {
  const trimmed = entries.slice(-MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* storage full or blocked — non-fatal */
  }
}

/** Union of two histories by timestamp key, oldest→newest, capped. Pure. */
export function mergeHistories(a: HistoryEntry[], b: HistoryEntry[]): HistoryEntry[] {
  const byAt = new Map<string, HistoryEntry>();
  for (const e of [...a, ...b]) byAt.set(e.at, e);
  return [...byAt.values()]
    .sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0))
    .slice(-MAX_ENTRIES);
}

export function saveResult(entry: HistoryEntry): void {
  const all = loadHistory();
  all.push(entry);
  if (all.length > MAX_ENTRIES) all.splice(0, all.length - MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage full or blocked — non-fatal */
  }
}

export function summary(): string {
  const all = loadHistory();
  if (all.length === 0) return "";
  const best = Math.max(...all.map((e) => e.wpm));
  const recent = all.slice(-10);
  const avg = recent.reduce((a, e) => a + e.wpm, 0) / recent.length;
  const avgAcc = recent.reduce((a, e) => a + e.accuracy, 0) / recent.length;
  return `${all.length} tests · best ${Math.round(best)} wpm · last ${recent.length}: ${Math.round(avg)} wpm / ${avgAcc.toFixed(1)}%`;
}
