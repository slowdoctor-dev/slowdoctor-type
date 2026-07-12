// localStorage schema versioning: every sdtype.* migration lives here so
// key evolution has one home instead of ad-hoc mappings around the app.
//
// Keys: sdtype.version, sdtype.tracks, sdtype.fkrange, sdtype.recent, sdtype.history,
// sdtype.words, sdtype.goals (the session cookie is server-side).

const VERSION_KEY = "sdtype.version";
const CURRENT = 4;

export function migrateStorage(): void {
  let v = 1;
  try {
    v = Number(localStorage.getItem(VERSION_KEY) ?? "1") || 1;
  } catch {
    return; // storage blocked — nothing to migrate
  }

  if (v < 2) {
    // 2026-07-11 track rework: medical → aesthetic, classic retired
    const track = localStorage.getItem("sdtype.track");
    if (track === "medical") localStorage.setItem("sdtype.track", "aesthetic");
    if (track === "classic") localStorage.setItem("sdtype.track", "news");
  }

  if (v < 3) {
    // 2026-07-12 rename: aesthetic → pmc (source-named, like federal)
    if (localStorage.getItem("sdtype.track") === "aesthetic")
      localStorage.setItem("sdtype.track", "pmc");
    const goals = localStorage.getItem("sdtype.goals");
    if (goals?.includes('"aesthetic"'))
      localStorage.setItem("sdtype.goals", goals.replace('"aesthetic"', '"pmc"'));
  }

  if (v < 4) {
    // 2026-07-12 multi-track selection: sdtype.track (single) → sdtype.tracks
    const single = localStorage.getItem("sdtype.track");
    if (single && !localStorage.getItem("sdtype.tracks")) {
      localStorage.setItem("sdtype.tracks", JSON.stringify([single]));
    }
    localStorage.removeItem("sdtype.track");
  }

  try {
    localStorage.setItem(VERSION_KEY, String(CURRENT));
  } catch {
    /* non-fatal */
  }
}
