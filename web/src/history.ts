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
