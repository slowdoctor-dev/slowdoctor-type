// Run-verification screenshots (Director standing request): typing view,
// results card, dashboard, account panel — with seeded history/words so the
// screens look lived-in. Same env knobs as smoke.mjs; output dir via OUT_DIR
// (default ./e2e-shots).
//
//   BASE_URL=http://localhost:4173 OUT_DIR=/tmp/shots node web/e2e/shots.mjs

import { mkdirSync } from "node:fs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4173";
const OUT = process.env.OUT_DIR ?? "e2e-shots";
const mod = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = await import(mod);
mkdirSync(OUT, { recursive: true });

const launchOpts = {};
if (process.env.PW_CHROMIUM !== "") {
  launchOpts.executablePath = process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium";
}

const day = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const iso = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString();

const history = [];
for (let i = 13; i >= 1; i--) {
  for (let j = 0; j < 2; j++) {
    history.push({
      at: `${day(i)}T0${2 + j}:00:00.000Z`,
      wpm: 52 + (13 - i) * 1.3 + j,
      rawWpm: 60 + (13 - i) * 1.3,
      accuracy: 94 + (13 - i) * 0.3,
      consistency: 70 + (13 - i),
      durationMs: 60000,
      track: j ? "daily" : "news",
      passageId: 100 + i,
    });
  }
}
const words = Object.fromEntries(
  ["statistics", "representative", "earlier", "increase", "recently", "yearly"].map((w, i) => [
    w,
    { miss: 2 + (i % 3), seen: 5 + i, last: iso(1), streak: i % 2, due: iso(i % 2 ? -3 : 1) },
  ]),
);

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.addInitScript(
  ({ history, words }) => {
    localStorage.setItem("sdtype.history", JSON.stringify(history));
    localStorage.setItem("sdtype.words", JSON.stringify(words));
    localStorage.setItem("sdtype.goals", JSON.stringify({ news: 3, daily: 1 }));
  },
  { history, words },
);

await page.goto(BASE_URL);
await page.waitForSelector("#words .c");
const text = await page.$eval("#words", (el) => el.textContent ?? "");

// 1) typing view mid-run (a couple of corrected errors for realism)
const head = text.slice(0, 70);
for (let i = 0; i < head.length; i++) {
  if (i === 20 || i === 45) {
    await page.keyboard.type("x", { delay: 10 });
    await page.keyboard.press("Backspace");
  }
  await page.keyboard.type(head[i], { delay: 10 });
}
await page.waitForTimeout(1300); // live wpm ticker starts after 1s
await page.screenshot({ path: `${OUT}/1-typing.png` });

// 2) results card
for (const c of text.slice(70)) await page.keyboard.type(c, { delay: 3 });
await page.waitForSelector("#results:not([hidden])");
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/2-results.png` });

// 3) dashboard
await page.keyboard.press("Enter");
await page.waitForSelector("#words .c");
await page.click("#stats-btn");
await page.waitForSelector("#dashboard:not([hidden])");
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/3-dashboard.png` });
await page.keyboard.press("Escape");

// 4) account panel (signed-in state mocked)
await page.route("**/api/me", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: { nickname: "slowdoctor", avatar: "a1b2c3d4|30" },
      providers: ["google", "kakao"],
    }),
  }),
);
await page.reload();
await page.waitForSelector("#words .c");
await page.click("#account-btn");
await page.waitForSelector("#account:not([hidden])");
await page.screenshot({ path: `${OUT}/4-account.png` });
await page.keyboard.press("Escape");

// 5) custom practice panel
await page.click("#custom-btn");
await page.waitForSelector("#settings:not([hidden])");
await page.screenshot({ path: `${OUT}/5-custom.png` });
await page.keyboard.press("Escape");

// 6) help
await page.click("#help-btn");
await page.waitForSelector("#help:not([hidden])");
await page.screenshot({ path: `${OUT}/6-help.png` });

await browser.close();
console.log(`screenshots written to ${OUT}/`);
