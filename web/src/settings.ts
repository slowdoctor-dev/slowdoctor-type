// Custom-practice panel: everything beyond "one track, full pool" lives here —
// multi-track mixes, the Flesch-Kincaid difficulty range, and code language
// selection. The main nav pills stay single-select; this panel is the only
// place that produces a combined/filtered pool. Changes apply to state
// immediately; the passage reloads once, when the panel closes.

import { $ } from "./dom";
import type { FkRange } from "./api";
import { TRACKS, CODE_LANGS, CODE_LANG_LABELS, toggleKeepOne } from "./tracks";

export interface Prefs {
  tracks: string[];
  fk: FkRange;
  langs: string[];
}

export interface SettingsHost {
  get(): Prefs;
  /** Persist + repaint the nav; must NOT reload the passage (close does). */
  set(prefs: Prefs): void;
  /** Called on close when anything changed — reload the passage. */
  onClose(): void;
}

let host: SettingsHost;
let changed = false;

function el(tag: string, className: string, text = ""): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  return e;
}

function optButton(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = active ? "opt active" : "opt";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function fkInput(value: number | null, onChange: (n: number | null) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.max = "18";
  input.step = "0.5";
  input.placeholder = "–";
  input.value = value === null ? "" : String(value);
  input.addEventListener("change", () => {
    const n = input.value.trim() === "" ? null : Number(input.value);
    onChange(n !== null && Number.isFinite(n) ? n : null);
  });
  return input;
}

function render(): void {
  const card = $("#settings-card");
  card.textContent = "";
  const p = host.get();

  const head = el("div", "dash-head");
  head.append(el("span", "dash-title", "custom practice"));
  const close = document.createElement("button");
  close.id = "s-close";
  close.type = "button";
  close.innerHTML = "close <kbd>esc</kbd>";
  close.addEventListener("click", closeSettings);
  head.append(close);
  card.append(head);

  card.append(
    el("div", "dash-sub", "sources — pick one or more; passages rotate evenly across them"),
  );
  const trackRow = el("div", "opt-row");
  for (const t of TRACKS) {
    trackRow.append(
      optButton(t, p.tracks.includes(t), () => {
        const cur = host.get();
        host.set({ ...cur, tracks: toggleKeepOne(cur.tracks, t) });
        changed = true;
        render();
      }),
    );
  }
  card.append(trackRow);

  card.append(
    el(
      "div",
      "dash-sub",
      "difficulty — Flesch-Kincaid grade 0–18, blank = any (code is unscored: a set range hides it)",
    ),
  );
  const fkRow = el("div", "opt-row fk-row");
  const setFk = (key: "min" | "max") => (n: number | null) => {
    const cur = host.get();
    host.set({ ...cur, fk: { ...cur.fk, [key]: n } });
    changed = true;
  };
  fkRow.append(fkInput(p.fk.min, setFk("min")), el("span", "dash-sub", "to"), fkInput(p.fk.max, setFk("max")));
  card.append(fkRow);

  card.append(el("div", "dash-sub", "code languages"));
  const langRow = el("div", "opt-row");
  for (const l of CODE_LANGS) {
    langRow.append(
      optButton(CODE_LANG_LABELS[l], p.langs.includes(l), () => {
        const cur = host.get();
        host.set({ ...cur, langs: toggleKeepOne(cur.langs, l) });
        changed = true;
        render();
      }),
    );
  }
  card.append(langRow);
}

export function settingsOpen(): boolean {
  return !$("#settings").hidden;
}

export function closeSettings(): void {
  $("#settings").hidden = true;
  if (changed) {
    changed = false;
    host.onClose();
  }
}

export function initSettings(h: SettingsHost): void {
  host = h;
  $("#custom-btn").addEventListener("click", (e) => {
    changed = false;
    render();
    $("#settings").hidden = false;
    (e.currentTarget as HTMLButtonElement).blur();
  });
  const overlay = $("#settings");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeSettings();
  });
  document.addEventListener("keydown", (e) => {
    if (!overlay.hidden && e.key === "Escape") {
      e.preventDefault();
      closeSettings();
    }
  });
}
