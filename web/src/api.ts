export interface Passage {
  id: number | null;
  text: string;
  word_count: number;
  title: string;
  url: string;
  attribution: string;
  track: string;
}

export interface PassageResponse {
  passage: Passage | null;
  hint?: string;
}

export interface ResultOut {
  passage_id: number | null;
  wpm: number;
  raw_wpm: number;
  accuracy: number;
  consistency: number;
  duration_ms: number;
}

export async function getPassage(track: string): Promise<PassageResponse> {
  const res = await fetch(`/api/passages?track=${encodeURIComponent(track)}`);
  if (!res.ok) throw new Error(`passages: HTTP ${res.status}`);
  return (await res.json()) as PassageResponse;
}

/** Fire-and-forget anonymous aggregate stats; personal history is localStorage. */
export function postResult(result: ResultOut): void {
  fetch("/api/results", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
  }).catch(() => {
    /* offline / dev without worker — personal history still saved locally */
  });
}
