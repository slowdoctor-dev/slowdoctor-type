// Zero-dependency self-test, run with:
//   node --experimental-strip-types scripts/selftest.ts
// Covers the scoring TS mirror (parity vectors match scoring/src/lib.rs tests)
// and the pure word-tracking logic. DOM/localStorage code is not exercised.

import { wpm, rawWpm, accuracy, consistency } from "../src/scoring.ts";
import { keyOf, passageWords, computeMissedWords, buildPracticeText } from "../src/words.ts";

let failures = 0;

function eq(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

function approx(name: string, got: number, want: number, tol = 1e-9): void {
  if (Math.abs(got - want) > tol) {
    failures++;
    console.error(`FAIL ${name}: got ${got}, want ${want}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// --- scoring parity vectors (must match scoring/src/lib.rs tests) ---
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
if (c > 80 && c < 90) console.log("ok   consistency moderate in (80,90)");
else {
  failures++;
  console.error(`FAIL consistency moderate: got ${c}`);
}

// --- word tracking ---
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

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall selftests passed");
