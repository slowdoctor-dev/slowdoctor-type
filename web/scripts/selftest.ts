// Zero-dependency self-test, run with:
//   node --experimental-strip-types scripts/selftest.ts
// Covers the scoring TS mirror (parity vectors match scoring/src/lib.rs tests)
// and the pure word-tracking logic. DOM/localStorage code is not exercised.

import { wpm, rawWpm, accuracy, consistency } from "../src/scoring.ts";
import {
  keyOf,
  passageWords,
  computeMissedWords,
  buildPracticeText,
  updateStat,
  isDue,
  dueWords,
  addDays,
  type WordStat,
} from "../src/words.ts";

import { countsForDay, clampGoal, goalProgress } from "../src/goals.ts";
import { parseAvatar, avatarSvg } from "../src/avatar.ts";

let failures = 0;
let passes = 0;
const sections: [string, number][] = [];

/** Group subsequent checks; the summary reports counts per section. */
function section(name: string): void {
  sections.push([name, 0]);
  console.log(`\n-- ${name}`);
}

function record(name: string, ok: boolean, detail: string): void {
  if (sections.length > 0) sections[sections.length - 1][1]++;
  if (!ok) {
    failures++;
    console.error(`FAIL ${name}: ${detail}`);
  } else {
    passes++;
    console.log(`ok   ${name}`);
  }
}

function eq(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  record(name, ok, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

function approx(name: string, got: number, want: number, tol = 1e-9): void {
  record(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);
}

section("scoring parity (mirrors scoring/src/lib.rs)");
approx("wpm(250, 60000) = 50", wpm(250, 60_000), 50);
approx("wpm(125, 30000) = 50", wpm(125, 30_000), 50);
approx("wpm(x, 0) = 0", wpm(250, 0), 0);
approx("rawWpm(300, 30000) = 120", rawWpm(300, 30_000), 120);
approx("accuracy(95, 100) = 95", accuracy(95, 100), 95);
approx("accuracy(0, 0) = 100", accuracy(0, 0), 100);
approx("consistency(constant) = 100", consistency([60, 60, 60]), 100);
approx("consistency([0,120]) = 0", consistency([0, 120]), 0);
approx("consistency(single) = 100", consistency([42]), 100);
const c = consistency([50, 60, 70]);
record("consistency moderate in (80,90)", c > 80 && c < 90, `got ${c}`);

section("word tracking");
eq("keyOf strips punctuation", keyOf("Hello,"), "hello");
eq("keyOf keeps apostrophes", keyOf("doesn't"), "doesn't");
eq("keyOf rejects short", keyOf("an"), null);
eq("keyOf rejects numbers", keyOf("2024"), null);
eq("passageWords unique ordered", passageWords("The cat and the cat sat."), ["the", "cat", "and", "sat"]);

// "abc def ghi" — positions: abc=0..2, space=3, def=4..6, space=7, ghi=8..10
eq("missed: wrong inside word", computeMissedWords("abc def ghi", [5]), ["def"]);
eq("missed: wrong at boundary space blames previous", computeMissedWords("abc def ghi", [3]), ["abc"]);
eq("missed: multiple", computeMissedWords("abc def ghi", [0, 10]), ["abc", "ghi"]);
eq("missed: none", computeMissedWords("abc def ghi", []), []);
eq(
  "missed: punctuation-stripped key",
  computeMissedWords("well, done", [0]),
  ["well"],
);

const rng = (() => {
  let s = 42;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
})();
const practice = buildPracticeText(["alpha", "beta", "gamma"], 12, rng);
eq("practice text word count", practice.split(" ").length, 12);
eq(
  "practice uses only given words",
  [...new Set(practice.split(" "))].sort(),
  ["alpha", "beta", "gamma"],
);
eq("practice empty input", buildPracticeText([], 10), "");

section("spaced repetition");
const t0 = "2026-07-11T00:00:00.000Z";
const missed1 = updateStat(undefined, true, t0);
eq("srs: first miss counts", [missed1.miss, missed1.seen, missed1.streak], [1, 1, 0]);
eq("srs: miss is due immediately", missed1.due, t0);
eq("srs: missed word is due now", isDue(missed1, t0), true);

const hit1 = updateStat(missed1, false, t0);
eq("srs: first correct schedules +1d", hit1.due, addDays(t0, 1));
eq("srs: not due before schedule", isDue(hit1, addDays(t0, 0.5)), false);
eq("srs: due once schedule passes", isDue(hit1, addDays(t0, 1)), true);

const hit2 = updateStat(hit1, false, addDays(t0, 1));
eq("srs: second correct schedules +3d", hit2.due, addDays(addDays(t0, 1), 3));

let capped = missed1;
for (let i = 0; i < 9; i++) capped = updateStat(capped, false, t0);
eq("srs: interval caps at 30d", capped.due, addDays(t0, 30));

const remiss = updateStat(hit2, true, addDays(t0, 2));
eq("srs: a miss resets streak and is due now", [remiss.streak, remiss.due], [0, addDays(t0, 2)]);

const clean = updateStat(undefined, false, t0);
eq("srs: never-missed word has no schedule", clean.due, undefined);
eq("srs: never-missed word never due", isDue(clean, addDays(t0, 99)), false);

const legacy: WordStat = { miss: 2, seen: 3, last: t0 }; // pre-SRS entry without `due`
eq("srs: legacy missed entry counts as due", isDue(legacy, t0), true);

const stats = {
  aaa: { miss: 1, seen: 2, last: t0, streak: 1, due: addDays(t0, 1) },
  bbb: { miss: 3, seen: 3, last: t0, streak: 0, due: t0 },
  ccc: { miss: 1, seen: 1, last: t0, streak: 0, due: addDays(t0, 5) },
};
eq(
  "srs: dueWords filters and orders most-overdue first",
  dueWords(stats, addDays(t0, 2)).map((w) => w.word),
  ["bbb", "aaa"],
);

section("daily goals");
const hist = [
  { at: "2026-07-11T01:00:00.000Z", track: "news" },
  { at: "2026-07-11T02:00:00.000Z", track: "news" },
  { at: "2026-07-11T03:00:00.000Z", track: "daily" },
  { at: "2026-07-10T23:00:00.000Z", track: "news" }, // previous day
];
eq("goals: counts per track for a day", countsForDay(hist, "2026-07-11"), { news: 2, daily: 1 });
eq("goals: empty day", countsForDay(hist, "2026-07-09"), {});
eq("goals: clamp negative", clampGoal(-3), 0);
eq("goals: clamp fraction", clampGoal(2.7), 2);
eq("goals: clamp huge", clampGoal(1000), 99);
eq("goals: clamp NaN", clampGoal(Number.NaN), 0);
eq("goals: progress unmet", goalProgress(1, 3), { text: "1/3", met: false });
eq("goals: progress met", goalProgress(3, 3), { text: "3/3 ✓", met: true });
eq("goals: no goal set", goalProgress(5, 0), null);

section("avatar (8x8 pattern x hue)");
eq("avatar: parse", parseAvatar("a1b2c3d4|210"), { bits: 0xa1b2c3d4, hue: 210 });
eq("avatar: junk falls back to default", parseAvatar("junk"), { bits: 0x3c5a7e42, hue: 160 });
eq("avatar: hue wraps into 0-359", parseAvatar("00ff00ff|540"), { bits: 0x00ff00ff, hue: 180 });
const svg = avatarSvg("80000001|200"); // bit 0 → row 0 col 0 (+mirror), bit 31 → row 7 col 3 (+mirror)
eq("avatar: svg mirrors cells", (svg.match(/<rect x=/g) ?? []).length, 4); // 2 set bits × 2 mirrored cells

console.log("");
for (const [name, n] of sections) console.log(`   ${name}: ${n} checks`);
if (failures > 0) {
  console.error(`\n${failures} failure(s) / ${passes + failures} checks`);
  process.exit(1);
}
console.log(`\nall ${passes} selftests passed`);
