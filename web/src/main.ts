// App junction box: track selection, the typing loop (passage → engine →
// results), and wiring for the dashboard/account panels and input sources.

import "./style.css";
import { $ } from "./dom";
import { getPassage, postResult, type Passage } from "./api";
import { FALLBACK_PASSAGE } from "./fallback";
import { TypingEngine, type TestResult } from "./engine";
import { saveResult, summary } from "./history";
import { computeMissedWords, recordTest } from "./words";
import { initAccount, accountModalOpen } from "./account";
import { initDashboard, dashboardOpen, closeDashboard } from "./dashboard";
import { migrateStorage } from "./storage";

migrateStorage();

const TRACKS = ["news", "daily", "aesthetic", "federal"] as const;
const TRACK_KEY = "sdtype.track";
const RECENT_KEY = "sdtype.recent";
const RECENT_MAX = 15;

const wordsEl = $("#words");
const liveEl = $(".live");
const liveWpmEl = $("#live-wpm");
const liveAccEl = $("#live-acc");
const attributionEl = $("#attribution");
const articleLinkEl = $<HTMLAnchorElement>("#article-link");
const resultsEl = $("#results");
const histstripEl = $("#histstrip");

let engine: TypingEngine | null = null;
let currentPassage: Passage | null = null;
let isPractice = false;
let track: string = localStorage.getItem(TRACK_KEY) ?? "news";
if (!TRACKS.includes(track as (typeof TRACKS)[number])) track = "news";

function recentIds(): number[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as number[];
  } catch {
    return [];
  }
}

function pushRecent(id: number): void {
  const ids = recentIds().filter((x) => x !== id);
  ids.push(id);
  localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(-RECENT_MAX)));
}

function setLive(wpm: number | null, acc: number | null): void {
  liveWpmEl.textContent = wpm === null ? "—" : String(Math.round(wpm));
  liveAccEl.textContent = acc === null ? "—" : acc.toFixed(0);
  liveEl.classList.toggle("on", wpm !== null);
}

function renderHistStrip(): void {
  histstripEl.textContent = summary();
}

function renderTrackButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("#tracks button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.track === track);
  });
}

function startTest(passage: Passage, practice = false): void {
  engine?.destroy();
  currentPassage = passage;
  isPractice = practice;
  resultsEl.hidden = true;
  document.body.classList.remove("typing");
  setLive(null, null);
  attributionEl.textContent = passage.attribution;
  articleLinkEl.href = passage.url;
  articleLinkEl.hidden = !passage.url;
  if (passage.id !== null && !practice) pushRecent(passage.id);

  engine = new TypingEngine(passage.text, wordsEl, {
    onStart: () => document.body.classList.add("typing"),
    onProgress: setLive,
    onFinish: showResults,
  });
}

async function nextPassage(): Promise<void> {
  engine?.destroy();
  engine = null;
  resultsEl.hidden = true;
  document.body.classList.remove("typing");
  setLive(null, null);
  wordsEl.classList.add("loading");
  wordsEl.textContent = "loading…";
  attributionEl.textContent = "";
  articleLinkEl.hidden = true;

  try {
    let res = await getPassage(track);
    // avoid a recently seen passage (one re-roll is enough)
    if (res.passage?.id !== null && res.passage && recentIds().includes(res.passage.id as number)) {
      const retry = await getPassage(track);
      if (retry.passage) res = retry;
    }
    if (res.passage) {
      startTest(res.passage);
    } else {
      wordsEl.textContent = res.hint
        ? `no passages yet: ${res.hint}`
        : "no passages available for this track yet.";
    }
  } catch {
    // API unreachable (dev without worker, offline) — degrade gracefully
    startTest(FALLBACK_PASSAGE);
  }
}

function showResults(result: TestResult): void {
  document.body.classList.remove("typing");
  $("#r-wpm").textContent = String(Math.round(result.wpm));
  $("#r-acc").textContent = `${result.accuracy.toFixed(1)}%`;
  $("#r-raw").textContent = String(Math.round(result.rawWpm));
  $("#r-con").textContent = `${result.consistency.toFixed(0)}%`;
  $("#r-time").textContent = `${(result.durationMs / 1000).toFixed(1)}s`;
  const attr = $("#r-attribution");
  attr.textContent = "";
  if (currentPassage) {
    attr.append(`${currentPassage.attribution} · `);
    const a = document.createElement("a");
    a.href = currentPassage.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "read the full story ↗";
    attr.append(a);
  }
  drawChart(result.perSecondRaw, result.wpm);
  resultsEl.hidden = false;

  const at = new Date().toISOString();
  saveResult({
    at,
    wpm: result.wpm,
    rawWpm: result.rawWpm,
    accuracy: result.accuracy,
    consistency: result.consistency,
    durationMs: result.durationMs,
    track: isPractice ? "practice" : track,
    passageId: currentPassage?.id ?? null,
  });
  renderHistStrip();

  if (currentPassage) {
    recordTest(
      currentPassage.text,
      computeMissedWords(currentPassage.text, result.wrongIndices),
      at,
    );
  }

  // practice runs are word-soup — keep them out of the aggregate stats
  if (!isPractice) {
    postResult({
      passage_id: currentPassage?.id ?? null,
      wpm: result.wpm,
      raw_wpm: result.rawWpm,
      accuracy: result.accuracy,
      consistency: result.consistency,
      duration_ms: result.durationMs,
    });
  }
}

function drawChart(perSecond: number[], netWpm: number): void {
  const canvas = $<HTMLCanvasElement>("#r-chart");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  if (perSecond.length === 0) return;

  const pad = 8;
  const max = Math.max(...perSecond, netWpm, 1) * 1.1;
  const x = (i: number) =>
    pad + (perSecond.length === 1 ? 0 : (i / (perSecond.length - 1)) * (w - 2 * pad));
  const y = (v: number) => h - pad - (v / max) * (h - 2 * pad);

  // net-wpm reference line
  ctx.strokeStyle = "#5c6370";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad, y(netWpm));
  ctx.lineTo(w - pad, y(netWpm));
  ctx.stroke();
  ctx.setLineDash([]);

  // per-second raw pace
  ctx.strokeStyle = "#7fb4a2";
  ctx.lineWidth = 2;
  ctx.beginPath();
  perSecond.forEach((v, i) => {
    if (i === 0) ctx.moveTo(x(i), y(v));
    else ctx.lineTo(x(i), y(v));
  });
  ctx.stroke();
}

function restart(): void {
  if (currentPassage) startTest(currentPassage);
}

/** Dim source pills that have no passages yet (worker health endpoint). */
async function loadTrackCounts(): Promise<void> {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return;
    const j = (await res.json()) as { tracks?: Record<string, number> };
    const tracks = j.tracks ?? {};
    document.querySelectorAll<HTMLButtonElement>("#tracks button").forEach((btn) => {
      const n = tracks[btn.dataset.track ?? ""] ?? 0;
      btn.classList.toggle("empty", n === 0);
      btn.title = n === 0 ? "no passages yet" : `${n} passages`;
    });
  } catch {
    /* dev without worker — leave pills as-is */
  }
}

// --- wiring ---

document.querySelectorAll<HTMLButtonElement>("#tracks button").forEach((btn) => {
  btn.addEventListener("click", () => {
    track = btn.dataset.track ?? "news";
    localStorage.setItem(TRACK_KEY, track);
    renderTrackButtons();
    void nextPassage();
    btn.blur();
  });
});

$("#next-btn").addEventListener("click", (e) => {
  void nextPassage();
  (e.currentTarget as HTMLButtonElement).blur();
});
$("#restart-btn").addEventListener("click", (e) => {
  restart();
  (e.currentTarget as HTMLButtonElement).blur();
});
$("#r-next").addEventListener("click", () => void nextPassage());
$("#r-repeat").addEventListener("click", restart);

// --- virtual keyboard (touch devices) ---
// Tapping the text focuses an invisible input so the OS keyboard appears;
// beforeinput events are translated into engine strokes and swallowed, so
// the input itself never accumulates text. Physical keyboards are unaffected
// (document keydown consumes them first).
const kbdEl = $<HTMLInputElement>("#kbd");
$("#stage").addEventListener("pointerdown", () => {
  kbdEl.focus({ preventScroll: true });
});
kbdEl.addEventListener("beforeinput", (e) => {
  const ev = e as InputEvent;
  ev.preventDefault();
  if (!engine) return;
  if (ev.inputType === "deleteContentBackward") {
    engine.backspace();
  } else if (
    (ev.inputType === "insertText" || ev.inputType === "insertCompositionText") &&
    ev.data
  ) {
    for (const ch of ev.data) engine.inputChar(ch);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.isComposing) return;

  // account panel owns its keys (text inputs + its own esc handler)
  if (accountModalOpen()) return;

  if (dashboardOpen()) {
    if (e.key === "Escape" || e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      closeDashboard();
    }
    return;
  }

  if (!resultsEl.hidden) {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      void nextPassage();
    } else if (e.key === "Escape") {
      e.preventDefault();
      restart();
    }
    return;
  }

  if (e.key === "Tab") {
    e.preventDefault();
    void nextPassage();
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    restart();
    return;
  }
  if (engine?.handleKey(e)) {
    e.preventDefault();
  }
});

if (new URLSearchParams(location.search).has("embed")) {
  document.body.classList.add("embed");
}
renderTrackButtons();
renderHistStrip();
initDashboard((passage) => startTest(passage, true));
void initAccount();
void loadTrackCounts();
void nextPassage();
