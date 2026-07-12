// Browser smoke test: full typing run (physical + virtual keyboard paths),
// results card, dashboard + weak-word practice, account modal.
//
// Needs Playwright + a Chromium binary — NOT part of scripts/check.sh.
// Run via scripts/e2e.sh, or directly against a running server:
//   BASE_URL=http://localhost:4173 node web/e2e/smoke.mjs
// Env: PLAYWRIGHT_MODULE (default: global playwright), PW_CHROMIUM
// (default: /opt/pw-browsers/chromium; omit to use Playwright's own browser).

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4173";
const mod = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = await import(mod);

const launchOpts = {};
if (process.env.PW_CHROMIUM !== "") {
  launchOpts.executablePath = process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium";
}
const browser = await chromium.launch(launchOpts);
const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures.push(name);
};

const iso = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.addInitScript(
  ({ words }) => localStorage.setItem("sdtype.words", JSON.stringify(words)),
  {
    words: Object.fromEntries(
      ["statistics", "increase", "earlier", "yearly", "recently"].map((w) => [
        w,
        { miss: 3, seen: 5, last: iso(1), streak: 0, due: iso(1) },
      ]),
    ),
  },
);

await page.goto(BASE_URL);
await page.waitForSelector("#words .c");

// --- virtual keyboard path (mobile) ---
const kbd = await page.evaluate(() => {
  const el = document.querySelector("#kbd");
  const text = document.querySelector("#words").textContent ?? "";
  const send = (inputType, data) =>
    el.dispatchEvent(new InputEvent("beforeinput", { inputType, data, cancelable: true, bubbles: true }));
  for (const ch of text.slice(0, 3)) send("insertText", ch);
  send("insertText", "☐");
  send("deleteContentBackward", null);
  const states = [...document.querySelectorAll("#words .c")].slice(0, 4).map((s) => s.className);
  return { states, typing: document.body.classList.contains("typing") };
});
check("virtual kbd: 3 correct chars", kbd.states.slice(0, 3).every((s) => s.includes("correct")));
check("virtual kbd: backspace restores pending", !kbd.states[3].includes("wrong"));
check("virtual kbd: typing mode engaged", kbd.typing);

// --- physical keyboard: finish the passage → results ---
const rest = await page.$eval("#words", (el) => (el.textContent ?? "").slice(3));
for (const ch of rest) await page.keyboard.type(ch, { delay: 2 });
await page.waitForSelector("#results:not([hidden])");
const wpm = await page.$eval("#r-wpm", (el) => Number(el.textContent));
check("results: wpm computed", Number.isFinite(wpm) && wpm > 0);

// --- dashboard + weak-word practice ---
await page.keyboard.press("Enter"); // next passage
await page.waitForSelector("#words .c");
await page.click("#stats-btn");
await page.waitForSelector("#dashboard:not([hidden])");
check("dashboard: goals rendered", (await page.$$eval("#d-goals .goal-row", (r) => r.length)) >= 4);
await page.click("#d-practice");
await page.waitForSelector("#dashboard[hidden]", { state: "attached" });
const attribution = await page.$eval("#attribution", (el) => el.textContent ?? "");
check("practice: weak-word run started", attribution.includes("weak-word practice"));

// --- account modal (signed out) + esc close ---
await page.click("#account-btn");
await page.waitForSelector("#account:not([hidden])");
check(
  "account: three provider buttons",
  (await page.$$eval("#account .provider-btn", (a) => a.length)) === 3,
);
await page.keyboard.press("Escape");
await page.waitForSelector("#account[hidden]", { state: "attached" });
check("account: esc closes", true);

await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} smoke failure(s)`);
  process.exit(1);
}
console.log("\nsmoke green");
