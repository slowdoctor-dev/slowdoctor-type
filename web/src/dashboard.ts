// History dashboard: summary, daily goals, problem-word chips, weak-word
// practice launcher, daily WPM/accuracy chart, recent-tests table.

import { $ } from "./dom";
import type { Passage } from "./api";
import { loadHistory, summary, type HistoryEntry } from "./history";
import { buildPracticeText, problemWords, reviewQueue } from "./words";
import { GOAL_TRACKS, countsForDay, clampGoal, goalProgress, loadGoals, saveGoal } from "./goals";

export function dashboardOpen(): boolean {
  return !$("#dashboard").hidden;
}

export function closeDashboard(): void {
  $("#dashboard").hidden = true;
}

export function initDashboard(startPractice: (passage: Passage) => void): void {
  $("#stats-btn").addEventListener("click", (e) => {
    renderDashboard();
    $("#dashboard").hidden = false;
    (e.currentTarget as HTMLButtonElement).blur();
  });
  $("#d-close").addEventListener("click", closeDashboard);
  $("#d-practice").addEventListener("click", () => practiceWeakWords(startPractice));
  const overlay = $("#dashboard");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeDashboard();
  });
}

/** Practice pool: words due for review first, topped up with the worst misses. */
function practicePool(limit = 12): string[] {
  const words = reviewQueue(limit).map((w) => w.word);
  for (const w of problemWords(limit)) {
    if (words.length >= limit) break;
    if (!words.includes(w.word)) words.push(w.word);
  }
  return words;
}

function practiceWeakWords(startPractice: (passage: Passage) => void): void {
  const words = practicePool();
  if (words.length < 3) return;
  closeDashboard();
  startPractice({
    id: null,
    text: buildPracticeText(words),
    word_count: 42,
    title: "weak words",
    url: "",
    attribution: "weak-word practice — built from your recent misses",
    track: "practice",
  });
}

function renderGoals(entries: HistoryEntry[] = loadHistory()): void {
  const box = $("#d-goals");
  box.textContent = "";
  const goals = loadGoals();
  const counts = countsForDay(entries, new Date().toISOString().slice(0, 10));
  for (const t of GOAL_TRACKS) {
    const row = document.createElement("div");
    row.className = "goal-row";
    const name = document.createElement("span");
    name.className = "goal-track";
    name.textContent = t;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "99";
    input.value = String(goals[t] ?? 0);
    input.setAttribute("aria-label", `daily goal for ${t}`);
    input.addEventListener("change", () => {
      saveGoal(t, clampGoal(Number(input.value)));
      renderGoals();
    });
    const progress = document.createElement("span");
    const p = goalProgress(counts[t] ?? 0, goals[t] ?? 0);
    progress.className = p?.met ? "goal-progress met" : "goal-progress";
    progress.textContent = p ? p.text : "—";
    row.append(name, input, progress);
    box.append(row);
  }
}

function renderDashboard(): void {
  const all = loadHistory();
  $("#d-summary").textContent = all.length ? summary() : "no tests yet — type something first";
  renderGoals(all);

  const now = new Date().toISOString();
  const words = problemWords(12);
  const due = new Set(reviewQueue(12, now).map((w) => w.word));
  const chipBox = $("#d-words");
  chipBox.textContent = "";
  const practiceBtn = $<HTMLButtonElement>("#d-practice");
  if (words.length === 0 && due.size === 0) {
    chipBox.textContent = "no problem words yet — misses show up here after a few tests";
    practiceBtn.disabled = true;
  } else {
    for (const w of words) {
      const chip = document.createElement("span");
      chip.className = due.has(w.word) ? "chip due" : "chip";
      chip.textContent = w.word;
      const next =
        w.due && w.due > now ? ` · next review ${w.due.slice(0, 10)}` : " · due for review";
      chip.title = `missed ${w.miss}× of ${w.seen}${next}`;
      chipBox.append(chip);
    }
    practiceBtn.disabled = practicePool().length < 3;
  }

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

  const drawLine = (
    get: (p: { wpm: number; acc: number }) => number,
    yf: (v: number) => number,
    style: string,
    dash: number[],
  ) => {
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
