# slowdoctor-type — Handoff state

Operational state and one-time runbooks, split out of `AGENTS.md` on 2026-10-26.
`AGENTS.md` describes how the code works; this file describes what is live, what is
pending, and how to deploy. Keep the dated notes; add new ones at the top of each
section rather than rewriting history.

## Deploy state

- Canonical location: **`~/repo/slowdoctor-type`** (WSL ext4 — moved 2026-07-11 from `/mnt/c/.../repos/slowdoctor-dev/slowdoctor-type`; move verified: all commits, seeded `.wrangler/` D1, 18 Rust tests + 22 TS selftest checks green on ext4). The old DrvFs copy is a backup only — the GitHub push now exists, so it can be deleted (Director's call). None of the DrvFs workarounds apply here.
- Created 2026-07-10; development split into this independent environment 2026-07-11 (Director decision). The LEAD workspace no longer tracks this project beyond its design brief.
- **On GitHub (public)** since 2026-07-11: https://github.com/slowdoctor-dev/slowdoctor-type — pushed via the `slowdoctor-dev` gh account (`gh auth switch` between accounts on the original machine).
- **Deployed 2026-07-11 via Cloudflare Workers Builds (Git integration)** on the account that owns the slowdoctor.dev zone. **⚠️ Push does NOT currently deploy**: the GitHub→Cloudflare webhook has never fired for this project (known WB integration bug — zero build checks/deployments on any commit; verified 2026-07-11 evening). Until the Director reinstalls the "Cloudflare Workers and Pages" GitHub App, **deploys happen only via the dashboard Deploy button**, which builds the latest `main`. Do not assume a push is live; check `/api/health` (`last_feed`, track counts) or the deploy log. Live at type.slowdoctor.dev (custom domain; the workers.dev route is disabled); cron `0 21 * * *` registered. D1 `slowdoctor-type` = `393706dc-e049-4f48-902f-846df11433de` (created in the dashboard 2026-07-11; migrations 0001–0004 applied by the first build). History: the earlier same-day deploy went out from the wrong Cloudflare account (the machine's default wrangler session) and was deleted — custom domains need zone and worker in one account (API error 10083).
- **Latest deploy: 2026-07-12, manual (Deploy button), commit `e799978`** — `6702e82` (selection-UX rework + help, later that day) is on `main` but NOT yet deployed; next Deploy-button press ships it (no new migrations). Everything through `e799978` is live: migrations 0005–0012 auto-applied (track rework, accounts, feed_log, pmc rename, vocab+code seeds, fk_grade, user_history), all six tracks, difficulty filter, rankings, history sync, slowdoctor.dev theme. The first cron run under the new schema (able to fill `federal`/`pmc` and backfill fk_grade) is **2026-07-13 06:00 KST** — after it, live-verify the federal contract via `/api/health` (`federal > 0`, `last_feed.errors` empty).
- **Pending Director actions (2026-07-12 session end)**: ① reinstall the "Cloudflare Workers and Pages" GitHub App to fix push-deploys — order matters: disconnect the repo in Worker Settings → Build, uninstall the app at github.com/settings/installations, reconnect in Settings → Build (build/deploy commands below; non-production branch builds OFF). Afterwards an agent should push a test commit, confirm a Cloudflare check appears on it, and delete the ⚠️ warning above. ② Register the 3 OAuth apps + 6 secrets (sign-in runbook below). ③ Paste the GitHub About description (proxy blocks the API write): `Typing trainer for studying English — openly licensed passages (news, everyday replies, medical abstracts, U.S. federal prose, GRE vocab, code) on a Rust Cloudflare Worker + vanilla TS front end.` ④ Decide whether to rewrite git history for commit-author email PII (current files are clean; only historical commit metadata remains).
- **Workers Builds config** (dashboard → the `slowdoctor-type` Workers project → Settings → Build): the build image has NO Rust preinstalled, so the Build command installs rustup each run and pre-installs worker-build via cargo-binstall (prebuilt binary, seconds; auto-falls back to source compile): `curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable --target wasm32-unknown-unknown && . "$HOME/.cargo/env" && curl -L -sSf https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh | bash && cargo binstall -y worker-build && cd web && npm ci && npm run build`. Deploy command: `. "$HOME/.cargo/env" && npx wrangler@4 d1 migrations apply DB --remote && npx wrangler@4 deploy`. Non-production branch builds: OFF (main only). wrangler.jsonc's build command skips `cargo install` when worker-build already exists.
- **Migrations auto-apply on every deploy** (wrangler auto-confirms in CI). Keep migrations additive; anything destructive needs a deliberate manual window, not a push.
- **Backups**: now that `users`/`identities` hold real account data, run `npx wrangler d1 export DB --remote --output backup-$(date +%F).sql` before destructive migrations and occasionally otherwise; D1 Time Travel (30-day point-in-time restore) is the safety net in between.
- **FEED_TOKEN secret intentionally not set** (Director 2026-07-11: wait for the cron instead of seeding manually). `POST /api/feed` errors until `wrangler secret put FEED_TOKEN` is run; the cron feeder does not need it. The 2026-07-12 06:00 KST cron ran against the old 2026-07-11 build/schema; the first cron on the current code is 2026-07-13 06:00 KST.

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
