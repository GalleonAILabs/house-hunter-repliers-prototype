#!/usr/bin/env python3
"""Shared paths, env loading, and DB connection settings.

server.py predates this module and keeps its own copies of ROOT/DB_PATH/
load_env, so nothing here changes how the server boots. This exists so the
importer (datasources.py, sync.py, scripts/sync_now.py) can open the same
database with the same crash-safety pragmas without importing server.py,
which would be circular once server.py imports sync.py.

Stdlib only, per the project's no-pip constraint.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "house_hunter.db"
# The frozen one-off export from the retired scripts/export_poc.py. After the
# first sync the listings table is authoritative; this file survives only as
# the bootstrap that maps a legacy address to the POC-<n> id already recorded
# against a family member's ratings and notes.
LEGACY_POC_PATH = DATA_DIR / "poc_listings.json"
SYNC_LOCK_PATH = DATA_DIR / ".sync.lock"
GEOCODE_CACHE_PATH = DATA_DIR / "geocode_cache.json"


def load_env() -> None:
    """Read .env into os.environ without overriding a real environment value."""
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


load_env()

# Which adapter backs the property list. The sheet importer must be removable
# by config alone, so every sheet-specific code path hangs off this value and
# nothing else. Setting DATA_SOURCE=repliers disables the sheet with no edit.
DATA_SOURCE = os.getenv("DATA_SOURCE", "sheet").strip().lower()
# Sheet identifiers. The gid is the Properties tab. Overridable so a copy of
# the sheet can be pointed at without a code change, and so a test can aim the
# importer at a deliberately broken URL.
SHEET_ID = os.getenv("SHEET_ID", "1lr57peXyWrQ0AsCVY0e1Ir8jtd39UccPeEY9QTeayLk")
SHEET_PROPERTIES_GID = os.getenv("SHEET_PROPERTIES_GID", "1790810273")
SHEET_CSV_URL_TEMPLATE = os.getenv(
    "SHEET_CSV_URL_TEMPLATE",
    "https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}",
)
# The four scheduled pull times, in America/Toronto local hours.
SYNC_HOURS = tuple(
    int(h) for h in os.getenv("SYNC_HOURS", "6,10,14,18").split(",") if h.strip()
)
SYNC_TIMEZONE = os.getenv("SYNC_TIMEZONE", "America/Toronto")


def sheet_csv_url() -> str:
    return SHEET_CSV_URL_TEMPLATE.format(sheet_id=SHEET_ID, gid=SHEET_PROPERTIES_GID)


def get_conn() -> sqlite3.Connection:
    """Open a connection with the same durability pragmas server.get_db uses.

    synchronous=FULL is per connection, so it has to be set here too, not just
    where the schema was created. See RECOVERY.md.
    """
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute("PRAGMA busy_timeout = 15000")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = FULL")
    conn.row_factory = sqlite3.Row
    return conn
