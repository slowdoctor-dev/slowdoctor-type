#!/usr/bin/env bash
# Quality gates — run before EVERY commit (AGENTS.md). This script is the
# whole gate: there is deliberately no CI (Director 2026-07-11).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== rust tests (scoring, extract)"
cargo test -p scoring -p extract -p authcore

echo "== worker compile check (wasm)"
rustup target list --installed | grep -q wasm32-unknown-unknown \
  || rustup target add wasm32-unknown-unknown
cargo check -p slowdoctor-type-worker --target wasm32-unknown-unknown

echo "== web selftest + build"
(cd web && [ -d node_modules ] || npm ci)
(cd web && npm test && npm run build)

echo "all gates green"
