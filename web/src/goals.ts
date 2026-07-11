// Per-track daily goals: pure logic + localStorage persistence.
// Pure functions are node-testable (scripts/selftest.ts); storage helpers
// are browser-only and must only be called from the app.

export type Goals = Record<string, number>; // track -> tests per day (0/absent = no goal)

const KEY = "sdtype.goals";

export const GOAL_TRACKS = ["news", "daily", "medical", "classic"] as const;

/** Tests per track completed on `day` (YYYY-MM-DD, UTC slice of the ISO stamp). */
export function countsForDay(
  entries: { at: string; track: string }[],
  day: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of entries) {
    if (e.at.slice(0, 10) === day) counts[e.track] = (counts[e.track] ?? 0) + 1;
  }
  return counts;
}

/** Normalize raw input into a goal value: integer 0–99, 0 = no goal. */
export function clampGoal(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(99, Math.floor(n)));
}

/** Progress label for one track, e.g. "2/3" or "3/3 ✓"; null when no goal is set. */
export function goalProgress(done: number, goal: number): { text: string; met: boolean } | null {
  if (goal <= 0) return null;
  const met = done >= goal;
  return { text: `${done}/${goal}${met ? " ✓" : ""}`, met };
}

// --- browser-only persistence ---

export function loadGoals(): Goals {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Goals) : {};
  } catch {
    return {};
  }
}

export function saveGoal(track: string, goal: number): void {
  const goals = loadGoals();
  if (goal > 0) goals[track] = goal;
  else delete goals[track];
  try {
    localStorage.setItem(KEY, JSON.stringify(goals));
  } catch {
    /* storage full or blocked — non-fatal */
  }
}
