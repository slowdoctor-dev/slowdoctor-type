// Cross-device history sync (signed-in users): GET the server blob, merge
// with local by timestamp, store both ways; new results push back debounced.
// Signed-out users never hit the network beyond the initial 401.

import { loadHistory, replaceHistory, mergeHistories, type HistoryEntry } from "./history";

let signedIn = false;
let pushTimer: number | undefined;

export async function initSync(): Promise<boolean> {
  try {
    const res = await fetch("/api/history");
    if (!res.ok) return false; // 401 = signed out; anything else: stay local
    signedIn = true;
    const remote = (await res.json()) as HistoryEntry[];
    const merged = mergeHistories(loadHistory(), remote);
    replaceHistory(merged);
    void push(merged);
    return true;
  } catch {
    return false; // offline / dev without worker
  }
}

/** Debounced push after each finished test. */
export function schedulePush(): void {
  if (!signedIn) return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void push(loadHistory()), 2500);
}

async function push(entries: HistoryEntry[]): Promise<void> {
  try {
    await fetch("/api/history", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entries),
    });
  } catch {
    /* transient — next result retries */
  }
}
