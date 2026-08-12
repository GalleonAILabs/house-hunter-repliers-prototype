#!/usr/bin/env python3
"""Listing import: upsert a data source into the listings table.

One code path serves every trigger. The scheduled LaunchAgent, the in-app
refresh button and the command line all call run_sync(), so there is no
second implementation that can drift.

Guarantees, in order of importance:

1. User-generated data is never written. The importer touches the listings and
   sync_runs tables only. This is not just convention: run_sync fingerprints
   every user table before and after the write and rolls back if any of them
   changed. See USER_TABLES and _fingerprint.
2. Nothing is ever hard-deleted. A listing that leaves the feed is marked
   inactive and keeps its id, because ratings, notes, comments and place
   attachments reference it.
3. A listing's public id is assigned once and pinned forever. Sheet row
   position stops being identity, so sorting or deleting rows in the sheet can
   no longer re-point one person's rating at somebody else's house.
4. A failed or malformed fetch changes nothing. The previous data stays live
   and the failure is recorded in sync_runs.

Stdlib only, per the project's no-pip constraint.
"""
from __future__ import annotations

import datetime
import fcntl
import hashlib
import json
import os
import sqlite3
from typing import Any

import appconfig
import datasources
from datasources import SourceError

# Tables written by people using the app. The importer must never touch these.
# Enforced at runtime by _fingerprint, not left to reviewer discipline.
USER_TABLES = (
    "people",
    "listing_feedback",
    "listing_comments",
    "comment_mentions",
    "comment_reads",
    "comment_archives",
    "saved_areas",
    "poi_pins",
    "listing_place_attachments",
    "person_thresholds",
    "person_column_permissions",
    "person_grid_prefs",
    "potential_purchase_prices",
    "household_settings",
)

# Tables the importer owns.
LISTING_TABLES = ("listings", "sync_runs")

# A feed that has lost more than this fraction of the listings we already hold
# is treated as malformed rather than as a mass delisting. Protects against a
# truncated CSV or a partial export quietly marking the whole portfolio
# inactive. Overridable for tests.
MIN_FEED_RATIO = 0.5


def utcnow() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def init_sync_schema(conn: sqlite3.Connection) -> None:
    """Create the importer's tables. Idempotent, safe on every boot."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS listings (
            -- Public id the rest of the app and all user data reference,
            -- e.g. 'POC-21'. Assigned once, never reassigned.
            listing_id    TEXT PRIMARY KEY,
            -- Numeric part of listing_id, kept separate so a new listing can
            -- be allocated max+1 without parsing strings.
            listing_num   INTEGER NOT NULL UNIQUE,
            -- Upsert key from the source, e.g. 'TREB-N13164916'. Stable across
            -- a relist, unlike the MLS number. See datasources.py.
            source_key    TEXT NOT NULL UNIQUE,
            source        TEXT NOT NULL,
            -- Normalized address, used to re-attach a listing whose source_key
            -- changed (relisted under a new link) to its existing id.
            address_key   TEXT NOT NULL,
            active        INTEGER NOT NULL DEFAULT 1,
            payload       TEXT NOT NULL,
            content_hash  TEXT NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_seen_at  TEXT NOT NULL,
            updated_at    TEXT NOT NULL,
            inactive_at   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_listings_active ON listings(active);
        CREATE INDEX IF NOT EXISTS idx_listings_address ON listings(address_key);

        CREATE TABLE IF NOT EXISTS sync_runs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            source        TEXT NOT NULL,
            trigger       TEXT NOT NULL,
            started_at    TEXT NOT NULL,
            finished_at   TEXT,
            status        TEXT NOT NULL,
            rows_seen     INTEGER NOT NULL DEFAULT 0,
            rows_added    INTEGER NOT NULL DEFAULT 0,
            rows_changed  INTEGER NOT NULL DEFAULT 0,
            rows_inactive INTEGER NOT NULL DEFAULT 0,
            geocoded      INTEGER NOT NULL DEFAULT 0,
            needs_review  INTEGER NOT NULL DEFAULT 0,
            error         TEXT,
            triggered_by  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC);
        """
    )
    conn.commit()


def _fingerprint(conn: sqlite3.Connection) -> str:
    """Hash every user table's full contents.

    Compared before and after the import. Any difference means the importer
    reached somewhere it must not, and the whole transaction is rolled back.
    Cheap at this scale: a few hundred rows across the whole database.
    """
    digest = hashlib.sha256()
    for table in USER_TABLES:
        try:
            rows = conn.execute(f"SELECT * FROM {table}").fetchall()
        except sqlite3.OperationalError:
            continue  # table not created yet on a fresh database
        digest.update(table.encode())
        for row in rows:
            digest.update(repr(tuple(row)).encode())
    return digest.hexdigest()


def _content_hash(record: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(record, sort_keys=True, default=str).encode()
    ).hexdigest()


def _legacy_bootstrap() -> dict[str, dict[str, Any]]:
    """Address -> {num, lat, lon} from the retired exporter's frozen output.

    Only consulted for a listing the table has never seen, which in practice
    means the very first sync. It is what carries the existing 321 ratings and
    notes across: those rows point at POC-<n> ids that were minted from that
    file's row numbers, so the first import has to land on the same ids.
    """
    path = appconfig.LEGACY_POC_PATH
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text())
    except (ValueError, OSError):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in raw.get("properties", []):
        address = datasources.normalize_address(row.get("address") or "")
        num = row.get("row")
        if address and isinstance(num, int):
            out[address] = {"num": num, "lat": row.get("lat"), "lon": row.get("lon")}
    return out


def _build_geocoder(conn: sqlite3.Connection) -> datasources.Geocoder:
    """Geocoder pre-loaded with every coordinate we already trust.

    Anything already resolved is never looked up again, so an existing pin
    cannot move because a geocoder changed its mind.
    """
    geocoder = datasources.Geocoder(os.getenv("MAPBOX_TOKEN", ""))
    for row in conn.execute("SELECT payload FROM listings"):
        try:
            payload = json.loads(row["payload"])
        except (ValueError, TypeError):
            continue
        if payload.get("lat") is not None and payload.get("lon") is not None:
            geocoder.preseed(payload.get("address") or "", payload["lat"], payload["lon"])
    for address, info in _legacy_bootstrap().items():
        if info.get("lat") is not None and info.get("lon") is not None:
            geocoder.preseed(address, info["lat"], info["lon"])
    return geocoder


class SyncLock:
    """Cross-process exclusive lock.

    A file lock rather than a threading lock because the scheduled pull runs in
    its own process (the LaunchAgent) while the button runs inside the server.
    A threading lock would not see the other one at all.
    """

    def __init__(self, path=None) -> None:
        self.path = path or appconfig.SYNC_LOCK_PATH
        self.handle = None

    def __enter__(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = open(self.path, "w")
        try:
            fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.handle.close()
            self.handle = None
            return False
        return True

    def __exit__(self, *exc) -> None:
        if self.handle is not None:
            fcntl.flock(self.handle, fcntl.LOCK_UN)
            self.handle.close()
            self.handle = None


def _record_run(conn: sqlite3.Connection, **fields: Any) -> int:
    columns = ", ".join(fields)
    placeholders = ", ".join("?" for _ in fields)
    cur = conn.execute(
        f"INSERT INTO sync_runs ({columns}) VALUES ({placeholders})", tuple(fields.values())
    )
    conn.commit()
    return int(cur.lastrowid)


def _finish_run(conn: sqlite3.Connection, run_id: int, **fields: Any) -> None:
    assignments = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(
        f"UPDATE sync_runs SET {assignments} WHERE id = ?",
        (*fields.values(), run_id),
    )
    conn.commit()


def run_sync(
    trigger: str = "manual",
    actor_id: int | None = None,
    source_name: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Import the configured source. Returns the run record.

    Never raises for an unreachable or malformed source: the failure is
    recorded and the existing data is left serving.
    """
    owns_conn = conn is None
    conn = conn or appconfig.get_conn()
    try:
        init_sync_schema(conn)
        with SyncLock() as acquired:
            if not acquired:
                run_id = _record_run(
                    conn, source=source_name or appconfig.DATA_SOURCE, trigger=trigger,
                    started_at=utcnow(), finished_at=utcnow(), status="skipped_locked",
                    error="another sync was already running", triggered_by=actor_id,
                )
                return get_run(conn, run_id)
            return _run_locked(conn, trigger, actor_id, source_name)
    finally:
        if owns_conn:
            conn.close()


def _run_locked(
    conn: sqlite3.Connection,
    trigger: str,
    actor_id: int | None,
    source_name: str | None,
) -> dict[str, Any]:
    source_label = (source_name or appconfig.DATA_SOURCE or "sheet").strip().lower()
    started = utcnow()
    run_id = _record_run(
        conn, source=source_label, trigger=trigger, started_at=started,
        status="running", triggered_by=actor_id,
    )

    try:
        geocoder = _build_geocoder(conn)
        source = datasources.get_source(source_name, geocoder=geocoder)
        records = source.fetch_listings()
    except SourceError as exc:
        _finish_run(conn, run_id, finished_at=utcnow(), status="error", error=str(exc))
        return get_run(conn, run_id)
    except Exception as exc:  # a source bug must not take the app down either
        _finish_run(
            conn, run_id, finished_at=utcnow(), status="error",
            error=f"{type(exc).__name__}: {exc}",
        )
        return get_run(conn, run_id)

    active_before = conn.execute(
        "SELECT COUNT(*) FROM listings WHERE active = 1"
    ).fetchone()[0]
    if active_before and len(records) < active_before * MIN_FEED_RATIO:
        _finish_run(
            conn, run_id, finished_at=utcnow(), status="error", rows_seen=len(records),
            error=(
                f"feed returned {len(records)} listings against {active_before} held; "
                "treated as a truncated export and ignored"
            ),
        )
        return get_run(conn, run_id)

    before = _fingerprint(conn)
    try:
        stats = _apply(conn, records, source_label)
    except Exception as exc:
        conn.rollback()
        _finish_run(
            conn, run_id, finished_at=utcnow(), status="error",
            error=f"{type(exc).__name__}: {exc}",
        )
        return get_run(conn, run_id)

    if _fingerprint(conn) != before:
        # Should be unreachable. If it ever fires, the import touched
        # user-generated data and every byte of it is put back.
        conn.rollback()
        _finish_run(
            conn, run_id, finished_at=utcnow(), status="error",
            error="import touched user-generated tables, rolled back",
        )
        return get_run(conn, run_id)

    conn.commit()
    _finish_run(
        conn, run_id, finished_at=utcnow(), status="ok",
        rows_seen=stats["seen"], rows_added=stats["added"],
        rows_changed=stats["changed"], rows_inactive=stats["inactive"],
        geocoded=stats["geocoded"], needs_review=stats["needs_review"],
    )
    return get_run(conn, run_id)


def _apply(
    conn: sqlite3.Connection, records: list[dict[str, Any]], source_label: str
) -> dict[str, int]:
    """Upsert every record, then mark anything absent inactive.

    Runs inside the caller's transaction so a failure part-way leaves the
    listings table exactly as it was.
    """
    existing_by_key: dict[str, sqlite3.Row] = {}
    existing_by_address: dict[str, sqlite3.Row] = {}
    max_num = 0
    for row in conn.execute("SELECT * FROM listings"):
        existing_by_key[row["source_key"]] = row
        existing_by_address.setdefault(row["address_key"], row)
        max_num = max(max_num, row["listing_num"])

    legacy = _legacy_bootstrap()
    if legacy:
        max_num = max(max_num, max(info["num"] for info in legacy.values()))

    now = utcnow()
    added = changed = 0
    seen_ids: set[str] = set()

    for record in records:
        source_key = record["source_key"]
        address_key = datasources.normalize_address(record.get("address") or "")
        payload = dict(record)

        row = existing_by_key.get(source_key)
        if row is None and address_key:
            # Same house, new listing id: a relist. Adopt the existing id so
            # every rating and note already attached to it stays attached.
            row = existing_by_address.get(address_key)

        if row is not None:
            listing_id = row["listing_id"]
            listing_num = row["listing_num"]
        elif address_key in legacy:
            listing_num = legacy[address_key]["num"]
            listing_id = f"POC-{listing_num}"
        else:
            max_num += 1
            listing_num = max_num
            listing_id = f"POC-{listing_num}"

        if listing_id in seen_ids:
            # Two feed rows claiming one identity. Keep the first and skip the
            # duplicate rather than letting them overwrite each other.
            continue
        seen_ids.add(listing_id)

        # normalize_poc builds the public mls as POC-<row>, so 'row' has to be
        # the pinned number, not the current sheet position. The live sheet row
        # travels separately as sheetRow.
        payload["row"] = listing_num
        payload["listingId"] = listing_id
        digest = _content_hash(payload)
        payload_json = json.dumps(payload, sort_keys=True, default=str)

        if row is None:
            conn.execute(
                """
                INSERT INTO listings (listing_id, listing_num, source_key, source,
                                      address_key, active, payload, content_hash,
                                      first_seen_at, last_seen_at, updated_at, inactive_at)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL)
                """,
                (listing_id, listing_num, source_key, source_label, address_key,
                 payload_json, digest, now, now, now),
            )
            added += 1
        else:
            was_inactive = not row["active"]
            if row["content_hash"] != digest or was_inactive:
                conn.execute(
                    """
                    UPDATE listings
                       SET source_key = ?, source = ?, address_key = ?, active = 1,
                           payload = ?, content_hash = ?, last_seen_at = ?,
                           updated_at = ?, inactive_at = NULL
                     WHERE listing_id = ?
                    """,
                    (source_key, source_label, address_key, payload_json, digest,
                     now, now, listing_id),
                )
                changed += 1
            else:
                conn.execute(
                    "UPDATE listings SET last_seen_at = ?, source_key = ? WHERE listing_id = ?",
                    (now, source_key, listing_id),
                )

    # Anything not in this feed is delisted, not deleted. It keeps its id and
    # stays readable so user data pointing at it still resolves.
    placeholders = ", ".join("?" for _ in seen_ids) or "''"
    inactive = conn.execute(
        f"""
        UPDATE listings SET active = 0, inactive_at = ?, updated_at = ?
         WHERE active = 1 AND source = ? AND listing_id NOT IN ({placeholders})
        """,
        (now, now, source_label, *seen_ids),
    ).rowcount

    geocoded = sum(1 for r in records if r.get("geocodeRelevance") is not None)
    needs_review = sum(
        1 for r in records
        if r.get("lat") is None or (r.get("geocodeRelevance") or 1) < 0.8
    )
    return {
        "seen": len(records), "added": added, "changed": changed,
        "inactive": max(inactive, 0), "geocoded": geocoded, "needs_review": needs_review,
    }


# ---------------------------------------------------------------------------
# Read helpers used by the server
# ---------------------------------------------------------------------------

def get_run(conn: sqlite3.Connection, run_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM sync_runs WHERE id = ?", (run_id,)).fetchone()
    return dict(row) if row else {}


def latest_run(conn: sqlite3.Connection, status: str | None = None) -> dict[str, Any] | None:
    try:
        if status:
            row = conn.execute(
                "SELECT * FROM sync_runs WHERE status = ? ORDER BY id DESC LIMIT 1", (status,)
            ).fetchone()
        else:
            row = conn.execute("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1").fetchone()
    except sqlite3.OperationalError:
        return None
    return dict(row) if row else None


def recent_runs(conn: sqlite3.Connection, limit: int = 10) -> list[dict[str, Any]]:
    try:
        rows = conn.execute(
            "SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    except sqlite3.OperationalError:
        return []
    return [dict(r) for r in rows]


def listing_payloads(conn: sqlite3.Connection, include_inactive: bool = True) -> list[dict[str, Any]]:
    """Every imported listing, as the record shape server.normalize_poc reads.

    Inactive listings are included by default and carry inactive=True. A house
    the family rated that has since left the market should say so, not vanish
    and take its notes with it.
    """
    try:
        if include_inactive:
            rows = conn.execute(
                "SELECT payload, active, inactive_at FROM listings ORDER BY listing_num"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT payload, active, inactive_at FROM listings "
                "WHERE active = 1 ORDER BY listing_num"
            ).fetchall()
    except sqlite3.OperationalError:
        return []
    out = []
    for row in rows:
        try:
            payload = json.loads(row["payload"])
        except (ValueError, TypeError):
            continue
        payload["inactive"] = not row["active"]
        payload["inactiveAt"] = row["inactive_at"]
        out.append(payload)
    return out


def has_listings(conn: sqlite3.Connection) -> bool:
    try:
        return conn.execute("SELECT COUNT(*) FROM listings").fetchone()[0] > 0
    except sqlite3.OperationalError:
        return False
