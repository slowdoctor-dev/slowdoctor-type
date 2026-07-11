# slowdoctor-type

Personal typing trainer with an English-study angle: practice by typing well-written,
openly licensed English prose — current news and (optionally) medical abstracts —
instead of random word soup.

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
| `medical` | PMC Open Access, strictly CC BY-filtered derm/plastic-surgery abstracts — daily feed | CC BY (attribution rendered per passage) |
| `classic` | Project Gutenberg verbatim extracts (Thoreau, Emerson, Russell, Franklin) — static seed migration | Public domain |

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

## Deploy (first time)

```bash
npx wrangler d1 create slowdoctor-type     # put database_id into wrangler.jsonc
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put FEED_TOKEN         # any random string; guards manual feed endpoint
cd web && npm run build && cd ..
npx wrangler deploy
# then: Cloudflare dashboard → Workers → custom domain type.slowdoctor.dev
# seed immediately instead of waiting for cron:
curl -X POST https://type.slowdoctor.dev/api/feed -H "authorization: Bearer $FEED_TOKEN"
```
