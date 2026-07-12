#!/usr/bin/env bash
# Browser smoke test (web/e2e/smoke.mjs): builds the web app, serves it,
# drives it with Playwright. Optional — needs playwright + Chromium; the
# mandatory gate is scripts/check.sh. Env knobs documented in smoke.mjs.
set -euo pipefail
cd "$(dirname "$0")/../web"

[ -d node_modules ] || npm ci
npm run build >/dev/null

npx vite preview --port 4173 --strictPort >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for _ in $(seq 1 20); do
  curl -sf http://localhost:4173/ >/dev/null && break
  sleep 0.5
done

BASE_URL=http://localhost:4173 node e2e/smoke.mjs
