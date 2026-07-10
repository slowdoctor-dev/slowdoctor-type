import "./style.css";
import { getPassage, postResult, type Passage } from "./api";
import { FALLBACK_PASSAGE } from "./fallback";
import { TypingEngine, type TestResult } from "./engine";
import { loadHistory, saveResult, summary } from "./history";

const TRACKS = ["news", "medical", "classic"] as const;
const TRACK_KEY = "sdtype.track";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

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
let track: string = localStorage.getItem(TRACK_KEY) ?? "news";
if (!TRACKS.includes(track as (typeof TRACKS)[number])) track = "news";

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

function startTest(passage: Passage): void {
  engine?.destroy();
  currentPassage = passage;
  resultsEl.hidden = true;
  setLive(null, null);
  attributionEl.textContent = passage.attribution;
  articleLinkEl.href = passage.url;
  articleLinkEl.hidden = !passage.url;

  engine = new TypingEngine(passage.text, wordsEl, {
    onProgress: setLive,
    onFinish: showResults,
  });
}

async function nextPassage(): Promise<void> {
  engine?.destroy();
  engine = null;
  resultsEl.hidden = true;
  setLive(null, null);
  wordsEl.classList.add("loading");
  wordsEl.textContent = "loading…";
  attributionEl.textContent = "";
  articleLinkEl.hidden = true;

  try {
    const res = await getPassage(track);
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

  saveResult({
    at: new Date().toISOString(),
    wpm: result.wpm,
    rawWpm: result.rawWpm,
    accuracy: result.accuracy,
    consistency: result.consistency,
    durationMs: result.durationMs,
    track,
    passageId: currentPassage?.id ?? null,
  });
  renderHistStrip();

  postResult({
    passage_id: currentPassage?.id ?? null,
    wpm: result.wpm,
    raw_wpm: result.rawWpm,
    accuracy: result.accuracy,
    consistency: result.consistency,
    duration_ms: result.durationMs,
  });
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

document.addEventListener("keydown", (e) => {
  if (e.isComposing) return;

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

renderTrackButtons();
renderHistStrip();
loadHistory(); // warm parse; ignore result
void nextPassage();
