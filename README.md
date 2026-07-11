# slowdoctor-type

Personal typing trainer with an English-study angle: practice by typing well-written,
openly licensed English prose — current news, everyday replies, paper abstracts, and
U.S. federal features — instead of random word soup.

Live target: **https://type.slowdoctor.dev** (linked from [slowdoctor.dev](https://slowdoctor.dev)).

## How it works

```
[Cron 21:00 UTC daily] → Rust Worker `scheduled` handler (feeder)
    fetch VOA Learning English RSS feeds → filter text articles →
    extract body (div.wsw) → normalize → chunk into 40–80-word passages → D1

[Browser] TypeScript typing UI (Vite, zero runtime deps)
    GET /api/passages?track=news  → one random passage + attribution
    POST /api/results             → anonymous result row (aggregate stats)
    personal history: localStorage only
```

- **Backend**: Rust on Cloudflare Workers ([`workers-rs`](https://github.com/cloudflare/workers-rs)), D1 (SQLite), cron trigger.
- **Frontend**: vanilla TypeScript + Vite, served as Worker static assets. Monkeytype-inspired UX (caret, live WPM, per-char error marking) — written from scratch, no GPL code.
- **Scoring**: `scoring/` Rust crate is the canonical formula set (WPM / raw / accuracy / consistency); the TS mirror in `web/src/scoring.ts` must stay formula-identical (see AGENTS.md).

## Content licensing (hard rule)

This site is public. Only public-domain or CC BY sources may enter the feed,
and every passage renders its attribution + link to the full article.

| Track | Source | License |
|---|---|---|
| `news` | VOA Learning English (As It Is, Science & Tech, Health & Lifestyle, Arts & Culture) — daily feed | Public domain (credit to learningenglish.voanews.com) |
| `daily` | Everyday chat/email/reply English — authored for this project, static seed | Original content (CC0) |
| `aesthetic` | PMC Open Access, strictly CC BY-filtered derm/plastic-surgery abstracts — daily feed | CC BY (attribution rendered per passage) |
| `federal` | U.S. federal features: NASA + ShareAmerica full-content feeds — daily feed | Public domain (U.S. government works) |

## Develop

```bash
# frontend
cd web && npm install && npm run build     # → web/dist

# worker (needs rustup + wasm32-unknown-unknown target)
npx wrangler d1 migrations apply DB --local
npx wrangler dev                           # builds via worker-build, serves UI + API

# scoring tests
cargo test -p scoring
```

## Deploy

Deploys run on Cloudflare **Workers Builds** (Git integration) from `main` —
build/deploy commands live in the Workers project settings, and D1 migrations
are applied automatically by the deploy command. See AGENTS.md "Deploy state"
for the current trigger status and the sign-in secrets runbook.

Manual bootstrap from scratch (no Workers Builds):

```bash
npx wrangler d1 create slowdoctor-type     # put database_id into wrangler.jsonc
npx wrangler d1 migrations apply DB --remote
cd web && npm ci && npm run build && cd ..
npx wrangler deploy
# optional: FEED_TOKEN secret enables manual feeding via POST /api/feed
```
