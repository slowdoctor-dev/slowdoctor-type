// Single source of truth for the track lineup on the web side.
// The worker's TRACKS constant (worker/src/lib.rs) must list the same keys —
// adding a track touches exactly those two places (buttons render from here).

export const TRACKS = ["news", "daily", "pmc", "federal", "vocab", "code"] as const;

export type Track = (typeof TRACKS)[number];

export function isTrack(value: string): value is Track {
  return (TRACKS as readonly string[]).includes(value);
}
