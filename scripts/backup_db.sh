#!/usr/bin/env bash
#
# House Hunter database backup. The DB lives on the Google Drive mount, which
# is a slightly weaker place to run SQLite than a plain local disk, so a
# timestamped, consistent snapshot is cheap insurance. This is safe to run
# while the server is live: it checkpoints the WAL and then uses SQLite's
# online backup API, which produces a coherent copy even with concurrent
# writers (no torn read, no locked-DB error).
#
# Usage:  bash scripts/backup_db.sh
# Exit:   0 = backup written and verified
#         1 = backup failed
#
# Output: data/backups/house_hunter.db.<YYYYMMDD-HHMMSS>.bak
# Retention is manual: prune data/backups yourself when it grows.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${REPO}/data/house_hunter.db"
BACKUP_DIR="${REPO}/data/backups"

if [ ! -f "${DB}" ]; then
  echo "FAIL: database not found at ${DB}" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
TS="$(date +%Y%m%d-%H%M%S)"
DEST="${BACKUP_DIR}/house_hunter.db.${TS}.bak"

# Checkpoint the WAL back into the main DB file, then take a consistent
# snapshot via the online backup API. Both run through python3 stdlib sqlite3,
# no CLI dependency (matches the project's stdlib-only rule).
python3 - "$DB" "$DEST" <<'PY'
import sqlite3, sys
src_path, dest_path = sys.argv[1], sys.argv[2]
src = sqlite3.connect(src_path, timeout=10)
try:
    src.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    dest = sqlite3.connect(dest_path)
    try:
        src.backup(dest)
    finally:
        dest.close()
finally:
    src.close()

# Verify the snapshot opens and passes integrity_check.
chk = sqlite3.connect(dest_path)
try:
    result = chk.execute("PRAGMA integrity_check").fetchone()[0]
finally:
    chk.close()
if result != "ok":
    sys.stderr.write(f"integrity_check on backup = {result}\n")
    sys.exit(1)
PY

if [ $? -eq 0 ] && [ -f "${DEST}" ]; then
  size="$(wc -c < "${DEST}" | tr -d ' ')"
  echo "OK: backup written and verified: ${DEST} (${size} bytes)"
  exit 0
else
  echo "FAIL: backup did not complete" >&2
  rm -f "${DEST}" 2>/dev/null
  exit 1
fi
