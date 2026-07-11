// localStorage schema versioning: every sdtype.* migration lives here so
// key evolution has one home instead of ad-hoc mappings around the app.
//
// Keys: sdtype.version, sdtype.track, sdtype.recent, sdtype.history,
// sdtype.words, sdtype.goals (the session cookie is server-side).

const VERSION_KEY = "sdtype.version";
const CURRENT = 2;

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

  try {
    localStorage.setItem(VERSION_KEY, String(CURRENT));
  } catch {
    /* non-fatal */
  }
}
