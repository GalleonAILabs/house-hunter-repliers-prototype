#!/usr/bin/env bash
#
# Standard deploy for the House Hunter prototype. The server runs as a
# per-user LaunchAgent that does NOT hot-reload code: a server.py change is
# not live until the agent is reloaded, and static assets can be pinned in
# the Cloudflare/browser cache for hours. This script does the full ritual
# and then VERIFIES the live domain is actually serving the new code, rather
# than assuming the reload worked (the stale-process failure mode that made
# the Location thresholds section render empty on the live site while working
# locally).
#
# Steps:
#   1. Bump the asset cache-bust token in static/index.html (defeats the
#      Cloudflare Browser Cache TTL that overrides an origin no-cache).
#   2. Commit + push that bump (best effort; local server serves from disk
#      regardless).
#   3. Reload the LaunchAgent so the server runs current server.py.
#   4. Verify locally that the new server answers, then verify the live
#      domain serves the new API and the freshly-versioned app.js.
#
# Usage:  bash scripts/deploy.sh
# Exit:   0 = fully deployed and verified live
#         1 = local server broken after reload (deploy failed)
#         2 = server deployed locally but the live domain could not be
#             verified (usually the Cloudflare tunnel is not running)

set -uo pipefail

PORT=8787
HOST="househunter.galleonglobal.ai"
LIVE="https://${HOST}"
LOCAL="http://127.0.0.1:${PORT}"
PLIST="${HOME}/Library/LaunchAgents/ai.galleonglobal.househunter-server.plist"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INDEX="${REPO}/static/index.html"

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
info() { printf '  ....  %s\n' "$1"; }

app_token() { # $1 = base url; prints the auth token from /api/config
  curl -fsS -m 8 "$1/api/config" 2>/dev/null \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("auth_token",""))' 2>/dev/null
}

echo "House Hunter deploy"
echo "==================="

# --- Pre-flight: surface uncommitted code, since the reload serves whatever
# is on disk, committed or not. ---
if [ -d "${REPO}/.git" ]; then
  dirty="$(git -C "${REPO}" status --porcelain -- server.py static 2>/dev/null)"
  if [ -n "${dirty}" ]; then
    info "note: uncommitted changes under server.py/static will be deployed as-is:"
    printf '%s\n' "${dirty}" | sed 's/^/        /'
  fi
fi

# --- 1. Bump the cache-bust token ---
TOKEN="$(date +%Y%m%d-%H%M%S)"
if [ ! -f "${INDEX}" ]; then
  fail "static/index.html not found at ${INDEX}"; exit 1
fi
# Replace the ?v=... token on both asset URLs. BSD/macOS sed in-place.
sed -i '' -E \
  -e "s#(app\.js\?v=)[A-Za-z0-9._-]+#\1${TOKEN}#" \
  -e "s#(styles\.css\?v=)[A-Za-z0-9._-]+#\1${TOKEN}#" \
  "${INDEX}"
if grep -q "app.js?v=${TOKEN}" "${INDEX}"; then
  pass "bumped asset token to ${TOKEN}"
else
  fail "could not bump asset token in index.html (no ?v= marker found)"; exit 1
fi

# --- 2. Commit + push the bump (best effort) ---
if [ -d "${REPO}/.git" ]; then
  git -C "${REPO}" add static/index.html >/dev/null 2>&1
  if git -C "${REPO}" commit -q -m "chore: deploy, bump asset cache-bust token to ${TOKEN}" >/dev/null 2>&1; then
    pass "committed token bump"
    if git -C "${REPO}" push -q origin main >/dev/null 2>&1; then
      pass "pushed to origin/main"
    else
      info "warn: push failed, commit is local only (push manually later)"
    fi
  else
    info "nothing to commit for the token bump"
  fi
fi

# --- 3. Reload the LaunchAgent ---
if [ ! -f "${PLIST}" ]; then
  fail "LaunchAgent plist not found at ${PLIST}"; exit 1
fi
launchctl unload -w "${PLIST}" >/dev/null 2>&1
launchctl load -w "${PLIST}" >/dev/null 2>&1
info "reloaded LaunchAgent, waiting for the server to come up..."

ready=0
for _ in $(seq 1 20); do
  if curl -fsS -m 3 "${LOCAL}/api/health" >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "${ready}" = "1" ]; then
  pass "server is up on ${LOCAL}"
else
  fail "server did not come up on ${LOCAL} after 20s (check ~/Library/Logs/househunter-server.err.log)"
  exit 1
fi

# --- 4a. Verify the RUNNING process is the new code (has the route the stale
# process 404s). This is the check that catches the stale-process failure. ---
LTOK="$(app_token "${LOCAL}")"
code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' -H "X-App-Token: ${LTOK}" "${LOCAL}/api/person-thresholds")"
if [ "${code}" = "200" ]; then
  pass "local server serves /api/person-thresholds (new code running)"
else
  fail "local /api/person-thresholds returned ${code}, expected 200 (server is running stale code)"
  exit 1
fi
local_len="$(curl -s -m 5 -o /dev/null -w '%{size_download}' "${LOCAL}/app.js")"

# --- 4b. Verify the LIVE domain (through the Cloudflare tunnel) ---
echo "Verifying live domain ${LIVE} ..."
if ! curl -fsS -m 10 "${LIVE}/api/health" >/dev/null 2>&1; then
  fail "live domain unreachable"
  info "the Cloudflare tunnel is probably not running. Start it with:"
  info "    cloudflared tunnel run house-hunter"
  info "(the local server IS deployed and verified; only the public tunnel is down)"
  exit 2
fi

live_ok=1

# index.html on live must reference the token we just wrote
live_token="$(curl -fsS -m 10 "${LIVE}/" 2>/dev/null | grep -oE 'app\.js\?v=[A-Za-z0-9._-]+' | head -1 | sed 's/.*v=//')"
if [ "${live_token}" = "${TOKEN}" ]; then
  pass "live index.html references the new token ${TOKEN}"
else
  fail "live index.html token is '${live_token}', expected '${TOKEN}' (stale index.html)"
  live_ok=0
fi

# live API must serve the new route
lcode="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H "X-App-Token: $(app_token "${LIVE}")" "${LIVE}/api/person-thresholds")"
if [ "${lcode}" = "200" ]; then
  pass "live /api/person-thresholds responds 200"
else
  fail "live /api/person-thresholds returned ${lcode}, expected 200"
  live_ok=0
fi

# versioned app.js must serve fresh content (same bytes as local origin)
lstatus="$(curl -s -m 12 -o /dev/null -w '%{http_code}' "${LIVE}/app.js?v=${TOKEN}")"
live_len="$(curl -s -m 12 -o /dev/null -w '%{size_download}' "${LIVE}/app.js?v=${TOKEN}")"
if [ "${lstatus}" = "200" ] && [ "${live_len}" = "${local_len}" ]; then
  pass "live app.js?v=${TOKEN} serves fresh content (${live_len} bytes, matches origin)"
else
  fail "live app.js?v=${TOKEN}: status ${lstatus}, ${live_len} bytes vs ${local_len} local (stale or truncated)"
  live_ok=0
fi

echo "==================="
if [ "${live_ok}" = "1" ]; then
  echo "Deploy verified live at ${LIVE} (token ${TOKEN})."
  exit 0
else
  echo "Deploy reached the live domain but verification failed above."
  exit 1
fi
