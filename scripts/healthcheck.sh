#!/usr/bin/env bash
#
# House Hunter post-reboot healthcheck. Run this after an unexpected shutdown
# (or any time) to confirm the app came back up on its own and the database is
# intact. It checks the whole chain: the server LaunchAgent, the local server,
# the SQLite integrity, the tunnel process, and the public domain end to end.
#
# Usage:  bash scripts/healthcheck.sh
# Exit:   0 = everything healthy
#         1 = one or more critical checks failed (see the FAIL lines)
#
# It is read-only. It never restarts anything. If a check fails, RECOVERY.md
# has the launchctl commands to bring the failed piece back.

set -uo pipefail

PORT=8787
HOST="househunter.galleonglobal.ai"
LIVE="https://${HOST}"
LOCAL="http://127.0.0.1:${PORT}"
AGENT="ai.galleonglobal.househunter-server"
PLIST="${HOME}/Library/LaunchAgents/${AGENT}.plist"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${REPO}/data/house_hunter.db"

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; ok=0; }
info() { printf '  ....  %s\n' "$1"; }

ok=1

echo "House Hunter healthcheck"
echo "========================"

# --- 1. Server LaunchAgent is loaded ---
if launchctl list 2>/dev/null | grep -q "${AGENT}"; then
  pass "LaunchAgent ${AGENT} is loaded"
else
  fail "LaunchAgent ${AGENT} is NOT loaded (load it: launchctl load -w ${PLIST})"
fi

# --- 2. Local server answers ---
if curl -fsS -m 5 "${LOCAL}/api/health" >/dev/null 2>&1; then
  pass "local server responds on ${LOCAL}/api/health"
else
  fail "local server did not answer on ${LOCAL} (check ~/Library/Logs/househunter-server.err.log)"
fi

# --- 3. SQLite integrity ---
if [ ! -f "${DB}" ]; then
  fail "database not found at ${DB}"
else
  integ="$(python3 -c "import sqlite3;print(sqlite3.connect('${DB}').execute('PRAGMA integrity_check').fetchone()[0])" 2>/dev/null)"
  if [ "${integ}" = "ok" ]; then
    pass "database integrity_check = ok"
  else
    fail "database integrity_check = '${integ}' (restore from data/backups; see RECOVERY.md)"
  fi
  jmode="$(python3 -c "import sqlite3;print(sqlite3.connect('${DB}').execute('PRAGMA journal_mode').fetchone()[0])" 2>/dev/null)"
  if [ "${jmode}" = "wal" ]; then
    pass "database journal_mode = wal (crash safe)"
  else
    fail "database journal_mode = '${jmode}', expected wal"
  fi
fi

# --- 4. Tunnel process is running ---
if pgrep -f "cloudflared.*tunnel run" >/dev/null 2>&1; then
  pass "cloudflared tunnel process is running"
else
  fail "cloudflared tunnel is NOT running (it is a system LaunchDaemon; see RECOVERY.md)"
fi

# --- 5. Public domain end to end ---
if curl -fsS -m 10 "${LIVE}/api/health" >/dev/null 2>&1; then
  pass "public domain ${LIVE}/api/health responds"
else
  fail "public domain ${LIVE} unreachable (tunnel or server down; see RECOVERY.md)"
fi

echo "========================"
if [ "${ok}" = "1" ]; then
  echo "Healthy."
  exit 0
else
  echo "One or more checks FAILED. See RECOVERY.md for the fix per check."
  exit 1
fi
