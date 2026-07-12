# slowdoctor-type — Agent Guide

Canonical context for any LLM coding agent working in this repo. `CLAUDE.md` points here.

## What this is

A public, single-purpose typing trainer for the owner (a doctor studying English):
type openly licensed, well-written English passages (news / everyday / paper-abstract / federal prose).
Bootstrapped 2026-07-10 from the LEAD workspace design brief
(`lead/1-workspace/_inbox/2026-07-10_typing-trainer-brief.md`); this repo is standalone —
do not read or write the LEAD workspace from here.

## Locked decisions (Director-confirmed 2026-07-10)

1. Separate repo under github `slowdoctor-dev`, deployed at **type.slowdoctor.dev**, linked from slowdoctor.dev (Next.js site — stacks never touch).
2. **Public** deployment → feed may only contain **public-domain or CC BY** text, attribution rendered under every passage. No copyrighted sources, ever. Personal history stays in localStorage. **Amended 2026-07-11 (Director): accounts exist now** — social sign-in (Google/Kakao/GitHub OAuth in the worker, `worker/src/auth.rs`) for profiles and upcoming rankings. Privacy stance: **no email collection**, only provider uid + display-name snapshot; a privacy-policy page is required before adding providers that mandate review (e.g. Naver).
3. **Rust hybrid**: workers-rs backend (API + cron feeder + D1), TypeScript browser UI. UI stays TS — do not port the DOM layer to WASM frameworks.
4. **PMC paper-English track = switchable option**: `track` tag exists in the schema from day one; the UI source toggle persists in localStorage. **Track lineup amended 2026-07-11 (Director)**: now `news` / `daily` / `aesthetic` / `federal` — `classic` (Gutenberg) retired, `medical` renamed `aesthetic` (it is derm/plastic-surgery paper abstracts, not patient-facing health info), `federal` added (modern-English U.S. government works; migration `0005`).
5. **Design: minimal, monkeytype-like** (Director 2026-07-11): quiet text buttons, chrome fades while typing (`body.typing`). **Theme aligned to slowdoctor.dev** (Director, same day, superseding the sage accent): near-black `#0a0a0a` bg, `#ededed` fg, `#888` muted, warm gold accent `#b59768`, `rgba(255,255,255,.1)` borders — reference is `globals.css` in the public `slowdoctor-dev/slowdoctor-web` repo (readable via raw.githubusercontent.com; the container proxy blocks the live site). Chrome text = Inter, headings = Plus Jakarta Sans (both OFL, vendored in `web/public/fonts/` from that repo); the typing stage stays monospace. Canvas charts read colors via `cssVar()` so palette changes propagate. `daily` track = authored everyday chat/reply English (original, CC0) — the register the Director actually writes in.

## Architecture

- `worker/` — workers-rs crate. `#[event(fetch)]` router: `GET /api/passages`, `POST /api/results`, `GET /api/health`, `POST /api/feed` (Bearer `FEED_TOKEN` guard). `#[event(scheduled)]` daily feeder (cron `0 21 * * *` UTC = 06:00 KST).
- `extract/` — source parsing (VOA in `lib.rs`, PMC JATS in `pmc.rs`, federal WordPress feeds in `federal.rs`) as its own dependency-free crate (no scraper/feed-rs; keeps wasm small, and host-runnable tests don't pull the wasm-only `worker` dep). Unit-tested against fixture snippets.
- `authcore/` — pure sign-in/profile logic (login decision state machine, cookie parsing, avatar format) + tests. Exists for the same reason as `extract`: the worker crate is wasm-only, so security-critical decisions live here where `cargo test` can reach them; `worker/src/auth.rs` owns the I/O and delegates.
- `scoring/` — canonical scoring formulas + tests. **Parity rule**: `web/src/scoring.ts` mirrors these formulas exactly; change both together or not at all. (Planned P2: compile this crate to wasm-bindgen and delete the TS mirror.)
- `web/` — Vite + vanilla TS, zero runtime dependencies. Built `web/dist` is served via Workers static assets; unmatched routes (`/api/*`) fall through to the Worker.
- `migrations/` — D1 SQL, applied with `wrangler d1 migrations apply DB [--local|--remote]`.

## VOA extraction contract (verified live 2026-07-10)

- Feed zones (RSS): As It Is `zkm-ql-vomx-tpej-rqi`, Science & Technology `zmg_pl-vomx-tpeymtm`, Health & Lifestyle `zmmpql-vomx-tpey-_q`, Arts & Culture `zpyp_l-vomx-tpe_rym` — full URL `https://learningenglish.voanews.com/api/<zone>`.
- Item links: **slug URLs** (`/a/<slug>/<id>.html`) are text articles; **bare numeric** (`/a/<id>.html`) are audio-only → skip.
- Body lives in `<div class="wsw">…`; take `<p>` contents until the `Words in This Story` glossary heading; drop boilerplate (`No media source currently available`, `_____` separator lines, paragraphs < 4 words).
- Normalize at ingest so passages are typeable: curly quotes → straight, en/em dash → `-`, ellipsis → `...`, NBSP → space, collapse whitespace.
- RSS `<description>` is summary-only — full text always requires the article fetch.
- If extraction starts returning 0 paragraphs, VOA changed their DOM: re-derive the container from a live article before touching code.

## Federal extraction contract (written 2026-07-11 — NOT yet live-verified)

- Sources are WordPress sites whose RSS carries the **full body in `<content:encoded>`** — no article-page fetch, no per-site DOM contract: NASA `https://www.nasa.gov/feed/`, ShareAmerica `https://share.america.gov/feed/`. NOAA deferred (Drupal, no full-content feed).
- Article id = `<source>-<WP post slug>` (last URL path segment). Items without `content:encoded`, or whose cleaned body chunks to 0 passages (galleries, videos), are skipped without being recorded.
- Paragraph cleanup drops government press boilerplate: credit/caption lines, media contacts, "learn more"/link paragraphs, anything containing `@`/`http`/`www.` (see `extract::federal::is_body_paragraph`).
- ⚠️ Written against the standard WP feed format because the dev container had no egress to these hosts (2026-07-11). **Verify on the first cron run**: `/api/health` should show `federal > 0`. If a source stays at 0, fetch its feed by hand, fix the contract, and update this section + the fixtures.
- License note: both sources are U.S. government works (public domain). ShareAmerica occasionally runs externally authored pieces — the `this article was written` boilerplate filter drops their credit line, and if such pieces turn out to carry non-PD notices, drop the source rather than filtering per-article.

## Conventions

- Commit messages: `{YYYY-MM-DD} {English summary}` (no Conventional Commits, no Co-Authored-By).
- Keep the frontend dependency-free at runtime; dev-deps are Vite + TypeScript only.
- **`./scripts/check.sh` must pass before any commit** — it is the entire quality gate: `cargo test -p scoring -p extract`, worker wasm compile check, `cd web && npm test`, `npm run build`. There is deliberately **no CI** (Director 2026-07-11: GitHub Actions retired same day it was added); the gate script is the only enforcement, so never skip it.
- **Run-verification screenshots** (Director standing request, 2026-07-11): after substantive changes, run the app and capture screenshots of the main screens — typing view, results, dashboard — and show them to the Director as proof it runs. Tooling lives in the repo: `web/e2e/shots.mjs` (seeded screenshots) and `scripts/e2e.sh` → `web/e2e/smoke.mjs` (browser smoke: typing incl. virtual keyboard, results, practice launch, account modal). Both need Playwright + Chromium (env knobs in the file headers); they are optional extras on top of the mandatory `scripts/check.sh`.
- **Adding a track touches exactly two lists**: `web/src/tracks.ts` (buttons/goals render from it) and `TRACKS` in `worker/src/lib.rs` — plus a feeder or seed for content.
- Mostly historical: only if working from a DrvFs checkout (`/mnt/c/...`), set `CARGO_TARGET_DIR` onto ext4 via an untracked `.cargo/config.toml` — irrelevant at the canonical `~/repo` location.
- `cargo install worker-build` needs OpenSSL headers; on the original WSL box (no sudo, no libssl-dev) they live in a user-space extract: `export OPENSSL_INCLUDE_DIR=~/.local/openssl-dev/usr/include OPENSSL_LIB_DIR=~/.local/openssl-dev/usr/lib/x86_64-linux-gnu OPENSSL_STATIC=1` (created 2026-07-10 via `apt-get download libssl-dev` + `dpkg -x`). Normal machines: just install `pkg-config libssl-dev`.

## Multi-agent workflow (Claude Code + Codex side by side in tmux)

The Director runs both CLIs in this folder. This file is the shared context: Codex reads `AGENTS.md` natively (agents.md standard), Claude Code arrives via the `CLAUDE.md` pointer. Keep it the single source of truth — never fork per-runtime instructions.

- **Commit is the handoff unit.** Finish → run the quality gates → commit with the `{YYYY-MM-DD} {summary}` format. Never leave work-in-progress uncommitted when yielding to the other agent; start every stint with `git status && git log --oneline -3`.
- **Push `main` only.** Pushing side branches triggers Workers Builds' non-production `wrangler versions upload`, which re-enables the workers.dev + Preview URLs the Director keeps off (bitten 2026-07-11). Keep working branches local; `wrangler.jsonc` pins both flags false so every main deploy re-disables them.
- **Split by area when parallel**: one agent in `worker/`+`extract/`+`migrations/` (Rust/data), the other in `web/` (UI). The seam is the API contract in `worker/src/lib.rs` — change it only with both sides in one commit.
- **Dev servers**: `npx wrangler dev` defaults to port 8787 — a second instance needs `--port 8788`. Both share the same local D1 in `.wrangler/`; don't run two feeders concurrently.
- **Codex note** (machine experience): weaker cwd grounding — give it absolute paths in prompts; model quota pools differ per model.
- **Quality gates before any commit** (both agents, no exceptions): `./scripts/check.sh`. Scoring formula changes require touching the Rust crate and the TS mirror in the same commit (parity rule).
- **Director standing request**: after substantive changes, run the app and deliver screenshots of the main screens (typing / results / dashboard) — in VS Code contexts, also drop copies with clickable file links.

## Roadmap

- **P0 (2026-07-10)**: ✅ VOA news track end-to-end; typing engine; localStorage stats; anonymous aggregate results.
- **P1 (2026-07-10)**: ✅ PMC OA CC BY feeder (`medical` track; contract in `extract/src/pmc.rs` header — E-utilities esearch json → efetch JATS; strict `/licenses/by/` match, by-nc/by-nd rejected); ✅ Gutenberg `classic` seed (`migrations/0002_classic_seed.sql`, 39 verbatim passages: Thoreau/Emerson/Russell/Franklin — regenerate with a fresh anchor-extract script rather than hand-editing texts); ✅ history dashboard (daily WPM/accuracy chart + recent table, localStorage only); ✅ per-track counts in `/api/health` → empty pills dimmed.
- **P2a (2026-07-11)**: ✅ `daily` track (authored CC0 everyday-reply passages, `migrations/0004`); ✅ mistyped-word tracking (`web/src/words.ts`: per-word miss/seen in localStorage, corrected errors count) + problem-word chips + weak-word practice mode (word-soup from your misses; practice results stay out of the server aggregate); ✅ monkeytype-like minimal redesign + focus fade; ✅ `?embed=1` (hides header/footer — for the slowdoctor.dev iframe); ✅ zero-dep TS selftest (`npm test` = node --experimental-strip-types, scoring parity vectors + words logic); ✅ `no-store` on API responses, `articles(track)` index, broader PMC query.
- **P2b (2026-07-11)**: ✅ ~~GitHub Actions CI~~ (added, then retired the same day by Director decision — quality gates run locally via `scripts/check.sh` instead, wasm compile check included); ✅ spaced-repetition scheduling for weak words (SM-2-lite in `web/src/words.ts`: a miss makes the word due immediately, each correct encounter of a missed word schedules the next review 1/3/7/14/30 days out; the practice pool takes due words first and tops up with worst misses; dashboard chips highlight due words; pre-SRS localStorage entries count as due); ✅ per-track daily goals (`web/src/goals.ts` + dashboard editor, `sdtype.goals` in localStorage, today's per-track progress with met-goal accent).
- **P2c (open)**: scoring crate → wasm-bindgen module replacing the TS mirror — was deferred until "builds run on a healthy machine or CI"; CI now exists, so this is unblocked, but it still adds the Rust/wasm toolchain to the web build. Revisit deliberately.
- **P3 (2026-07-11)**: ✅ track rework (Director): `classic` retired, `medical` → `aesthetic`, `federal` added — NASA + ShareAmerica WordPress full-content feeds, migration `0005`, localStorage track value migrated in `main.ts`. Federal contract pending live verification (see its section).
- **P4 (open, Director 2026-07-11)**: passage difficulty — compute a readability score (Flesch-Kincaid grade) at ingest (`fk_grade` column on passages), then a practice-settings panel: **multi-select tracks + FK score range**, with the picker serving matching passages randomly but **evenly distributed** across the selected pool (not biased toward the biggest track).
- **P5 (2026-07-11)**: ✅ social sign-in — Google/Kakao/GitHub OAuth code flow in `worker/src/auth.rs` (D1 `users`/`identities`/`sessions`, migration `0006`), account linking (one user ↔ N providers, conflict-safe), profile panel (nickname + generated avatar: 8×8 mirrored-pattern identicon × background hue, stored `<8 hex>|<hue>`, randomized at signup, rerolled per click; provider buttons carry inline-SVG brand marks), results rows tagged with `user_id` for future rankings. **Not usable until the provider apps are registered and 6 secrets set** — see the sign-in runbook below. Provider order rationale: Google/Kakao/GitHub need no review; Naver (review required) and Apple ($99/yr) deferred.
- **P6 (open)**: per-user rankings + cross-device history sync on top of P5.

## Deploy state

- Canonical location: **`~/repo/slowdoctor-type`** (WSL ext4 — moved 2026-07-11 from `/mnt/c/.../repos/slowdoctor-dev/slowdoctor-type`; move verified: all commits, seeded `.wrangler/` D1, 18 Rust tests + 22 TS selftest checks green on ext4). The old DrvFs copy is a backup only — the GitHub push now exists, so it can be deleted (Director's call). None of the DrvFs workarounds apply here.
- Created 2026-07-10; development split into this independent environment 2026-07-11 (Director decision). The LEAD workspace no longer tracks this project beyond its design brief.
- **On GitHub (public)** since 2026-07-11: https://github.com/slowdoctor-dev/slowdoctor-type — pushed via the `slowdoctor-dev` gh account (switch with `/home/leadprs/bin/gh auth switch -u slowdoctor-dev`, back to `leadprs-clinic` after).
- **Deployed 2026-07-11 via Cloudflare Workers Builds (Git integration)** on the account that owns the slowdoctor.dev zone. **⚠️ Push does NOT currently deploy**: the GitHub→Cloudflare webhook has never fired for this project (known WB integration bug — zero build checks/deployments on any commit; verified 2026-07-11 evening). Until the Director reinstalls the "Cloudflare Workers and Pages" GitHub App, **deploys happen only via the dashboard Deploy button**, which builds the latest `main`. Do not assume a push is live; check `/api/health` (`last_feed`, track counts) or the deploy log. Live at type.slowdoctor.dev (custom domain) + slowdoctor-type.jnzs-ps.workers.dev; cron `0 21 * * *` registered. D1 `slowdoctor-type` = `393706dc-e049-4f48-902f-846df11433de` (created in the dashboard 2026-07-11; migrations 0001–0004 applied by the first build). History: the earlier same-day deploy from leadprs.seoul@gmail.com's account was deleted — custom domains need zone and worker in one account (API error 10083).
- **Workers Builds config** (dashboard → the `slowdoctor-type` Workers project → Settings → Build): the build image has NO Rust preinstalled, so the Build command installs rustup each run: `curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable --target wasm32-unknown-unknown && . "$HOME/.cargo/env" && cd web && npm ci && npm run build`. Deploy command: `. "$HOME/.cargo/env" && npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`. Full build ≈ 6 min (≈3.5 min of it is `cargo install worker-build`).
- **Migrations auto-apply on every deploy** (wrangler auto-confirms in CI). Keep migrations additive; anything destructive needs a deliberate manual window, not a push.
- **Backups**: now that `users`/`identities` hold real account data, run `npx wrangler d1 export DB --remote --output backup-$(date +%F).sql` before destructive migrations and occasionally otherwise; D1 Time Travel (30-day point-in-time restore) is the safety net in between.
- **FEED_TOKEN secret intentionally not set** (Director 2026-07-11: wait for the cron instead of seeding manually). `POST /api/feed` errors until `wrangler secret put FEED_TOKEN` is run; the cron feeder does not need it. First cron fill: 2026-07-12 06:00 KST.

## Sign-in runbook (P5 — one-time provider setup, Director steps)

Each provider needs an app registration; callback URL is always
`https://type.slowdoctor.dev/auth/callback/<provider>`. Put the 6 secrets in
Cloudflare dashboard → the `slowdoctor-type` Worker → Settings → Variables
and Secrets (type Secret). A provider with missing secrets returns 503 from
`/auth/login/<provider>`; the others keep working, so setup can be piecemeal.

1. **Google** — console.cloud.google.com → APIs & Services → Credentials → Create OAuth client ID (Web application); add the callback URL to Authorized redirect URIs; consent screen External + non-sensitive scopes only (we request `openid profile`, no email). → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
2. **Kakao** — developers.kakao.com → 내 애플리케이션 → 앱 만들기 → 카카오 로그인 활성화 + Redirect URI 등록; 동의항목: 닉네임(기본) only, no email (so no biz-app conversion needed); [보안]에서 Client Secret 발급·활성화. → `KAKAO_CLIENT_ID` (= REST API 키), `KAKAO_CLIENT_SECRET`.
3. **GitHub** — github.com/settings/developers → New OAuth App → homepage `https://type.slowdoctor.dev`, callback URL as above. → `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.

E2E check after secrets land: sign in with each provider, link a second one
from the account panel, rename + reroll the avatar, sign out/in again — the
same profile should come back via either provider.
