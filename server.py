#!/usr/bin/env python3
"""House Hunter Repliers prototype.

Small stdlib-only web server. It keeps the Repliers API key server-side,
normalizes sample listing data, and serves a Leaflet/card UI.
"""
from __future__ import annotations

import functools
import json
import math
import os
import re
import sqlite3
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"


def load_env() -> None:
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
API_KEY = os.getenv("REPLIERS_API_KEY", "")
BASE_URL = os.getenv("REPLIERS_BASE_URL", "https://api.repliers.io").rstrip("/")
PORT = int(os.getenv("PORT", "8787"))
CDN_BASE = "https://cdn.repliers.io/"
POC_DATA_PATH = ROOT / "data" / "poc_listings.json"
DB_PATH = ROOT / "data" / "house_hunter.db"
APP_AUTH_TOKEN = os.getenv("APP_AUTH_TOKEN", "")
# Mapbox tokens are meant to be public/client-side (restricted by URL on the
# Mapbox account, not by secrecy) -- unlike REPLIERS_API_KEY, it's fine for
# this to travel through the unprotected /api/config bootstrap endpoint.
MAPBOX_TOKEN = os.getenv("MAPBOX_TOKEN", "")
ALLOWED_ACTION_TYPES = {"rating", "note", "reject", "research_request"}
ALLOWED_POI_TYPES = {"school", "hospital", "work", "worship", "other"}

# Per-person location thresholds (person_thresholds table). Unlike
# household_settings (one shared value per key for the whole group), these
# are per person in structure: each buyer has their own row (realtors are
# excluded, see person_thresholds_all). They
# are still stored server-side and visible to everyone, exactly like a
# household setting -- if Katie changes her drive time on her phone, it
# shows on Mark's device too. Anyone in the household may edit anyone's
# thresholds, so updated_by/updated_at record who last touched a person's
# row, the same attribution shape household_settings and
# potential_purchase_prices use.
#
# travel_mode is how the person travels to their destination; the
# destination itself references a GO station or an existing POI pin (one
# source of truth for places), never a free-typed address. The actual
# travel-time computation against these destinations is deferred (see
# DECISIONS.md T13), so these fields are storage-only for now: they hold
# enough (minutes, optional total, mode, destination) that the computation
# can plug in later without a schema change.
ALLOWED_TRAVEL_MODES = {"drive", "transit", "walk", "bike"}
ALLOWED_TRAVEL_DEST_KINDS = {"go_station", "poi"}
# Migration of the old "nearest GO drive <= 20 min" rule: it never lived in
# code as a threshold, only as frozen text inside the precomputed POC fit
# strings (data/poc_listings.json), so nothing in code read it. Seeding it
# here as each buyer's initial travel-time threshold makes it a real,
# per-person, editable value for the first time. The 5 km straight-line
# highway distance is the household's noise/pollution limit and lives in
# household_settings (see HOUSEHOLD_SETTING_DEFAULTS), not per person.
MIGRATED_GO_THRESHOLD_MIN = 20

# Household-level settings (household_settings table): one shared value per
# key across the whole buyer group, not per person. Defaults apply only
# when a key has never been set; they are not hardcoded in the sense of
# being unchangeable, they are just the starting value before anyone edits
# it, same as any other settings default. first_time_buyer defaults true:
# both Mark and Katie are first-time buyers today.
#
# down_payment_pct/interest_rate_pct/amortization_years/property_tax_pct
# and the four fixed closing-cost figures feed the potential-purchase-price
# mortgage estimate (see compute_mortgage_breakdown). interest_rate_pct and
# property_tax_pct are deliberately round, clearly-labeled illustrative
# figures, not scraped from a live rate source, since real rates vary by
# lender, municipality, and day; both must be editable so a household can
# swap in their own quoted rate or actual tax bill. The fixed closing items
# (legal, inspection, appraisal, title insurance) are flat estimates, not
# computed from price, same reasoning.
#
# highway_km is the household's minimum acceptable straight-line distance to
# a 400-series highway (a noise/pollution radius). It is a household
# position, not individual taste, so it lives here rather than per person;
# it does NOT feed the mortgage estimate, it drives the card highway badge
# and the highway-distance filter.
HOUSEHOLD_SETTING_DEFAULTS: dict[str, str] = {
    "first_time_buyer": "true",
    "down_payment_pct": "10",
    "interest_rate_pct": "5.0",
    "amortization_years": "30",
    "property_tax_pct": "1.0",
    "legal_fees_flat": "1500",
    "home_inspection_flat": "500",
    "appraisal_flat": "350",
    "title_insurance_flat": "300",
    "highway_km": "5",
}

# D10: known POC listing ids, loaded once at startup (see load_poc_listing_ids).
# Repliers-sourced ids are format-checked only, not existence-checked against
# this set. See validate_listing_id. POC_LISTING_COORDS maps each POC id to
# its (lat, lon) so place attachments can compute distance/drive time from a
# listing without re-reading the data file per request.
POC_LISTING_IDS: set[str] = set()
POC_LISTING_COORDS: dict[str, tuple[float, float]] = {}

# Demo participants (buyer_group_id stub column stays null until a real
# buyer_groups table exists, see PROJECT_BRIEF.md commercial path). Anees
# and Kevin are realtors in-app even though they are also co-investors in
# House Hunter as a product, per PROJECT_BRIEF.md. "realtor" is the stored
# role token AND the displayed value, one source of truth (an earlier
# display-time mapping from a stored "advisor" token was replaced by a real
# schema migration, see migrate_role_advisor_to_realtor).
SEED_PEOPLE = [
    ("Mark", "buyer"),
    ("Katie", "buyer"),
    ("Anees", "realtor"),
    ("Kevin", "realtor"),
]


def get_db() -> sqlite3.Connection:
    """Open a short-lived per-request connection.

    server.py runs ThreadingHTTPServer, so sqlite3.Connection objects must
    not be shared across threads. Each request opens and closes its own
    connection instead.
    """
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.row_factory = sqlite3.Row
    return conn


def migrate_role_advisor_to_realtor(conn: sqlite3.Connection) -> dict[str, Any] | None:
    """One-time, idempotent rename of the stored people.role value 'advisor'
    to 'realtor', including its CHECK constraint. SQLite cannot alter a CHECK
    in place, so this rebuilds the people table, preserving every id -- and
    therefore every foreign reference from listing_feedback, poi_pins,
    person_thresholds, and potential_purchase_prices, all of which key off
    people.id, never off role. Runs inside a transaction. Returns before/after
    verification counts, or None when the table is already migrated (a no-op,
    detected by the CHECK no longer mentioning 'advisor')."""
    schema = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='people'"
    ).fetchone()
    if not schema or "'advisor'" not in schema[0]:
        return None  # already migrated, or a fresh DB created with the new schema

    def snapshot() -> dict[str, Any]:
        return {
            "people_total": conn.execute("SELECT COUNT(*) FROM people").fetchone()[0],
            "roles": dict(conn.execute("SELECT role, COUNT(*) FROM people GROUP BY role").fetchall()),
            "people_ids": [r[0] for r in conn.execute("SELECT id FROM people ORDER BY id").fetchall()],
            "listing_feedback": conn.execute("SELECT COUNT(*) FROM listing_feedback").fetchone()[0],
            "poi_pins": conn.execute("SELECT COUNT(*) FROM poi_pins").fetchone()[0],
            "person_thresholds": conn.execute("SELECT COUNT(*) FROM person_thresholds").fetchone()[0],
            "potential_purchase_prices": conn.execute(
                "SELECT COUNT(*) FROM potential_purchase_prices"
            ).fetchone()[0],
        }

    before = snapshot()
    # FKs are not enforced in this app anyway; OFF is belt-and-suspenders so the
    # DROP TABLE cannot cascade. Set outside the transaction (PRAGMA fk is a
    # no-op inside one).
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.executescript(
        """
        BEGIN;
        CREATE TABLE people_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('buyer', 'realtor')),
            buyer_group_id INTEGER,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        INSERT INTO people_new (id, name, role, buyer_group_id, created_at)
            SELECT id, name,
                   CASE role WHEN 'advisor' THEN 'realtor' ELSE role END,
                   buyer_group_id, created_at
            FROM people;
        DROP TABLE people;
        ALTER TABLE people_new RENAME TO people;
        COMMIT;
        """
    )
    conn.execute("PRAGMA foreign_keys = ON")
    after = snapshot()
    return {"before": before, "after": after}


def migrate_highway_km_to_household(conn: sqlite3.Connection) -> dict[str, Any] | None:
    """Move the highway distance threshold from per-person to household. It is
    a household position (a noise/pollution radius), not individual taste. If
    household_settings has no highway_km yet, copy a representative existing
    per-person value into it (buyers all held the same 5 km), then drop the
    person_thresholds.highway_km column. Idempotent: returns None once the
    column is gone. SQLite >= 3.35 supports ALTER TABLE DROP COLUMN."""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(person_thresholds)").fetchall()]
    if "highway_km" not in cols:
        return None

    migrated_value = None
    has_household = conn.execute(
        "SELECT 1 FROM household_settings WHERE key = 'highway_km'"
    ).fetchone()
    if has_household is None:
        row = conn.execute(
            "SELECT highway_km FROM person_thresholds "
            "WHERE highway_km IS NOT NULL ORDER BY person_id LIMIT 1"
        ).fetchone()
        km = float(row[0]) if row and row[0] is not None else float(HOUSEHOLD_SETTING_DEFAULTS["highway_km"])
        migrated_value = str(int(km)) if km.is_integer() else str(km)
        conn.execute(
            "INSERT INTO household_settings (key, value, updated_by) VALUES ('highway_km', ?, NULL)",
            (migrated_value,),
        )
    conn.execute("ALTER TABLE person_thresholds DROP COLUMN highway_km")
    return {"migrated_value": migrated_value}


def init_db() -> None:
    """Create the schema (if missing) and seed the four demo participants."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5)
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS people (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('buyer', 'realtor')),
                buyer_group_id INTEGER,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );

            CREATE TABLE IF NOT EXISTS listing_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                person_id INTEGER NOT NULL REFERENCES people(id),
                listing_id TEXT NOT NULL,
                action_type TEXT NOT NULL CHECK (
                    action_type IN ('rating', 'note', 'reject', 'research_request')
                ),
                rating INTEGER,
                status TEXT,
                note TEXT,
                reason TEXT,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );

            CREATE INDEX IF NOT EXISTS idx_feedback_listing ON listing_feedback(listing_id);
            CREATE INDEX IF NOT EXISTS idx_feedback_person ON listing_feedback(person_id);

            CREATE TABLE IF NOT EXISTS poi_pins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL CHECK (
                    type IN ('school', 'hospital', 'work', 'worship', 'other')
                ),
                label TEXT,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                created_by INTEGER NOT NULL REFERENCES people(id),
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );

            -- Household-level settings: one shared value per key across the
            -- whole buyer group, not per person, the same way a household
            -- fact like first-time-buyer status is one fact about the
            -- household, not one opinion per person. Key/value rather than
            -- a dedicated column per setting, so the next household-level
            -- setting (units of measure, onboarding destination, both
            -- still unbuilt) reuses this same table instead of a new
            -- migration each time.
            CREATE TABLE IF NOT EXISTS household_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_by INTEGER REFERENCES people(id),
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );

            -- One shared price per listing, not per person, the same way
            -- a household's negotiating position on a specific property is
            -- one fact the group holds, not one opinion per person. Same
            -- upsert-by-primary-key shape as household_settings.
            CREATE TABLE IF NOT EXISTS potential_purchase_prices (
                listing_id TEXT PRIMARY KEY,
                price REAL NOT NULL,
                updated_by INTEGER REFERENCES people(id),
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );

            -- Per-person location thresholds. Per person in structure (one
            -- row per person), but stored server-side and shared with the
            -- whole group like household_settings, not scoped to a device.
            -- A dedicated typed table rather than the key/value
            -- household_settings shape because the travel-time threshold is
            -- one compound record (minutes + optional total + mode +
            -- destination) that must stay together and plug into the
            -- deferred travel-time computation without restructuring;
            -- key/value rows would scatter one logical setting across many
            -- rows. Every threshold column is nullable: NULL means "not set
            -- for this person". updated_by/updated_at are row-level
            -- attribution (who last edited this person's thresholds), the
            -- same shape as potential_purchase_prices.
            CREATE TABLE IF NOT EXISTS person_thresholds (
                person_id INTEGER PRIMARY KEY REFERENCES people(id),
                travel_minutes INTEGER,
                travel_total_minutes INTEGER,
                travel_mode TEXT,
                travel_dest_kind TEXT,
                travel_dest_ref TEXT,
                updated_by INTEGER REFERENCES people(id),
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );

            -- Per-property place attachments (T-attach). A buyer attaches a
            -- place (always a POI pin, one source of truth for places) to a
            -- specific listing. Shared across the whole group like notes;
            -- created_by is attribution, not a privacy boundary. straight_km
            -- is the crow-flies distance; drive_minutes/drive_km are the
            -- street-routed Mapbox Directions result, computed once on attach
            -- and cached here (recomputed only on explicit request), null when
            -- routing was unavailable. UNIQUE stops the same place being
            -- attached to the same listing twice.
            CREATE TABLE IF NOT EXISTS listing_place_attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                listing_id TEXT NOT NULL,
                poi_id INTEGER NOT NULL REFERENCES poi_pins(id),
                straight_km REAL,
                drive_minutes REAL,
                drive_km REAL,
                computed_at TEXT,
                created_by INTEGER NOT NULL REFERENCES people(id),
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                UNIQUE (listing_id, poi_id)
            );
            """
        )

        # Rename any stored role 'advisor' -> 'realtor' (rebuilds people,
        # preserving ids and all foreign references). No-op once migrated or
        # on a fresh DB. Runs before the seed/count below so everything after
        # sees the final schema and values.
        migration = migrate_role_advisor_to_realtor(conn)
        if migration is not None:
            print(f"people.role migration advisor->realtor: {migration}")

        # Move the highway distance threshold from per-person to household:
        # copy an existing 5 km value into household_settings, then drop the
        # person_thresholds.highway_km column. No-op once the column is gone.
        hwy_migration = migrate_highway_km_to_household(conn)
        if hwy_migration is not None:
            print(f"highway_km migration to household_settings: {hwy_migration}")

        existing = conn.execute("SELECT COUNT(*) FROM people").fetchone()[0]
        if existing == 0:
            conn.executemany(
                "INSERT INTO people (name, role) VALUES (?, ?)", SEED_PEOPLE
            )

        # Migrate the old 20-minute nearest-GO rule into the structured
        # per-person store, once. Seeded for buyers only (the 20-min rule
        # was a buyer criterion; realtors get no thresholds). Guarded on the
        # table being empty so restarts never re-seed. updated_by is NULL:
        # this is a migration default, not an edit any person made.
        thresholds_seeded = conn.execute("SELECT COUNT(*) FROM person_thresholds").fetchone()[0]
        if thresholds_seeded == 0:
            # init_db uses a raw connection (no row_factory), so rows are
            # plain tuples here -- id is column 0.
            buyers = conn.execute("SELECT id FROM people WHERE role = 'buyer'").fetchall()
            conn.executemany(
                """
                INSERT INTO person_thresholds
                    (person_id, travel_minutes, travel_mode, travel_dest_kind,
                     travel_dest_ref, updated_by)
                VALUES (?, ?, 'drive', 'go_station', NULL, NULL)
                """,
                [(b[0], MIGRATED_GO_THRESHOLD_MIN) for b in buyers],
            )

        # Location thresholds are buyer-only. Remove any rows keyed to a
        # non-buyer that may have been stored before that rule was enforced.
        # Idempotent: a no-op once none exist.
        conn.execute(
            """
            DELETE FROM person_thresholds
            WHERE person_id IN (SELECT id FROM people WHERE role != 'buyer')
            """
        )
        conn.commit()
    finally:
        conn.close()


PERSON_FIELD_MAP = {
    "Mark": ("markRank", "markComments"),
    "Katie": ("katieRank", "katieComments"),
}


def backfill_poc_feedback() -> None:
    """One-time migration: seed listing_feedback from the POC sheet export.

    D14 idempotency guard: skip a person entirely if they already have any
    listing_feedback rows, so repeated server restarts don't duplicate data.
    """
    if not POC_DATA_PATH.exists():
        return
    raw = json.loads(POC_DATA_PATH.read_text())
    rows = raw.get("properties", [])

    conn = get_db()
    try:
        for person_name, (rank_field, comments_field) in PERSON_FIELD_MAP.items():
            person_row = conn.execute(
                "SELECT id FROM people WHERE name = ?", (person_name,)
            ).fetchone()
            if person_row is None:
                continue  # seed data missing this person, nothing to attach to
            person_id = person_row["id"]

            already = conn.execute(
                "SELECT COUNT(*) FROM listing_feedback WHERE person_id = ?",
                (person_id,),
            ).fetchone()[0]
            if already > 0:
                continue  # D14: already backfilled

            inserts = []
            for row in rows:
                listing_id = f"POC-{row.get('row')}"

                rank = intish(row.get(rank_field))
                if rank is not None:
                    inserts.append((person_id, listing_id, "rating", rank, None, None, None))

                comment = (row.get(comments_field) or "").strip()
                if comment:
                    inserts.append((person_id, listing_id, "note", None, None, comment, None))

                if row.get("rejBy") == person_name:
                    reason = (row.get("rejReason") or "").strip() or None
                    inserts.append((person_id, listing_id, "reject", None, "rejected", None, reason))

            if inserts:
                conn.executemany(
                    """
                    INSERT INTO listing_feedback
                        (person_id, listing_id, action_type, rating, status, note, reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    inserts,
                )
        conn.commit()
    finally:
        conn.close()


def load_poc_listing_ids() -> None:
    """D10: build the in-memory set of known POC listing ids at startup, plus
    a per-id (lat, lon) map for place-attachment distance/drive computation."""
    global POC_LISTING_IDS, POC_LISTING_COORDS
    if not POC_DATA_PATH.exists():
        POC_LISTING_IDS = set()
        POC_LISTING_COORDS = {}
        return
    raw = json.loads(POC_DATA_PATH.read_text())
    POC_LISTING_IDS = {f"POC-{row.get('row')}" for row in raw.get("properties", [])}
    coords: dict[str, tuple[float, float]] = {}
    for row in raw.get("properties", []):
        lat, lon = number(row.get("lat")), number(row.get("lon"))
        if lat is not None and lon is not None:
            coords[f"POC-{row.get('row')}"] = (lat, lon)
    POC_LISTING_COORDS = coords


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle (crow-flies) distance in km."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * (EARTH_RADIUS_M / 1000.0) * math.asin(math.sqrt(a))


def mapbox_drive(lat1: float, lon1: float, lat2: float, lon2: float) -> tuple[float | None, float | None]:
    """Street-routed driving time (minutes) and distance (km) from the Mapbox
    Directions API, or (None, None) if no token or the request fails. The same
    method the existing GO drive-time figures use (real road routing, not a
    straight-line estimate). Directions is confirmed available on the in-use
    Mapbox plan (rate limit 300 requests / 60 s)."""
    if not MAPBOX_TOKEN:
        return None, None
    coords = f"{lon1},{lat1};{lon2},{lat2}"
    url = (
        f"https://api.mapbox.com/directions/v5/mapbox/driving/{coords}"
        f"?overview=false&access_token={urllib.parse.quote(MAPBOX_TOKEN, safe='')}"
    )
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        routes = data.get("routes") or []
        if routes:
            return round(routes[0]["duration"] / 60.0, 1), round(routes[0]["distance"] / 1000.0, 2)
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError):
        pass
    return None, None


def listing_coords(listing_id: str) -> tuple[float, float] | None:
    """(lat, lon) for a listing, POC only for now (Repliers sample listings
    are out of the POC area and have no attachments)."""
    return POC_LISTING_COORDS.get(listing_id)


# ─── Highway distance (straight-line, as the crow flies) ────────────────────────
# The 400-series highways whose geometry runs near the POC listings. 413 is
# the existing repo layer (MTO/WSP EA data); the rest are OSM-sourced by
# scripts/build_highways.py. Loaded once at startup into HIGHWAY_LINES;
# nearest_highway_km computes each listing's straight-line distance to the
# nearest point on any of them. Straight-line, deliberately, not travel time
# or road distance: this is a noise/pollution proximity radius. 403, 404,
# 407, and the QEW also run through parts of this area and can be added to
# scripts/build_highways.py and this list later if the family wants them
# factored in.
HIGHWAY_LAYER_FILES = [
    "highway_400.geojson",
    "highway_401.geojson",
    "highway_403.geojson",
    "highway_404.geojson",
    "highway_407.geojson",
    "highway_410.geojson",
    "highway_427.geojson",
    "highway_413.geojson",
    "highway_QEW.geojson",
]
EARTH_RADIUS_M = 6_371_000.0
# label -> list of polylines, each a list of (lat, lon) vertices.
HIGHWAY_LINES: list[tuple[str, list[tuple[float, float]]]] = []


def load_highways() -> None:
    """Load the highway LineStrings once at startup. Point features (413's
    km markers) are skipped; only LineString/MultiLineString geometry feeds
    the distance metric. Missing files are skipped so the server still
    starts if a layer has not been built yet."""
    global HIGHWAY_LINES
    lines: list[tuple[str, list[tuple[float, float]]]] = []
    for filename in HIGHWAY_LAYER_FILES:
        path = STATIC / "layers" / filename
        if not path.exists():
            continue
        # "highway_401.geojson" -> "Hwy 401"; "highway_QEW.geojson" -> "QEW".
        stem = filename.removeprefix("highway_").removesuffix(".geojson")
        label = f"Hwy {stem}" if stem.isdigit() else stem.upper()
        try:
            fc = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        for feature in fc.get("features", []):
            geom = feature.get("geometry") or {}
            gtype = geom.get("type")
            coords = geom.get("coordinates") or []
            parts = [coords] if gtype == "LineString" else (coords if gtype == "MultiLineString" else [])
            for part in parts:
                # GeoJSON order is [lon, lat]; store as (lat, lon).
                pts = [(c[1], c[0]) for c in part if isinstance(c, (list, tuple)) and len(c) >= 2]
                if len(pts) >= 2:
                    lines.append((label, pts))
    HIGHWAY_LINES = lines
    nearest_highway_km.cache_clear()


def _point_to_segment_km(
    plat: float, plon: float,
    alat: float, alon: float,
    blat: float, blon: float,
) -> float:
    """Straight-line distance from point P to segment A-B, in km, using a
    local equirectangular projection centered on P. Accurate to well under
    1% at these distances (tens of km at ~44 deg latitude), which is far
    finer than a noise-radius threshold needs."""
    cos_lat = math.cos(math.radians(plat))
    # Project A and B into meters relative to P (which sits at the origin).
    ax = math.radians(alon - plon) * cos_lat * EARTH_RADIUS_M
    ay = math.radians(alat - plat) * EARTH_RADIUS_M
    bx = math.radians(blon - plon) * cos_lat * EARTH_RADIUS_M
    by = math.radians(blat - plat) * EARTH_RADIUS_M
    dx, dy = bx - ax, by - ay
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq == 0.0:
        closest_x, closest_y = ax, ay
    else:
        # Projection of the origin onto the segment, clamped to [0, 1].
        t = -(ax * dx + ay * dy) / seg_len_sq
        t = max(0.0, min(1.0, t))
        closest_x, closest_y = ax + t * dx, ay + t * dy
    return math.hypot(closest_x, closest_y) / 1000.0


@functools.lru_cache(maxsize=None)
def nearest_highway_km(lat: float | None, lon: float | None) -> tuple[float | None, str | None]:
    """Distance in km (rounded to 2 places) from (lat, lon) to the nearest
    point on any loaded highway, plus that highway's label. Returns
    (None, None) when coordinates are missing or no highway geometry is
    loaded (e.g. in tests, or before load_highways runs)."""
    if lat is None or lon is None or not HIGHWAY_LINES:
        return None, None
    best_km: float | None = None
    best_label: str | None = None
    for label, pts in HIGHWAY_LINES:
        for i in range(len(pts) - 1):
            (alat, alon), (blat, blon) = pts[i], pts[i + 1]
            km = _point_to_segment_km(lat, lon, alat, alon, blat, blon)
            if best_km is None or km < best_km:
                best_km = km
                best_label = label
    return (round(best_km, 2), best_label) if best_km is not None else (None, None)


def require_auth(handler: BaseHTTPRequestHandler) -> bool:
    """D3/D11: shared-secret deterrent on person-data endpoints.

    Not real access control. The token must live in browser JS to be sent,
    so it is visible in dev tools. This only deters a random person who
    finds the public tunnel URL from casually reading or writing feedback
    data. Fails closed: an unset APP_AUTH_TOKEN rejects every request
    rather than silently allowing everything through.
    """
    if not APP_AUTH_TOKEN:
        return False
    return handler.headers.get("X-App-Token") == APP_AUTH_TOKEN


def validate_listing_id(listing_id: str) -> bool:
    """D4/D10: POC ids are checked against the known set; Repliers ids
    (no canonical id list this server owns) are only format-checked."""
    if not listing_id:
        return False
    if listing_id.startswith("POC-"):
        return listing_id in POC_LISTING_IDS
    return True


def person_exists(conn: sqlite3.Connection, person_id: Any) -> bool:
    # bool is a subclass of int, so True would otherwise be accepted as
    # person id 1; reject it explicitly.
    if not isinstance(person_id, int) or isinstance(person_id, bool):
        return False
    return conn.execute("SELECT 1 FROM people WHERE id = ?", (person_id,)).fetchone() is not None


def latest_feedback_for_listings(
    conn: sqlite3.Connection, listing_ids: list[str]
) -> dict[str, list[dict[str, Any]]]:
    """Latest-state feedback per person per listing (D2).

    Every known person gets an entry per requested listing, with nulls if
    they have no feedback yet (D6's batch shape), so the frontend gets an
    explicit "no rating yet" state without a separate lookup against
    GET /api/people. rating/note/reject/research_request are each
    independently the latest by action_type; updated_at is the max
    created_at across all of them for that person on that listing.

    "status" reflects reject state only (null or "rejected").
    "research_requested" is a separate boolean: a person can reject a
    listing and still want research on it, both true at once, so this is
    never folded into "status".
    """
    if not listing_ids:
        return {}

    people = conn.execute("SELECT id, name, role FROM people ORDER BY id").fetchall()

    entries: dict[tuple[str, int], dict[str, Any]] = {}
    for listing_id in listing_ids:
        for person in people:
            entries[(listing_id, person["id"])] = {
                "person_id": person["id"],
                "person_name": person["name"],
                "role": person["role"],
                "rating": None,
                "status": None,
                "note": None,
                "note_created_at": None,
                "note_history": [],
                "reason": None,
                "research_note": None,
                "research_requested": False,
                "updated_at": None,
            }

    placeholders = ",".join("?" for _ in listing_ids)
    latest_rows = conn.execute(
        f"""
        SELECT lf.person_id, lf.listing_id, lf.action_type, lf.rating,
               lf.status, lf.note, lf.reason, lf.created_at
        FROM listing_feedback lf
        JOIN (
            SELECT person_id, listing_id, action_type, MAX(id) AS max_id
            FROM listing_feedback
            WHERE listing_id IN ({placeholders})
            GROUP BY person_id, listing_id, action_type
        ) latest ON lf.id = latest.max_id
        """,
        listing_ids,
    ).fetchall()

    for row in latest_rows:
        entry = entries.get((row["listing_id"], row["person_id"]))
        if entry is None:
            continue
        if row["action_type"] == "rating":
            entry["rating"] = row["rating"]
        elif row["action_type"] == "note":
            entry["note"] = row["note"]
            entry["note_created_at"] = row["created_at"]
        elif row["action_type"] == "reject":
            entry["status"] = row["status"]
            entry["reason"] = row["reason"]
        elif row["action_type"] == "research_request":
            # Independent of reject/status: a person can reject a listing
            # and still want research on it, or vice versa. Both are real,
            # simultaneously true facts about one person's opinion, not a
            # single mutually-exclusive state, so this is its own field
            # rather than another value crammed into "status".
            entry["research_requested"] = True
            entry["research_note"] = row["note"]
        if entry["updated_at"] is None or row["created_at"] > entry["updated_at"]:
            entry["updated_at"] = row["created_at"]

    # T11: full note history, not just the latest -- the write path has
    # always been append-only (every "note" action_type row is a distinct
    # entry, never an update), so a real history was there for free the
    # moment more than one note per person per listing existed. Newest
    # first, since that's what a reader wants to see.
    note_rows = conn.execute(
        f"""
        SELECT person_id, listing_id, note, created_at
        FROM listing_feedback
        WHERE action_type = 'note' AND listing_id IN ({placeholders})
        ORDER BY id DESC
        """,
        listing_ids,
    ).fetchall()
    for row in note_rows:
        entry = entries.get((row["listing_id"], row["person_id"]))
        if entry is not None:
            entry["note_history"].append({"note": row["note"], "created_at": row["created_at"]})

    result: dict[str, list[dict[str, Any]]] = {listing_id: [] for listing_id in listing_ids}
    for (listing_id, _person_id), entry in entries.items():
        result[listing_id].append(entry)
    return result


def handle_feedback_post(body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """D4/D10: validate person_id/listing_id explicitly, 400 on a miss."""
    person_id = body.get("person_id")
    listing_id = body.get("listing_id")
    action_type = body.get("action_type")

    if not isinstance(listing_id, str) or not listing_id:
        return {"error": "invalid_request", "detail": "listing_id is required"}, 400
    if action_type not in ALLOWED_ACTION_TYPES:
        return {
            "error": "invalid_request",
            "detail": f"action_type must be one of {sorted(ALLOWED_ACTION_TYPES)}",
        }, 400

    conn = get_db()
    try:
        if not person_exists(conn, person_id):
            return {"error": "unknown_person", "detail": f"person_id {person_id!r} not found"}, 400
        if not validate_listing_id(listing_id):
            return {"error": "unknown_listing", "detail": f"listing_id {listing_id!r} not found"}, 400

        rating = body.get("rating")
        status = body.get("status")
        note = body.get("note")
        reason = body.get("reason")
        if action_type == "reject" and status is None:
            status = "rejected"

        cursor = conn.execute(
            """
            INSERT INTO listing_feedback
                (person_id, listing_id, action_type, rating, status, note, reason)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (person_id, listing_id, action_type, rating, status, note, reason),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, created_at FROM listing_feedback WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
        return {"ok": True, "id": row["id"], "created_at": row["created_at"]}, 200
    finally:
        conn.close()


def handle_poi_post(body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """T14: POI pins are shared across the whole buyer group, same as
    listing feedback -- created_by just records who added it, it is not a
    privacy boundary."""
    person_id = body.get("person_id")
    poi_type = body.get("type")
    lat = body.get("lat")
    lng = body.get("lng")
    label = body.get("label")

    if poi_type not in ALLOWED_POI_TYPES:
        return {
            "error": "invalid_request",
            "detail": f"type must be one of {sorted(ALLOWED_POI_TYPES)}",
        }, 400
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return {"error": "invalid_request", "detail": "lat and lng are required numbers"}, 400
    if label is not None and not isinstance(label, str):
        return {"error": "invalid_request", "detail": "label must be a string if present"}, 400

    conn = get_db()
    try:
        if not person_exists(conn, person_id):
            return {"error": "unknown_person", "detail": f"person_id {person_id!r} not found"}, 400

        cursor = conn.execute(
            "INSERT INTO poi_pins (type, label, lat, lng, created_by) VALUES (?, ?, ?, ?, ?)",
            (poi_type, label, float(lat), float(lng), person_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, created_at FROM poi_pins WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
        return {"ok": True, "id": row["id"], "created_at": row["created_at"]}, 200
    finally:
        conn.close()


_NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"


def attachments_for_listings(
    conn: sqlite3.Connection, listing_ids: list[str]
) -> dict[str, list[dict[str, Any]]]:
    """Place attachments per listing, shared across the whole group. Joins the
    POI pin (label/type/coords) and the created_by name. Every requested
    listing gets a (possibly empty) list."""
    result: dict[str, list[dict[str, Any]]] = {lid: [] for lid in listing_ids}
    if not listing_ids:
        return result
    placeholders = ",".join("?" for _ in listing_ids)
    rows = conn.execute(
        f"""
        SELECT a.id, a.listing_id, a.poi_id, a.straight_km, a.drive_minutes,
               a.drive_km, a.computed_at, a.created_by, cb.name AS created_by_name,
               a.created_at, p.type AS poi_type, p.label AS poi_label,
               p.lat AS poi_lat, p.lng AS poi_lng
        FROM listing_place_attachments a
        JOIN poi_pins p ON p.id = a.poi_id
        JOIN people cb ON cb.id = a.created_by
        WHERE a.listing_id IN ({placeholders})
        ORDER BY a.id
        """,
        listing_ids,
    ).fetchall()
    for row in rows:
        result[row["listing_id"]].append(dict(row))
    return result


def handle_place_attachment_post(body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Attach a place to a specific listing. The place is either an existing
    POI pin (poi_id) or a new one (new_place: type/label/lat/lng, created here
    so places stay one source of truth). Distance is crow-flies; drive time is
    street-routed via Mapbox and cached on the row. Shared across the group;
    person_id is the buyer doing the attaching (attribution). NOT gated on any
    star rating -- that is how the family uses it, not a software rule."""
    listing_id = body.get("listing_id")
    person_id = body.get("person_id")
    poi_id = body.get("poi_id")
    new_place = body.get("new_place")

    if not isinstance(listing_id, str) or not listing_id:
        return {"error": "invalid_request", "detail": "listing_id is required"}, 400

    conn = get_db()
    try:
        if not person_exists(conn, person_id):
            return {"error": "unknown_person", "detail": f"person_id {person_id!r} not found"}, 400
        if not validate_listing_id(listing_id):
            return {"error": "unknown_listing", "detail": f"listing_id {listing_id!r} not found"}, 400
        coords = listing_coords(listing_id)
        if coords is None:
            return {"error": "no_listing_coords",
                    "detail": "this listing has no coordinates to measure from"}, 400

        # Resolve the POI: create from new_place, or validate an existing id.
        if new_place is not None:
            ptype = new_place.get("type")
            label = new_place.get("label")
            lat = new_place.get("lat")
            lng = new_place.get("lng")
            if ptype not in ALLOWED_POI_TYPES:
                return {"error": "invalid_request",
                        "detail": f"new_place.type must be one of {sorted(ALLOWED_POI_TYPES)}"}, 400
            if not isinstance(lat, (int, float)) or isinstance(lat, bool) \
                    or not isinstance(lng, (int, float)) or isinstance(lng, bool):
                return {"error": "invalid_request", "detail": "new_place.lat and lng are required numbers"}, 400
            if label is not None and not isinstance(label, str):
                return {"error": "invalid_request", "detail": "new_place.label must be a string if present"}, 400
            cursor = conn.execute(
                "INSERT INTO poi_pins (type, label, lat, lng, created_by) VALUES (?, ?, ?, ?, ?)",
                (ptype, label, float(lat), float(lng), person_id),
            )
            poi_id = cursor.lastrowid
            conn.commit()
        else:
            if not isinstance(poi_id, int) or isinstance(poi_id, bool):
                return {"error": "invalid_request", "detail": "poi_id or new_place is required"}, 400
            if conn.execute("SELECT 1 FROM poi_pins WHERE id = ?", (poi_id,)).fetchone() is None:
                return {"error": "unknown_poi", "detail": f"poi_id {poi_id!r} not found"}, 400

        poi = conn.execute("SELECT lat, lng FROM poi_pins WHERE id = ?", (poi_id,)).fetchone()
        llat, llon = coords
        straight_km = round(haversine_km(llat, llon, poi["lat"], poi["lng"]), 2)
        # Directions call made between transactions (POI already committed), so
        # no write transaction is held open during the ~1s network round-trip.
        drive_minutes, drive_km = mapbox_drive(llat, llon, poi["lat"], poi["lng"])
        computed_sql = _NOW_SQL if drive_minutes is not None else "NULL"

        try:
            cursor = conn.execute(
                f"""
                INSERT INTO listing_place_attachments
                    (listing_id, poi_id, straight_km, drive_minutes, drive_km, computed_at, created_by)
                VALUES (?, ?, ?, ?, ?, {computed_sql}, ?)
                """,
                (listing_id, poi_id, straight_km, drive_minutes, drive_km, person_id),
            )
        except sqlite3.IntegrityError:
            return {"error": "already_attached",
                    "detail": "this place is already attached to this listing"}, 400
        conn.commit()
        attachment = next(
            (a for a in attachments_for_listings(conn, [listing_id])[listing_id] if a["id"] == cursor.lastrowid),
            None,
        )
        return {"ok": True, "attachment": attachment}, 200
    finally:
        conn.close()


def handle_place_attachment_recompute(body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Recompute an attachment's straight-line distance and street-routed drive
    time (the recompute affordance). Distances/drive are otherwise cached from
    when the place was attached."""
    att_id = body.get("id")
    if not isinstance(att_id, int) or isinstance(att_id, bool):
        return {"error": "invalid_request", "detail": "id is required"}, 400
    conn = get_db()
    try:
        row = conn.execute(
            """
            SELECT a.listing_id, p.lat, p.lng
            FROM listing_place_attachments a JOIN poi_pins p ON p.id = a.poi_id
            WHERE a.id = ?
            """,
            (att_id,),
        ).fetchone()
        if row is None:
            return {"error": "unknown_attachment", "detail": f"attachment {att_id!r} not found"}, 400
        coords = listing_coords(row["listing_id"])
        if coords is None:
            return {"error": "no_listing_coords", "detail": "this listing has no coordinates"}, 400
        llat, llon = coords
        straight_km = round(haversine_km(llat, llon, row["lat"], row["lng"]), 2)
        drive_minutes, drive_km = mapbox_drive(llat, llon, row["lat"], row["lng"])
        computed_sql = _NOW_SQL if drive_minutes is not None else "NULL"
        conn.execute(
            f"""
            UPDATE listing_place_attachments
            SET straight_km = ?, drive_minutes = ?, drive_km = ?, computed_at = {computed_sql}
            WHERE id = ?
            """,
            (straight_km, drive_minutes, drive_km, att_id),
        )
        conn.commit()
        attachment = next(
            (a for a in attachments_for_listings(conn, [row["listing_id"]])[row["listing_id"]] if a["id"] == att_id),
            None,
        )
        return {"ok": True, "attachment": attachment}, 200
    finally:
        conn.close()


def handle_place_attachment_delete(body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Remove a place attachment. Leaves the underlying POI pin in place (it is
    shared, one source of truth, and may be attached elsewhere)."""
    att_id = body.get("id")
    if not isinstance(att_id, int) or isinstance(att_id, bool):
        return {"error": "invalid_request", "detail": "id is required"}, 400
    conn = get_db()
    try:
        conn.execute("DELETE FROM listing_place_attachments WHERE id = ?", (att_id,))
        conn.commit()
        return {"ok": True, "id": att_id}, 200
    finally:
        conn.close()


def handle_household_settings_post(body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """One shared value per key across the whole buyer group, not per
    person. updated_by/updated_at track who last changed it and when, the
    same attribution shape used elsewhere, but there is only ever one
    current value per key, not a per-person history list."""
    key = body.get("key")
    value = body.get("value")
    person_id = body.get("person_id")

    if key not in HOUSEHOLD_SETTING_DEFAULTS:
        return {
            "error": "invalid_request",
            "detail": f"key must be one of {sorted(HOUSEHOLD_SETTING_DEFAULTS)}",
        }, 400
    if not isinstance(value, str):
        return {"error": "invalid_request", "detail": "value must be a string"}, 400

    conn = get_db()
    try:
        if not person_exists(conn, person_id):
            return {"error": "unknown_person", "detail": f"person_id {person_id!r} not found"}, 400

        conn.execute(
            """
            INSERT INTO household_settings (key, value, updated_by, updated_at)
            VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
            """,
            (key, value, person_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT updated_at FROM household_settings WHERE key = ?", (key,)
        ).fetchone()
        return {"ok": True, "key": key, "value": value, "updated_at": row["updated_at"]}, 200
    finally:
        conn.close()


def potential_prices_for_listings(
    conn: sqlite3.Connection, listing_ids: list[str]
) -> dict[str, dict[str, Any]]:
    """One shared price per listing, not per person. Listings with no entry
    are simply absent from the result, not present with a null price, since
    "never entered" and "entered as zero" are different things."""
    if not listing_ids:
        return {}
    placeholders = ",".join("?" for _ in listing_ids)
    rows = conn.execute(
        f"""
        SELECT p.listing_id, p.price, p.updated_by, pe.name AS updated_by_name, p.updated_at
        FROM potential_purchase_prices p
        JOIN people pe ON pe.id = p.updated_by
        WHERE p.listing_id IN ({placeholders})
        """,
        listing_ids,
    ).fetchall()
    return {row["listing_id"]: dict(row) for row in rows}


def handle_potential_price_post(body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Upserts the one shared price for a listing. Not a per-person value,
    not a history list, one current figure the whole group sees, the same
    upsert-by-primary-key shape as household_settings."""
    listing_id = body.get("listing_id")
    price = body.get("price")
    person_id = body.get("person_id")

    if not isinstance(listing_id, str) or not listing_id:
        return {"error": "invalid_request", "detail": "listing_id is required"}, 400
    if not isinstance(price, (int, float)) or isinstance(price, bool) or price <= 0:
        return {"error": "invalid_request", "detail": "price must be a positive number"}, 400

    conn = get_db()
    try:
        if not person_exists(conn, person_id):
            return {"error": "unknown_person", "detail": f"person_id {person_id!r} not found"}, 400
        if not validate_listing_id(listing_id):
            return {"error": "unknown_listing", "detail": f"listing_id {listing_id!r} not found"}, 400

        conn.execute(
            """
            INSERT INTO potential_purchase_prices (listing_id, price, updated_by, updated_at)
            VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            ON CONFLICT(listing_id) DO UPDATE SET
                price = excluded.price,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
            """,
            (listing_id, float(price), person_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT updated_at FROM potential_purchase_prices WHERE listing_id = ?", (listing_id,)
        ).fetchone()
        return {"ok": True, "listing_id": listing_id, "price": float(price), "updated_at": row["updated_at"]}, 200
    finally:
        conn.close()


def handle_potential_price_delete(body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Clears a listing's potential purchase price back to unset by
    deleting its row entirely, not by writing zero or an empty string.
    "Never entered" and "entered as zero" must stay distinguishable (see
    potential_prices_for_listings), and a zero/empty price must never
    reach compute_mortgage_breakdown, so removing the row is the only
    correct representation of "cleared"."""
    listing_id = body.get("listing_id")
    if not isinstance(listing_id, str) or not listing_id:
        return {"error": "invalid_request", "detail": "listing_id is required"}, 400

    conn = get_db()
    try:
        if not validate_listing_id(listing_id):
            return {"error": "unknown_listing", "detail": f"listing_id {listing_id!r} not found"}, 400
        conn.execute("DELETE FROM potential_purchase_prices WHERE listing_id = ?", (listing_id,))
        conn.commit()
        return {"ok": True, "listing_id": listing_id}, 200
    finally:
        conn.close()


def person_thresholds_all(conn: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    """Every BUYER's location thresholds, keyed by person id (as a string, so
    it survives JSON round-tripping as an object key). Travel time and highway
    distance are buyer preferences only, so realtors are excluded entirely:
    they never appear in the roster, are never seeded, and are not storable
    (see handle_person_thresholds_post). Every buyer gets an entry even with
    no row yet -- all threshold fields null. updated_by_name resolves the
    attribution to a display name; it and updated_at are null for a buyer
    whose thresholds are still all unset or were only ever the migration
    default (updated_by NULL)."""
    rows = conn.execute(
        """
        SELECT pe.id AS person_id, pe.name AS person_name, pe.role AS role,
               t.travel_minutes, t.travel_total_minutes, t.travel_mode,
               t.travel_dest_kind, t.travel_dest_ref,
               t.updated_by, up.name AS updated_by_name, t.updated_at
        FROM people pe
        LEFT JOIN person_thresholds t ON t.person_id = pe.id
        LEFT JOIN people up ON up.id = t.updated_by
        WHERE pe.role = 'buyer'
        ORDER BY pe.id
        """
    ).fetchall()
    return {str(row["person_id"]): dict(row) for row in rows}


def handle_person_thresholds_post(body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Upsert one person's complete threshold record. person_id is the
    target (whose thresholds), actor_id is who is making the change (anyone
    in the household may edit anyone's), recorded as updated_by. This is a
    full replace of that person's row: every threshold field the client
    omits is stored as NULL (unset), so the client always sends the whole
    set. Nulls are how a field is cleared back to unset."""
    person_id = body.get("person_id")
    actor_id = body.get("actor_id")

    # Python's json module parses NaN/Infinity by default, so guard math.isfinite
    # explicitly: int(round(inf)) raises (500), and infinity would otherwise be
    # stored and echoed back. bool is a subclass of int, rejected too.
    def pos_int_or_none(value: Any, label: str) -> tuple[int | None, str | None]:
        if value is None:
            return None, None
        if isinstance(value, bool) or not isinstance(value, (int, float)) \
                or not math.isfinite(value) or value <= 0:
            return None, f"{label} must be a positive finite number or null"
        return int(round(value)), None

    travel_minutes, err = pos_int_or_none(body.get("travel_minutes"), "travel_minutes")
    if err:
        return {"error": "invalid_request", "detail": err}, 400
    travel_total_minutes, err = pos_int_or_none(body.get("travel_total_minutes"), "travel_total_minutes")
    if err:
        return {"error": "invalid_request", "detail": err}, 400

    travel_mode = body.get("travel_mode")
    if travel_mode is not None and travel_mode not in ALLOWED_TRAVEL_MODES:
        return {"error": "invalid_request",
                "detail": f"travel_mode must be one of {sorted(ALLOWED_TRAVEL_MODES)} or null"}, 400
    travel_dest_kind = body.get("travel_dest_kind")
    if travel_dest_kind is not None and travel_dest_kind not in ALLOWED_TRAVEL_DEST_KINDS:
        return {"error": "invalid_request",
                "detail": f"travel_dest_kind must be one of {sorted(ALLOWED_TRAVEL_DEST_KINDS)} or null"}, 400
    travel_dest_ref = body.get("travel_dest_ref")
    if travel_dest_ref is not None and not isinstance(travel_dest_ref, str):
        return {"error": "invalid_request", "detail": "travel_dest_ref must be a string or null"}, 400

    conn = get_db()
    try:
        if not person_exists(conn, person_id):
            return {"error": "unknown_person", "detail": f"person_id {person_id!r} not found"}, 400
        if not person_exists(conn, actor_id):
            return {"error": "unknown_person", "detail": f"actor_id {actor_id!r} not found"}, 400
        # Location thresholds are buyer preferences only; a realtor is never a
        # valid target. The actor (who makes the edit) may be anyone.
        target_role = conn.execute("SELECT role FROM people WHERE id = ?", (person_id,)).fetchone()
        if target_role is None or target_role["role"] != "buyer":
            return {"error": "not_a_buyer",
                    "detail": "location thresholds can only be set for buyers"}, 400

        conn.execute(
            """
            INSERT INTO person_thresholds
                (person_id, travel_minutes, travel_total_minutes, travel_mode,
                 travel_dest_kind, travel_dest_ref, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            ON CONFLICT(person_id) DO UPDATE SET
                travel_minutes = excluded.travel_minutes,
                travel_total_minutes = excluded.travel_total_minutes,
                travel_mode = excluded.travel_mode,
                travel_dest_kind = excluded.travel_dest_kind,
                travel_dest_ref = excluded.travel_dest_ref,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
            """,
            (person_id, travel_minutes, travel_total_minutes, travel_mode,
             travel_dest_kind, travel_dest_ref, actor_id),
        )
        conn.commit()
        return {"ok": True, "threshold": person_thresholds_all(conn).get(str(person_id))}, 200
    finally:
        conn.close()


def number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    return float(match.group(0)) if match else None


def intish(value: Any) -> int | None:
    n = number(value)
    return int(round(n)) if n is not None else None


def address_line(address: dict[str, Any]) -> str:
    parts = [
        address.get("streetNumber"),
        address.get("streetDirectionPrefix"),
        address.get("streetName"),
        address.get("streetSuffix"),
        ("#" + str(address.get("unitNumber"))) if address.get("unitNumber") else None,
    ]
    street = " ".join(str(p).strip() for p in parts if p)
    city_bits = [address.get("city"), address.get("state"), address.get("zip")]
    city = ", ".join(str(p).strip() for p in city_bits if p)
    if street and city:
        return f"{street}, {city}"
    return street or city or "Address hidden"


def image_url(images: list[Any]) -> str | None:
    if not images:
        return None
    first = str(images[0])
    if first.startswith("http"):
        return first
    return urllib.parse.urljoin(CDN_BASE, first)


def text_summary(value: Any) -> str | None:
    if not value:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = [text_summary(v) for v in value]
        return "; ".join(p for p in parts if p) or None
    if isinstance(value, dict):
        for key in ("text", "description", "summary", "caption"):
            if isinstance(value.get(key), str):
                return value[key]
        strings = [str(v) for v in value.values() if isinstance(v, str)]
        return "; ".join(strings[:3]) or None
    return str(value)


def fit_score(listing: dict[str, Any]) -> dict[str, Any]:
    """Prototype scoring.

    The free Repliers account only exposes sample data, mostly US listings.
    Ontario zone and GO commute checks stay disabled until a live PropTx/ITSO
    feed is added. This score proves the Repliers data path and keeps the
    House Hunter idea visible without pretending sample listings are Ontario.
    """
    details = listing.get("details") or {}
    lot = listing.get("lot") or {}
    price = number(listing.get("listPrice"))
    beds = intish(details.get("numBedrooms")) or 0
    baths = number(details.get("numBathrooms")) or 0
    sqft = number(details.get("sqft")) or 0
    acres = number(lot.get("acres")) or 0
    dom = intish(listing.get("daysOnMarket") or listing.get("simpleDaysOnMarket")) or 0

    checks = [
        ("4+ beds", beds >= 4),
        ("2+ baths", baths >= 2),
        ("1,800+ sqft", sqft >= 1800),
        ("Under $1M", price is not None and price <= 1_000_000),
        ("0.15+ acre lot", acres >= 0.15),
        ("DOM under 90", dom > 0 and dom <= 90),
    ]
    met = [label for label, ok in checks if ok]
    failed = [label for label, ok in checks if not ok]
    return {
        "met": len(met),
        "total": len(checks),
        "label": f"{len(met)}/{len(checks)}",
        "metLabels": met,
        "failedLabels": failed,
        "note": "Prototype score on Repliers sample data. GO commute and Ontario zone activate on live Ontario feed.",
    }


def is_condo_type(*values: Any) -> bool:
    """True if any of propertyType/style names the listing a condo unit."""
    for value in values:
        if value and "condo" in str(value).lower():
            return True
    return False


def normalize(listing: dict[str, Any]) -> dict[str, Any]:
    details = listing.get("details") or {}
    lot = listing.get("lot") or {}
    addr = listing.get("address") or {}
    coords = listing.get("map") or {}
    agents = listing.get("agents") or []
    first_agent = agents[0] if agents else {}
    brokerage = (first_agent.get("brokerage") or {}).get("name") or (listing.get("office") or {}).get("brokerageName")
    img = image_url(listing.get("images") or [])
    lat = number(coords.get("latitude"))
    lng = number(coords.get("longitude"))

    return {
        "mls": listing.get("mlsNumber"),
        "address": address_line(addr),
        "city": addr.get("city"),
        "state": addr.get("state"),
        "price": intish(listing.get("listPrice")),
        "originalPrice": intish(listing.get("originalPrice")),
        "soldPrice": intish(listing.get("soldPrice")),
        "beds": intish(details.get("numBedrooms")),
        "bedsPlus": intish(details.get("numBedroomsPlus")),
        "baths": number(details.get("numBathrooms")),
        "sqft": intish(details.get("sqft")),
        "acres": number(lot.get("acres")),
        "lotSqft": intish(lot.get("squareFeet")),
        "propertyType": details.get("propertyType"),
        "style": details.get("style"),
        "isCondo": is_condo_type(details.get("propertyType"), details.get("style")),
        "condoFeeNum": number(details.get("HOAFee")),
        "heating": details.get("heating"),
        "parking": intish(details.get("numParkingSpaces")),
        "garage": intish(details.get("numGarageSpaces")),
        "dom": intish(listing.get("daysOnMarket") or listing.get("simpleDaysOnMarket")),
        "status": listing.get("standardStatus") or listing.get("lastStatus") or listing.get("status"),
        "listDate": listing.get("listDate"),
        "lat": lat,
        "lng": lng,
        "image": img,
        "imageCount": listing.get("photoCount") or len(listing.get("images") or []),
        "agent": first_agent.get("name"),
        "brokerage": brokerage,
        "estimate": (listing.get("estimate") or {}).get("value"),
        "imageSummary": text_summary((listing.get("imageInsights") or {}).get("summary")),
        "rawClass": listing.get("class"),
        "fit": fit_score(listing),
    }


def fetch_repliers(params: dict[str, str]) -> dict[str, Any]:
    if not API_KEY:
        raise RuntimeError("REPLIERS_API_KEY is missing. Copy .env.example to .env and add the key.")

    page = max(1, int(params.get("page", "1") or "1"))
    per_page = min(100, max(1, int(params.get("resultsPerPage", "60") or "60")))
    query = {
        "pageNum": str(page),
        "resultsPerPage": str(per_page),
    }
    # Repliers supports server-side map clustering (cluster=true, plus
    # clusterPrecision/clusterLimit) for showing density instead of thousands
    # of individual pins. Confirmed live: the flat "listings" array is
    # unaffected by cluster mode -- clusters show up separately under
    # aggregates.map.clusters, so the rest of this pipeline (normalize,
    # local filters) doesn't need to change either way.
    if (params.get("cluster") or "").lower() in ("1", "true", "yes"):
        query["cluster"] = "true"
        query["clusterPrecision"] = "10"
        query["clusterLimit"] = "50"
    # Keep API-side filtering conservative until live Ontario data is available.
    url = f"{BASE_URL}/listings?{urllib.parse.urlencode(query)}"
    req = urllib.request.Request(url, headers={"REPLIERS-API-KEY": API_KEY})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def passes_local_filters(item: dict[str, Any], params: dict[str, str]) -> bool:
    def gnum(name: str) -> float | None:
        return number(params.get(name))

    min_price, max_price = gnum("minPrice"), gnum("maxPrice")
    min_beds, max_beds = gnum("minBeds"), gnum("maxBeds")
    min_baths, max_baths = gnum("minBaths"), gnum("maxBaths")
    min_fit = gnum("minFit")
    q = (params.get("q") or "").strip().lower()

    if min_price is not None and (item.get("price") is None or item["price"] < min_price):
        return False
    if max_price is not None and (item.get("price") is None or item["price"] > max_price):
        return False
    # bedsNum is the always-numeric field (POC's "beds" can be a composite
    # display string like "3+1"); Repliers items have no bedsNum key at
    # all, so this falls back to their already-numeric "beds".
    beds_val = item.get("bedsNum") if item.get("bedsNum") is not None else item.get("beds")
    if min_beds is not None and (beds_val is None or beds_val < min_beds):
        return False
    if max_beds is not None and (beds_val is None or beds_val > max_beds):
        return False
    if min_baths is not None and (item.get("baths") is None or item["baths"] < min_baths):
        return False
    if max_baths is not None and (item.get("baths") is None or item["baths"] > max_baths):
        return False
    if min_fit is not None and item["fit"]["met"] < min_fit:
        return False
    if q:
        hay = " ".join(str(item.get(k) or "") for k in ["address", "city", "state", "propertyType", "style", "brokerage"]).lower()
        if q not in hay:
            return False
    return True


def poc_fit(value: Any) -> dict[str, Any]:
    text = str(value or "")
    match = re.search(r"(\d+)\s*/\s*(\d+)", text)
    met = int(match.group(1)) if match else 0
    total = int(match.group(2)) if match else 8
    failed = []
    if "fails:" in text:
        failed = [x.strip() for x in text.split("fails:", 1)[1].split(";") if x.strip()]
    return {
        "met": met,
        "total": total,
        "label": f"{met}/{total}",
        "metLabels": [],
        "failedLabels": failed,
        "note": "House Hunter POC score from the existing Google Sheet.",
    }


def normalize_poc(p: dict[str, Any]) -> dict[str, Any]:
    fit = poc_fit(p.get("fit"))
    go_station = p.get("go") or ""
    go_min = number(p.get("goMin") or p.get("goMinNum"))
    go_train = number(p.get("goTrain"))
    go_total = number(p.get("goTotal"))
    lat = number(p.get("lat"))
    lon = number(p.get("lon"))
    highway_km, nearest_highway = nearest_highway_km(lat, lon)
    return {
        "mls": f"POC-{p.get('row')}",
        "address": p.get("address") or "Address hidden",
        "city": "",
        "state": "ON",
        "price": intish(p.get("priceNum") or p.get("price")),
        "originalPrice": None,
        "soldPrice": None,
        # "beds" stays the raw display value ("3+1" means 3 main + 1
        # basement bedroom, meaningful to a buyer). "bedsNum" is the
        # always-numeric field range filters compare against, since
        # "beds" isn't reliably numeric (49 of 105 rows are composite
        # strings like "3+1", not plain integers).
        "beds": p.get("beds") or p.get("bedsNum"),
        "bedsNum": intish(p.get("bedsNum") or p.get("beds")),
        "baths": number(p.get("bathsNum") or p.get("baths")),
        "sqft": intish(p.get("sqftNum") or p.get("sqft")),
        "acres": number(p.get("acresNum") or p.get("acres")),
        "lotSqft": None,
        "lot": p.get("lot") or "",
        "frontageNum": number(p.get("frontageNum")),
        "depthNum": number(p.get("depthNum")),
        "tier": p.get("tier") or "",
        "propertyType": "House Hunter POC",
        # The POC sheet has no property-type/condo column today. These stay
        # None/False for every real row until the family's data adds one;
        # kept as real (nullable) fields, not hardcoded, so a future column
        # named exactly this way surfaces with no further code change.
        "isCondo": is_condo_type(p.get("propertyType")) or bool(p.get("isCondo")),
        "condoFeeNum": number(p.get("condoFeeNum")),
        "heating": "",
        "parking": None,
        "garage": None,
        "dom": intish(p.get("goTotal")),
        "status": p.get("status") or "POC",
        "listDate": "",
        "lat": lat,
        "lng": lon,
        # Straight-line (crow-flies) distance to the nearest 400-series
        # highway, a noise/pollution proximity radius, not a drive time.
        # Whether it meets a person's limit is decided client-side against
        # the active actor's highway_km threshold.
        "highwayKm": highway_km,
        "nearestHighway": nearest_highway,
        "image": p.get("image") or None,
        "imageCount": None,
        # Top-level POC fields the card reads directly
        "goStation": go_station,
        "goMin": go_min,
        "goTrain": go_train,
        "goTotal": go_total,
        "markRank": p.get("markRank") or None,
        "katieRank": p.get("katieRank") or None,
        "markComments": p.get("markComments") or "",
        "katieComments": p.get("katieComments") or "",
        "realtorComments": p.get("realtorComments") or "",
        "features": p.get("features") or "",
        "pitNum": number(p.get("pitNum")),
        "pit": p.get("pit") or "",
        "dueClosing": p.get("dueClosing") or "",
        "dueNum": number(p.get("dueNum")),
        "agent": p.get("rejBy") or "",
        "brokerage": go_station,
        "estimate": None,
        "imageSummary": None,
        "rawClass": "poc",
        "fit": fit,
        "poc": {
            "row": p.get("row"),
            "link": p.get("link"),
            "doc": p.get("doc"),
            "go": go_station,
            "goMin": go_min,
            "goTrain": go_train,
            "goTotal": go_total,
            "markRank": p.get("markRank"),
            "katieRank": p.get("katieRank"),
            "markComments": p.get("markComments"),
            "katieComments": p.get("katieComments"),
            "realtorComments": p.get("realtorComments"),
            "dueClosing": p.get("dueClosing"),
            "pit": p.get("pit"),
            "pitNum": number(p.get("pitNum")),
            "features": p.get("features"),
        },
    }


# CMHC Mortgage Loan Insurance premium tiers, Homeowner Loans (owner-
# occupied, 1-4 units), fetched directly from CMHC's own published table,
# not a secondary source, since blog aggregators disagreed with each
# other on the exact tier percentages:
# https://www.cmhc-schl.gc.ca/professionals/project-funding-and-mortgage-financing/mortgage-loan-insurance/mortgage-loan-insurance-homeownership-programs/premium-information-for-homeowner-and-small-rental-loans
# (fetched 2026-07-06). Each tuple is (ltv upper bound inclusive, premium
# pct of the insured loan amount). The "non-traditional down payment"
# 4.50% variant for the 90.01-95% tier is not modeled here, since this
# app has no field distinguishing a borrowed down payment source from a
# traditional one.
CMHC_PREMIUM_TIERS: list[tuple[float, float]] = [
    (0.65, 0.60),
    (0.75, 1.70),
    (0.80, 2.40),
    (0.85, 2.80),
    (0.90, 3.10),
    (0.95, 4.00),
]
# "An amortization period beyond 25 years is subject to a 0.20% surcharge."
# Same CMHC source as above.
CMHC_EXTENDED_AMORTIZATION_SURCHARGE_PCT = 0.20
# "Premiums in Quebec, Ontario and Saskatchewan are subject to provincial
# sales tax. The provincial sales tax cannot be added to the loan
# amount." Same CMHC source as above; Ontario's PST rate is 8%.
ONTARIO_PST_ON_PREMIUM_PCT = 8.0

# Ontario provincial Land Transfer Tax marginal brackets, residential,
# fetched directly from Ontario's own published rate table:
# https://www.ontario.ca/document/land-transfer-tax/calculating-land-transfer-tax
# (fetched 2026-07-06). Each tuple is (bracket upper bound, marginal rate
# pct applied to the slice of price within that bracket only). The final
# tuple's upper bound is None, meaning no upper bound.
ONTARIO_LTT_BRACKETS: list[tuple[float | None, float]] = [
    (55_000, 0.5),
    (250_000, 1.0),
    (400_000, 1.5),
    (2_000_000, 2.0),
    (None, 2.5),
]
# https://www.ontario.ca/document/land-transfer-tax/land-transfer-tax-refunds-first-time-homebuyers
# (fetched 2026-07-06): "the maximum amount of the refund is $4,000."
ONTARIO_LTT_FIRST_TIME_BUYER_REBATE_MAX = 4_000.0

# Toronto Municipal Land Transfer Tax marginal brackets, residential (one
# or two single family residences), fetched directly from Toronto's own
# published rate table, effective April 1, 2026:
# https://www.toronto.ca/services-payments/property-taxes-utilities/municipal-land-transfer-tax-mltt/municipal-land-transfer-tax-mltt-rates-and-fees/
# (fetched 2026-07-06). This has more brackets than the Ontario provincial
# table above (luxury tiers beyond $2,000,000, up to 8.60% over
# $20,000,000), confirmed by reading Toronto's own published table
# directly rather than assuming it mirrors the provincial structure.
TORONTO_MLTT_BRACKETS: list[tuple[float | None, float]] = [
    (55_000, 0.5),
    (250_000, 1.0),
    (400_000, 1.5),
    (2_000_000, 2.0),
    (3_000_000, 2.5),
    (4_000_000, 4.40),
    (5_000_000, 5.45),
    (10_000_000, 6.50),
    (20_000_000, 7.55),
    (None, 8.60),
]
# https://www.toronto.ca/services-payments/property-taxes-utilities/municipal-land-transfer-tax-mltt/municipal-land-transfer-tax-mltt-rebate-opportunities/
# (fetched 2026-07-06): "up to $4,475.00"
TORONTO_MLTT_FIRST_TIME_BUYER_REBATE_MAX = 4_475.0


def marginal_bracket_tax(price: float, brackets: list[tuple[float | None, float]]) -> float:
    """Standard marginal-bracket tax: each bracket's rate applies only to
    the slice of price inside that bracket, not the whole price once a
    higher bracket is reached."""
    tax = 0.0
    lower = 0.0
    for upper, rate in brackets:
        if upper is None or price <= upper:
            tax += max(0.0, price - lower) * (rate / 100)
            break
        tax += (upper - lower) * (rate / 100)
        lower = upper
    return tax


def minimum_down_payment(price: float) -> float:
    """Canada's federal minimum down payment rule: 5% on the portion of
    price up to $500,000, 10% on the portion from $500,000 up to $1.5
    million, 20% of the whole price at $1.5 million or above (insured
    mortgages are not available at or above that threshold, so 20%
    conventional financing is the practical minimum there)."""
    if price <= 500_000:
        return price * 0.05
    if price < 1_500_000:
        return 500_000 * 0.05 + (price - 500_000) * 0.10
    return price * 0.20


def cmhc_premium_pct(ltv: float, amortization_years: float) -> float:
    """CMHC premium as a percent of the insured loan amount, selected by
    loan-to-value tier, plus the extended-amortization surcharge when
    amortization is beyond 25 years."""
    for upper, tier_pct in CMHC_PREMIUM_TIERS:
        if ltv <= upper + 1e-9:
            return tier_pct + (CMHC_EXTENDED_AMORTIZATION_SURCHARGE_PCT if amortization_years > 25 else 0.0)
    # Should be unreachable: the minimum-down-payment rule above always
    # caps LTV at 95%. Fail loud rather than silently return a wrong
    # premium if that invariant is ever broken.
    raise ValueError(f"LTV {ltv} exceeds the insurable maximum of 95%")


def monthly_mortgage_payment(principal: float, annual_rate_pct: float, amortization_years: float) -> float:
    """Standard fixed-rate mortgage payment formula, monthly-compounding
    approximation. Real Canadian mortgages compound semi-annually not in
    advance, which differs slightly from this simplified monthly
    convention; documented here as an approximation, not exact bank
    math, same spirit as the disclaimer shown alongside it in the UI."""
    monthly_rate = (annual_rate_pct / 100) / 12
    n = amortization_years * 12
    if monthly_rate == 0:
        return principal / n
    return principal * (monthly_rate * (1 + monthly_rate) ** n) / ((1 + monthly_rate) ** n - 1)


def is_toronto_address(address: str | None) -> bool:
    """No dedicated municipality field exists in the POC data (checked:
    every key in the schema, none of them hold this). The address format
    is always "street, municipality" though (confirmed: all 105 real
    rows have exactly one comma), so this parses the same signal a human
    would read off the address itself."""
    if not address or "," not in address:
        return False
    municipality = address.rsplit(",", 1)[1].strip()
    return municipality.lower() == "toronto"


def _setting_float(settings: dict[str, str], key: str, default: float) -> float:
    try:
        return float(settings.get(key, default))
    except (TypeError, ValueError):
        return default


def compute_mortgage_breakdown(
    price: float,
    settings: dict[str, str],
    is_toronto: bool,
) -> dict[str, Any]:
    """The full potential-purchase-price mortgage estimate: down payment
    (with the legal minimum top-up rule), CMHC premium and its Ontario
    PST if under 20% down, Ontario and (if applicable) Toronto land
    transfer tax with first-time-buyer rebates, fixed closing costs, and
    a recomputed Monthly PIT. Every figure here is computed against a
    real published rate or bracket, not a placeholder, but it is still an
    estimate: see the disclaimer surfaced alongside it in the UI."""
    down_payment_pct = _setting_float(settings, "down_payment_pct", 10.0)
    interest_rate_pct = _setting_float(settings, "interest_rate_pct", 5.0)
    amortization_years = _setting_float(settings, "amortization_years", 30.0)
    property_tax_pct = _setting_float(settings, "property_tax_pct", 1.0)
    first_time_buyer = settings.get("first_time_buyer") == "true"

    entered_down_payment = price * (down_payment_pct / 100)
    required_minimum = minimum_down_payment(price)
    topped_up = entered_down_payment < required_minimum
    down_payment_amount = required_minimum if topped_up else entered_down_payment

    insured_loan_amount = price - down_payment_amount
    effective_down_payment_pct = down_payment_amount / price

    cmhc_rate_pct = 0.0
    cmhc_premium = 0.0
    cmhc_pst = 0.0
    cmhc_applies = effective_down_payment_pct < 0.20
    if cmhc_applies:
        ltv = insured_loan_amount / price
        cmhc_rate_pct = cmhc_premium_pct(ltv, amortization_years)
        cmhc_premium = insured_loan_amount * (cmhc_rate_pct / 100)
        cmhc_pst = cmhc_premium * (ONTARIO_PST_ON_PREMIUM_PCT / 100)

    financed_loan_amount = insured_loan_amount + cmhc_premium

    ontario_ltt_before_rebate = marginal_bracket_tax(price, ONTARIO_LTT_BRACKETS)
    ontario_rebate = min(ontario_ltt_before_rebate, ONTARIO_LTT_FIRST_TIME_BUYER_REBATE_MAX) if first_time_buyer else 0.0
    ontario_ltt_after_rebate = ontario_ltt_before_rebate - ontario_rebate

    toronto_ltt_before_rebate = 0.0
    toronto_rebate = 0.0
    toronto_ltt_after_rebate = 0.0
    if is_toronto:
        toronto_ltt_before_rebate = marginal_bracket_tax(price, TORONTO_MLTT_BRACKETS)
        toronto_rebate = min(toronto_ltt_before_rebate, TORONTO_MLTT_FIRST_TIME_BUYER_REBATE_MAX) if first_time_buyer else 0.0
        toronto_ltt_after_rebate = toronto_ltt_before_rebate - toronto_rebate

    fixed_costs = {
        "legalFees": _setting_float(settings, "legal_fees_flat", 1500.0),
        "homeInspection": _setting_float(settings, "home_inspection_flat", 500.0),
        "appraisal": _setting_float(settings, "appraisal_flat", 350.0),
        "titleInsurance": _setting_float(settings, "title_insurance_flat", 300.0),
    }
    fixed_costs_total = sum(fixed_costs.values())

    monthly_principal_interest = monthly_mortgage_payment(financed_loan_amount, interest_rate_pct, amortization_years)
    monthly_property_tax = price * (property_tax_pct / 100) / 12
    monthly_pit = monthly_principal_interest + monthly_property_tax

    cost_to_close = down_payment_amount + cmhc_pst + ontario_ltt_after_rebate + toronto_ltt_after_rebate + fixed_costs_total

    return {
        "price": price,
        "downPayment": {
            "enteredPct": down_payment_pct,
            "enteredAmount": round(entered_down_payment, 2),
            "requiredMinimum": round(required_minimum, 2),
            "toppedUp": topped_up,
            "amount": round(down_payment_amount, 2),
        },
        "cmhc": {
            "applies": cmhc_applies,
            "premiumRatePct": round(cmhc_rate_pct, 2),
            "premium": round(cmhc_premium, 2),
            "pst": round(cmhc_pst, 2),
        },
        "ontarioLtt": {
            "beforeRebate": round(ontario_ltt_before_rebate, 2),
            "rebate": round(ontario_rebate, 2),
            "afterRebate": round(ontario_ltt_after_rebate, 2),
        },
        "torontoLtt": {
            "applies": is_toronto,
            "beforeRebate": round(toronto_ltt_before_rebate, 2),
            "rebate": round(toronto_rebate, 2),
            "afterRebate": round(toronto_ltt_after_rebate, 2),
        },
        "fixedCosts": {k: round(v, 2) for k, v in fixed_costs.items()},
        "fixedCostsTotal": round(fixed_costs_total, 2),
        "costToClose": round(cost_to_close, 2),
        "financedLoanAmount": round(financed_loan_amount, 2),
        "monthlyPrincipalInterest": round(monthly_principal_interest, 2),
        "monthlyPropertyTax": round(monthly_property_tax, 2),
        "monthlyPit": round(monthly_pit, 2),
    }


def fetch_poc(params: dict[str, str]) -> dict[str, Any]:
    if not POC_DATA_PATH.exists():
        raise RuntimeError("POC data export is missing. Run scripts/export_poc.py first.")
    raw = json.loads(POC_DATA_PATH.read_text())
    normalized = [normalize_poc(row) for row in raw.get("properties", [])]
    filtered = [item for item in normalized if passes_local_filters(item, params)]
    return {
        "apiVersion": "poc",
        "sourceCount": raw.get("count", len(normalized)),
        "page": 1,
        "pageSize": len(normalized),
        "returned": len(filtered),
        "listings": filtered,
        "prototypeNote": "Existing House Hunter POC Google Sheet export, served locally and not committed.",
    }


def enrich_with_mortgage_breakdown(listings: list[dict[str, Any]], conn: sqlite3.Connection) -> None:
    """Attaches mortgageBreakdown to every listing that has a valid price
    to compute against: the entered potential purchase price when one
    exists, list price otherwise. This is the normal way every card's
    Financial section works now, not a special case for listings with an
    override. Also attaches potentialPurchasePrice whenever one was
    entered, whether or not it differs from list price, so the edit UI
    and its "(Name)" attribution can still show it. Mutates listings in
    place. Never touches pitNum/dueNum/condoFeeNum -- the original
    entered figures stay in the underlying record as a reference, they
    are just no longer surfaced on the card."""
    listing_ids = [item["mls"] for item in listings if item.get("mls")]
    if not listing_ids:
        return
    potential_prices = potential_prices_for_listings(conn, listing_ids)

    settings_rows = conn.execute("SELECT key, value FROM household_settings").fetchall()
    settings = dict(HOUSEHOLD_SETTING_DEFAULTS)
    settings.update({row["key"]: row["value"] for row in settings_rows})

    for item in listings:
        entry = potential_prices.get(item["mls"])
        base_price = item.get("price")
        if entry is not None:
            base_price = entry["price"]
            item["potentialPurchasePrice"] = {
                "price": entry["price"],
                "updatedBy": entry["updated_by"],
                "updatedByName": entry["updated_by_name"],
                "updatedAt": entry["updated_at"],
            }
        # No potential price and no list price either: nothing valid to
        # compute against. Leave mortgageBreakdown absent rather than
        # compute against a zero/missing base.
        if base_price is None or base_price <= 0:
            continue
        is_toronto = is_toronto_address(item.get("address"))
        item["mortgageBreakdown"] = compute_mortgage_breakdown(base_price, settings, is_toronto)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def send_json(self, data: Any, status: int = 200) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_static(self, path: Path, content_type: str) -> None:
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        # no-cache (revalidate before reuse), not no-store, so the browser
        # and the Cloudflare edge never serve a stale index.html/app.js/
        # styles.css after a deploy. Without this the origin sent no
        # Cache-Control and the edge applied its own multi-hour max-age, so
        # a client could run an app.js from before a feature shipped (this
        # is exactly how the Location thresholds section rendered with no
        # inputs on the live domain while working locally).
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        params = {k: v[-1] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        try:
            if parsed.path == "/api/listings":
                raw = fetch_repliers(params)
                normalized = [normalize(row) for row in raw.get("listings", [])]
                filtered = [item for item in normalized if passes_local_filters(item, params)]
                raw_clusters = ((raw.get("aggregates") or {}).get("map") or {}).get("clusters") or []
                clusters = [
                    {
                        "count": c.get("count"),
                        "lat": (c.get("location") or {}).get("latitude"),
                        "lng": (c.get("location") or {}).get("longitude"),
                        "bounds": c.get("bounds"),
                    }
                    for c in raw_clusters
                ]
                self.send_json({
                    "apiVersion": raw.get("apiVersion"),
                    "sourceCount": raw.get("count"),
                    "page": raw.get("page"),
                    "pageSize": raw.get("pageSize"),
                    "returned": len(filtered),
                    "listings": filtered,
                    "clusters": clusters,
                    "prototypeNote": "Free Repliers sample data. Live Ontario feed requires PropTx/ITSO paid access.",
                })
                return
            if parsed.path == "/api/poc-listings":
                data = fetch_poc(params)
                conn = get_db()
                try:
                    enrich_with_mortgage_breakdown(data["listings"], conn)
                finally:
                    conn.close()
                self.send_json(data)
                return
            if parsed.path == "/api/people":
                if not require_auth(self):
                    self.send_json({"error": "unauthorized"}, 401)
                    return
                conn = get_db()
                try:
                    rows = conn.execute("SELECT id, name, role FROM people ORDER BY id").fetchall()
                    self.send_json({"people": [dict(row) for row in rows]})
                finally:
                    conn.close()
                return
            if parsed.path == "/api/feedback":
                if not require_auth(self):
                    self.send_json({"error": "unauthorized"}, 401)
                    return
                listing_ids = [x for x in (params.get("listing_ids") or "").split(",") if x]
                conn = get_db()
                try:
                    feedback = latest_feedback_for_listings(conn, listing_ids)
                    self.send_json({"feedback": feedback})
                finally:
                    conn.close()
                return
            if parsed.path == "/api/potential-purchase-prices":
                if not require_auth(self):
                    self.send_json({"error": "unauthorized"}, 401)
                    return
                listing_ids = [x for x in (params.get("listing_ids") or "").split(",") if x]
                conn = get_db()
                try:
                    prices = potential_prices_for_listings(conn, listing_ids)
                    self.send_json({"potential_purchase_prices": prices})
                finally:
                    conn.close()
                return
            if parsed.path == "/api/poi":
                # T14: shared across the whole buyer group, same auth as
                # /api/people and /api/feedback, not per-person filtered.
                if not require_auth(self):
                    self.send_json({"error": "unauthorized"}, 401)
                    return
                conn = get_db()
                try:
                    rows = conn.execute(
                        """
                        SELECT p.id, p.type, p.label, p.lat, p.lng,
                               p.created_by, pe.name AS created_by_name, p.created_at
                        FROM poi_pins p
                        JOIN people pe ON pe.id = p.created_by
                        ORDER BY p.id
                        """
                    ).fetchall()
                    self.send_json({"poi": [dict(row) for row in rows]})
                finally:
                    conn.close()
                return
            if parsed.path == "/api/household-settings":
                # Shared across the whole buyer group, same auth as
                # /api/people and /api/poi, not per-person filtered.
                if not require_auth(self):
                    self.send_json({"error": "unauthorized"}, 401)
                    return
                conn = get_db()
                try:
                    rows = conn.execute("SELECT key, value FROM household_settings").fetchall()
                    settings = dict(HOUSEHOLD_SETTING_DEFAULTS)
                    settings.update({row["key"]: row["value"] for row in rows})
                    self.send_json({"settings": settings})
                finally:
                    conn.close()
                return
            if parsed.path == "/api/person-thresholds":
                # Per person in structure, but shared across the whole buyer
                # group like household settings, same auth, not per-person
                # filtered: everyone sees (and may edit) everyone's.
                if not require_auth(self):
                    self.send_json({"error": "unauthorized"}, 401)
                    return
                conn = get_db()
                try:
                    self.send_json({"person_thresholds": person_thresholds_all(conn)})
                finally:
                    conn.close()
                return
            if parsed.path == "/api/place-attachments":
                # Shared across the whole group like feedback/POI, same auth.
                if not require_auth(self):
                    self.send_json({"error": "unauthorized"}, 401)
                    return
                listing_ids = [x for x in (params.get("listing_ids") or "").split(",") if x]
                conn = get_db()
                try:
                    self.send_json({"place_attachments": attachments_for_listings(conn, listing_ids)})
                finally:
                    conn.close()
                return
            if parsed.path == "/api/health":
                self.send_json({"ok": True, "hasKey": bool(API_KEY), "baseUrl": BASE_URL})
                return
            if parsed.path == "/api/config":
                # Unprotected by design: the frontend needs this to bootstrap
                # the auth token before it can call anything else. Same
                # deterrent-not-security tradeoff as the token itself (D3/D11).
                self.send_json({"auth_token": APP_AUTH_TOKEN, "mapbox_token": MAPBOX_TOKEN})
                return
            if parsed.path == "/layers/go-stations.geojson":
                self.send_static(STATIC / "layers" / "go_stations.geojson", "application/geo+json; charset=utf-8")
                return
            if parsed.path == "/layers/go-lines.geojson":
                self.send_static(STATIC / "layers" / "go_lines.geojson", "application/geo+json; charset=utf-8")
                return
            if parsed.path == "/layers/highway-413.geojson":
                self.send_static(STATIC / "layers" / "highway_413.geojson", "application/geo+json; charset=utf-8")
                return
            if parsed.path in ("/", "/index.html"):
                self.send_static(STATIC / "index.html", "text/html; charset=utf-8")
                return
            if parsed.path == "/app.js":
                self.send_static(STATIC / "app.js", "text/javascript; charset=utf-8")
                return
            if parsed.path == "/styles.css":
                self.send_static(STATIC / "styles.css", "text/css; charset=utf-8")
                return
            self.send_json({"error": "not_found"}, 404)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:1000]
            self.send_json({"error": "repliers_http_error", "status": exc.code, "detail": detail}, 502)
        except Exception as exc:  # pragma: no cover, surfaced in browser for prototype speed
            self.send_json({"error": type(exc).__name__, "detail": str(exc)}, 500)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/api/feedback":
                if not require_auth(self):
                    self.send_json({"error": "unauthorized"}, 401)
                    return
                length = int(self.headers.get("Content-Length", "0") or "0")
                raw_body = self.rfile.read(length) if length else b""
                try:
                    body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                except (json.JSONDecodeError, UnicodeDecodeError):
                    self.send_json({"error": "invalid_request", "detail": "malformed JSON body"}, 400)
                    return
                if not isinstance(body, dict):
                    self.send_json({"error": "invalid_request", "detail": "body must be a JSON object"}, 400)
                    return
                data, status = handle_feedback_post(body)
                self.send_json(data, status)
                return
            if parsed.path == "/api/potential-purchase-prices":
                if not require_auth(self):
                    self.send_json({"error": "unauthorized"}, 401)
                    return
                length = int(self.headers.get("Content-Length", "0") or "0")
                raw_body = self.rfile.read(length) if length else b""
                try:
                    body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                except (json.JSONDecodeError, UnicodeDecodeError):
                    self.send_json({"error": "invalid_request", "detail": "malformed JSON body"}, 400)
                    return
                if not isinstance(body, dict):
                    self.send_json({"error": "invalid_request", "detail": "body must be a JSON object"}, 400)
                    return
                data, status = handle_potential_price_post(body)
                self.send_json(data, status)
                return
            if parsed.path == "/api/poi":
                if not require_auth(self):
                    self.send_json({"error": "unauthorized"}, 401)
                    return
                length = int(self.headers.get("Content-Length", "0") or "0")
                raw_body = self.rfile.read(length) if length else b""
                try:
                    body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                except (json.JSONDecodeError, UnicodeDecodeError):
                    self.send_json({"error": "invalid_request", "detail": "malformed JSON body"}, 400)
                    return
                if not isinstance(body, dict):
                    self.send_json({"error": "invalid_request", "detail": "body must be a JSON object"}, 400)
                    return
                data, status = handle_poi_post(body)
                self.send_json(data, status)
                return
            if parsed.path == "/api/household-settings":
                if not require_auth(self):
                    self.send_json({"error": "unauthorized"}, 401)
                    return
                length = int(self.headers.get("Content-Length", "0") or "0")
                raw_body = self.rfile.read(length) if length else b""
                try:
                    body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                except (json.JSONDecodeError, UnicodeDecodeError):
                    self.send_json({"error": "invalid_request", "detail": "malformed JSON body"}, 400)
                    return
                if not isinstance(body, dict):
                    self.send_json({"error": "invalid_request", "detail": "body must be a JSON object"}, 400)
                    return
                data, status = handle_household_settings_post(body)
                self.send_json(data, status)
                return
            if parsed.path == "/api/person-thresholds":
                if not require_auth(self):
                    self.send_json({"error": "unauthorized"}, 401)
                    return
                length = int(self.headers.get("Content-Length", "0") or "0")
                raw_body = self.rfile.read(length) if length else b""
                try:
                    body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                except (json.JSONDecodeError, UnicodeDecodeError):
                    self.send_json({"error": "invalid_request", "detail": "malformed JSON body"}, 400)
                    return
                if not isinstance(body, dict):
                    self.send_json({"error": "invalid_request", "detail": "body must be a JSON object"}, 400)
                    return
                data, status = handle_person_thresholds_post(body)
                self.send_json(data, status)
                return
            if parsed.path in ("/api/place-attachments", "/api/place-attachments/recompute"):
                if not require_auth(self):
                    self.send_json({"error": "unauthorized"}, 401)
                    return
                length = int(self.headers.get("Content-Length", "0") or "0")
                raw_body = self.rfile.read(length) if length else b""
                try:
                    body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                except (json.JSONDecodeError, UnicodeDecodeError):
                    self.send_json({"error": "invalid_request", "detail": "malformed JSON body"}, 400)
                    return
                if not isinstance(body, dict):
                    self.send_json({"error": "invalid_request", "detail": "body must be a JSON object"}, 400)
                    return
                if parsed.path == "/api/place-attachments/recompute":
                    data, status = handle_place_attachment_recompute(body)
                else:
                    data, status = handle_place_attachment_post(body)
                self.send_json(data, status)
                return
            self.send_json({"error": "not_found"}, 404)
        except Exception as exc:  # pragma: no cover, surfaced in browser for prototype speed
            self.send_json({"error": type(exc).__name__, "detail": str(exc)}, 500)

    def do_DELETE(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/api/potential-purchase-prices":
                if not require_auth(self):
                    self.send_json({"error": "unauthorized"}, 401)
                    return
                length = int(self.headers.get("Content-Length", "0") or "0")
                raw_body = self.rfile.read(length) if length else b""
                try:
                    body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                except (json.JSONDecodeError, UnicodeDecodeError):
                    self.send_json({"error": "invalid_request", "detail": "malformed JSON body"}, 400)
                    return
                if not isinstance(body, dict):
                    self.send_json({"error": "invalid_request", "detail": "body must be a JSON object"}, 400)
                    return
                data, status = handle_potential_price_delete(body)
                self.send_json(data, status)
                return
            if parsed.path == "/api/place-attachments":
                if not require_auth(self):
                    self.send_json({"error": "unauthorized"}, 401)
                    return
                length = int(self.headers.get("Content-Length", "0") or "0")
                raw_body = self.rfile.read(length) if length else b""
                try:
                    body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                except (json.JSONDecodeError, UnicodeDecodeError):
                    self.send_json({"error": "invalid_request", "detail": "malformed JSON body"}, 400)
                    return
                if not isinstance(body, dict):
                    self.send_json({"error": "invalid_request", "detail": "body must be a JSON object"}, 400)
                    return
                data, status = handle_place_attachment_delete(body)
                self.send_json(data, status)
                return
            self.send_json({"error": "not_found"}, 404)
        except Exception as exc:  # pragma: no cover, surfaced in browser for prototype speed
            self.send_json({"error": type(exc).__name__, "detail": str(exc)}, 500)


def main() -> None:
    init_db()
    backfill_poc_feedback()
    load_poc_listing_ids()
    load_highways()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"House Hunter Repliers prototype running at http://127.0.0.1:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
