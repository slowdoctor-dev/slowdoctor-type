import "./style.css";
import { getPassage, postResult, type Passage } from "./api";
import { FALLBACK_PASSAGE } from "./fallback";
import { TypingEngine, type TestResult } from "./engine";
import { loadHistory, saveResult, summary, type HistoryEntry } from "./history";

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
const dashboardEl = $("#dashboard");

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

// --- history dashboard ---

function openDashboard(): void {
  renderDashboard();
  dashboardEl.hidden = false;
}

function renderDashboard(): void {
  const all = loadHistory();
  $("#d-summary").textContent = all.length ? summary() : "no tests yet — type something first";

  const tbody = $("#d-recent tbody");
  tbody.textContent = "";
  for (const e of all.slice(-10).reverse()) {
    const tr = document.createElement("tr");
    const when = document.createElement("td");
    when.className = "dim";
    when.textContent = e.at.slice(5, 16).replace("T", " ");
    const track = document.createElement("td");
    track.className = "dim";
    track.textContent = e.track;
    const wpm = document.createElement("td");
    wpm.textContent = String(Math.round(e.wpm));
    const acc = document.createElement("td");
    acc.textContent = `${e.accuracy.toFixed(1)}%`;
    const con = document.createElement("td");
    con.className = "dim";
    con.textContent = `${e.consistency.toFixed(0)}%`;
    tr.append(when, track, wpm, acc, con);
    tbody.append(tr);
  }
  drawHistoryChart(all);
}

/** Daily average net WPM (accent) and accuracy (dim, 0–100 scale), last 14 days with data. */
function drawHistoryChart(entries: HistoryEntry[]): void {
  const canvas = $<HTMLCanvasElement>("#d-chart");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);

  const byDay = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    const day = e.at.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  const days = [...byDay.keys()].sort().slice(-14);
  if (days.length === 0) return;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const points = days.map((d) => {
    const es = byDay.get(d) ?? [];
    return { wpm: avg(es.map((e) => e.wpm)), acc: avg(es.map((e) => e.accuracy)) };
  });

  const pad = 10;
  const maxWpm = Math.max(...points.map((p) => p.wpm), 60) * 1.15;
  const x = (i: number) => pad + (days.length === 1 ? 0 : (i / (days.length - 1)) * (w - 2 * pad));
  const yWpm = (v: number) => h - pad - (v / maxWpm) * (h - 2 * pad);
  const yAcc = (v: number) => h - pad - (v / 100) * (h - 2 * pad);

  const drawLine = (get: (p: { wpm: number; acc: number }) => number, yf: (v: number) => number, style: string, dash: number[]) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(x(i), yf(get(p)));
      else ctx.lineTo(x(i), yf(get(p)));
    });
    ctx.stroke();
    ctx.setLineDash([]);
    if (points.length === 1) {
      ctx.fillStyle = style;
      ctx.beginPath();
      ctx.arc(x(0), yf(get(points[0])), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  drawLine((p) => p.acc, yAcc, "#5c6370", [4, 4]);
  drawLine((p) => p.wpm, yWpm, "#7fb4a2", []);

  const last = points[points.length - 1];
  ctx.fillStyle = "#7fb4a2";
  ctx.font = "12px ui-monospace, monospace";
  ctx.fillText(`${Math.round(last.wpm)} wpm`, Math.max(pad, w - 70), yWpm(last.wpm) - 6);
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
$("#stats-btn").addEventListener("click", (e) => {
  openDashboard();
  (e.currentTarget as HTMLButtonElement).blur();
});
$("#d-close").addEventListener("click", () => {
  dashboardEl.hidden = true;
});
dashboardEl.addEventListener("click", (e) => {
  if (e.target === dashboardEl) dashboardEl.hidden = true;
});

document.addEventListener("keydown", (e) => {
  if (e.isComposing) return;

  if (!dashboardEl.hidden) {
    if (e.key === "Escape" || e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      dashboardEl.hidden = true;
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

renderTrackButtons();
renderHistStrip();
void loadTrackCounts();
void nextPassage();
