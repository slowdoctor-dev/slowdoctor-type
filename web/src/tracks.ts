// Single source of truth for the track lineup on the web side.
// The worker (worker/src/api.rs) must mirror both lists — TRACKS and
// CODE_LANGS — so adding a track or language touches exactly two places
// (buttons and settings toggles render from here).

export const TRACKS = ["news", "daily", "pmc", "federal", "vocab", "code"] as const;

export type Track = (typeof TRACKS)[number];

export function isTrack(value: string): value is Track {
  return (TRACKS as readonly string[]).includes(value);
}

// code-track languages; each is one seeded article `code-<lang>`
export const CODE_LANGS = ["cpp", "java", "python", "go", "rust"] as const;

export type CodeLang = (typeof CODE_LANGS)[number];

export const CODE_LANG_LABELS: Record<CodeLang, string> = {
  cpp: "C++",
  java: "Java",
  python: "Python",
  go: "Go",
  rust: "Rust",
};

export function isCodeLang(value: string): value is CodeLang {
  return (CODE_LANGS as readonly string[]).includes(value);
}

/** Toggle `item` in a selection that must never become empty. */
export function toggleKeepOne(list: readonly string[], item: string): string[] {
  if (list.includes(item)) {
    return list.length > 1 ? list.filter((x) => x !== item) : [...list];
  }
  return [...list, item];
}
