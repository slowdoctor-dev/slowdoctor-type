# slowdoctor-type — Agent Guide

Canonical context for any LLM coding agent working in this repo. `CLAUDE.md` points here.

## What this is

A public, single-purpose typing trainer for the owner (a doctor studying English):
type openly licensed, well-written English passages (news / medical / classic prose).
Bootstrapped 2026-07-10 from the LEAD workspace design brief
(`lead/1-workspace/_inbox/2026-07-10_typing-trainer-brief.md`); this repo is standalone —
do not read or write the LEAD workspace from here.

## Locked decisions (Director-confirmed 2026-07-10)

1. Separate repo under github `slowdoctor-dev`, deployed at **type.slowdoctor.dev**, linked from slowdoctor.dev (Next.js site — stacks never touch).
2. **Public** deployment → feed may only contain **public-domain or CC BY** text, attribution rendered under every passage. No copyrighted sources, ever. Personal history stays in localStorage (no accounts). A cross-device history would be an Access-gated path later, not auth code.
3. **Rust hybrid**: workers-rs backend (API + cron feeder + D1), TypeScript browser UI. UI stays TS — do not port the DOM layer to WASM frameworks.
4. **PMC medical-English track = switchable option**: `track` tag exists in the schema from day one (`news` / `daily` / `medical` / `classic`); the UI source toggle persists in localStorage.
5. **Design: minimal, monkeytype-like** (Director 2026-07-11): quiet text buttons, chrome fades while typing (`body.typing`), muted dark palette with the sage accent kept for brand. `daily` track = authored everyday chat/reply English (original, CC0) — the register the Director actually writes in.

## Architecture

- `worker/` — workers-rs crate. `#[event(fetch)]` router: `GET /api/passages`, `POST /api/results`, `GET /api/health`, `POST /api/feed` (Bearer `FEED_TOKEN` guard). `#[event(scheduled)]` daily feeder (cron `0 21 * * *` UTC = 06:00 KST).
- `extract/` — VOA-specific parsing as its own dependency-free crate (no scraper/feed-rs; keeps wasm small, and host-runnable tests don't pull the wasm-only `worker` dep). Unit-tested against fixture snippets.
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

## Conventions

- Commit messages: `{YYYY-MM-DD} {English summary}` (no Conventional Commits, no Co-Authored-By).
- Keep the frontend dependency-free at runtime; dev-deps are Vite + TypeScript only.
- `cargo test -p scoring -p extract`, `cd web && npm test` (scoring-parity + words-logic selftest), and `npm run build` must pass before any push.
- **Run-verification screenshots** (Director standing request, 2026-07-11): after substantive changes, run the app (`wrangler dev`) and capture screenshots of the main screens — typing view, results, dashboard — and show them to the Director as proof it runs.
- Builds on WSL DrvFs are slow: set `CARGO_TARGET_DIR=~/.cache/slowdoctor-type-target` (an untracked `.cargo/config.toml` does this on the original WSL machine; recreate as needed — machine-specific, deliberately not committed).
- `cargo install worker-build` needs OpenSSL headers; on the original WSL box (no sudo, no libssl-dev) they live in a user-space extract: `export OPENSSL_INCLUDE_DIR=~/.local/openssl-dev/usr/include OPENSSL_LIB_DIR=~/.local/openssl-dev/usr/lib/x86_64-linux-gnu OPENSSL_STATIC=1` (created 2026-07-10 via `apt-get download libssl-dev` + `dpkg -x`). Normal machines: just install `pkg-config libssl-dev`.

## Roadmap

- **P0 (2026-07-10)**: ✅ VOA news track end-to-end; typing engine; localStorage stats; anonymous aggregate results.
- **P1 (2026-07-10)**: ✅ PMC OA CC BY feeder (`medical` track; contract in `extract/src/pmc.rs` header — E-utilities esearch json → efetch JATS; strict `/licenses/by/` match, by-nc/by-nd rejected); ✅ Gutenberg `classic` seed (`migrations/0002_classic_seed.sql`, 39 verbatim passages: Thoreau/Emerson/Russell/Franklin — regenerate with a fresh anchor-extract script rather than hand-editing texts); ✅ history dashboard (daily WPM/accuracy chart + recent table, localStorage only); ✅ per-track counts in `/api/health` → empty pills dimmed.
- **P2a (2026-07-11)**: ✅ `daily` track (authored CC0 everyday-reply passages, `migrations/0004`); ✅ mistyped-word tracking (`web/src/words.ts`: per-word miss/seen in localStorage, corrected errors count) + problem-word chips + weak-word practice mode (word-soup from your misses; practice results stay out of the server aggregate); ✅ monkeytype-like minimal redesign + focus fade; ✅ `?embed=1` (hides header/footer — for the slowdoctor.dev iframe); ✅ zero-dep TS selftest (`npm test` = node --experimental-strip-types, scoring parity vectors + words logic); ✅ `no-store` on API responses, `articles(track)` index, broader PMC query.
- **P2b (open)**: spaced-repetition scheduling for weak words (current v1 is frequency-based); per-track daily goals; scoring crate → wasm-bindgen module replacing the TS mirror — **deliberately deferred**: it would make the web build depend on the Rust/wasm toolchain (fragile on the original WSL box), for ~40 lines of mirrored math already guarded by parity selftests. Revisit only when builds run on a healthy machine or CI.

## Deploy state

- Created 2026-07-10; **not yet deployed** — `database_id` in `wrangler.jsonc` is a placeholder until `wrangler d1 create slowdoctor-type` runs. Follow README "Deploy (first time)".
