#!/usr/bin/env bash
# Builds the app, seeds a fresh database, starts it in production mode and runs: the browser journey, keyboard checks and the axe audit.
# Requires: DATABASE_URL (a disposable database!), a Chromium-capable Playwright, Node 22. Used by CI and runnable locally.
set -euo pipefail
PORT="${E2E_PORT:-3100}"; export BASE_URL="http://localhost:${PORT}"
: "${DATABASE_URL:?DATABASE_URL must point at a disposable database}"
export APP_SECRET="${APP_SECRET:-ci-secret-0123456789-abcdefghijklmnopqrstuvwxyz}"
export APP_URL="${BASE_URL}"
STORAGE_DIR="$(mktemp -d)"; export STORAGE_DIR
cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$STORAGE_DIR"; }
trap cleanup EXIT

npm run build
npm run db:reset >/dev/null && npm run db:seed >/dev/null
npx next start -p "$PORT" >"${STORAGE_DIR}/server.log" 2>&1 &
SERVER_PID=$!
for i in $(seq 1 40); do curl -fsS "$BASE_URL/" >/dev/null 2>&1 && break; sleep 1; [ "$i" = 40 ] && { echo "server did not start"; tail -20 "${STORAGE_DIR}/server.log"; exit 1; }; done

echo "== browser journey ==";   node tests/e2e/journey.mjs
echo "== reseed for audits =="; npm run db:reset >/dev/null && npm run db:seed >/dev/null
echo "== keyboard checks ==";   node tests/a11y/keyboard.mjs
echo "== axe audit ==";         node tests/a11y/audit.mjs
