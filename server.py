#!/usr/bin/env python3
"""House Hunter Repliers prototype.

Small stdlib-only web server. It keeps the Repliers API key server-side,
normalizes sample listing data, and serves a Leaflet/card UI.
"""
from __future__ import annotations

import json
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
ALLOWED_ACTION_TYPES = {"rating", "note", "reject", "research_request"}

# D10: known POC listing ids, loaded once at startup (see load_poc_listing_ids).
# Repliers-sourced ids are format-checked only, not existence-checked against
# this set — see validate_listing_id.
POC_LISTING_IDS: set[str] = set()

# Demo participants (buyer_group_id stub column stays null until a real
# buyer_groups table exists, see PROJECT_BRIEF.md commercial path). Anees
# and Kevin are advisors in-app even though they are also co-investors in
# House Hunter as a product, per PROJECT_BRIEF.md.
SEED_PEOPLE = [
    ("Mark", "buyer"),
    ("Katie", "buyer"),
    ("Anees", "advisor"),
    ("Kevin", "advisor"),
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
                role TEXT NOT NULL CHECK (role IN ('buyer', 'advisor')),
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
            """
        )
        existing = conn.execute("SELECT COUNT(*) FROM people").fetchone()[0]
        if existing == 0:
            conn.executemany(
                "INSERT INTO people (name, role) VALUES (?, ?)", SEED_PEOPLE
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
    """D10: build the in-memory set of known POC listing ids at startup."""
    global POC_LISTING_IDS
    if not POC_DATA_PATH.exists():
        POC_LISTING_IDS = set()
        return
    raw = json.loads(POC_DATA_PATH.read_text())
    POC_LISTING_IDS = {f"POC-{row.get('row')}" for row in raw.get("properties", [])}


def require_auth(handler: BaseHTTPRequestHandler) -> bool:
    """D3/D11: shared-secret deterrent on person-data endpoints.

    Not real access control. The token must live in browser JS to be sent,
    so it is visible in dev tools — this only deters a random person who
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
    if not isinstance(person_id, int):
        return False
    return conn.execute("SELECT 1 FROM people WHERE id = ?", (person_id,)).fetchone() is not None


def latest_feedback_for_listings(
    conn: sqlite3.Connection, listing_ids: list[str]
) -> dict[str, list[dict[str, Any]]]:
    """Latest-state feedback per person per listing (D2).

    Every known person gets an entry per requested listing, with nulls if
    they have no feedback yet (D6's batch shape) — the frontend gets an
    explicit "no rating yet" state without a separate lookup against
    GET /api/people. rating/note/reject are each independently the latest
    by action_type; updated_at is the max created_at across all of them
    for that person on that listing.
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
                "reason": None,
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
        elif row["action_type"] == "reject":
            entry["status"] = row["status"]
            entry["reason"] = row["reason"]
        elif row["action_type"] == "research_request":
            entry["status"] = entry["status"] or "research_requested"
        if entry["updated_at"] is None or row["created_at"] > entry["updated_at"]:
            entry["updated_at"] = row["created_at"]

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
    # Keep API-side filtering conservative until live Ontario data is available.
    url = f"{BASE_URL}/listings?{urllib.parse.urlencode(query)}"
    req = urllib.request.Request(url, headers={"REPLIERS-API-KEY": API_KEY})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def passes_local_filters(item: dict[str, Any], params: dict[str, str]) -> bool:
    def gnum(name: str) -> float | None:
        return number(params.get(name))

    min_price, max_price = gnum("minPrice"), gnum("maxPrice")
    min_beds, min_baths = gnum("minBeds"), gnum("minBaths")
    min_fit = gnum("minFit")
    q = (params.get("q") or "").strip().lower()

    if min_price is not None and (item.get("price") is None or item["price"] < min_price):
        return False
    if max_price is not None and (item.get("price") is None or item["price"] > max_price):
        return False
    if min_beds is not None and (item.get("beds") is None or item["beds"] < min_beds):
        return False
    if min_baths is not None and (item.get("baths") is None or item["baths"] < min_baths):
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
    return {
        "mls": f"POC-{p.get('row')}",
        "address": p.get("address") or "Address hidden",
        "city": "",
        "state": "ON",
        "price": intish(p.get("priceNum") or p.get("price")),
        "originalPrice": None,
        "soldPrice": None,
        "beds": p.get("beds") or p.get("bedsNum"),
        "baths": number(p.get("bathsNum") or p.get("baths")),
        "sqft": intish(p.get("sqftNum") or p.get("sqft")),
        "acres": number(p.get("acresNum") or p.get("acres")),
        "lotSqft": None,
        "propertyType": "House Hunter POC",
        "style": p.get("status") or "",
        "heating": "",
        "parking": None,
        "garage": None,
        "dom": intish(p.get("goTotal")),
        "status": p.get("status") or "POC",
        "listDate": "",
        "lat": number(p.get("lat")),
        "lng": number(p.get("lon")),
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
                self.send_json({
                    "apiVersion": raw.get("apiVersion"),
                    "sourceCount": raw.get("count"),
                    "page": raw.get("page"),
                    "pageSize": raw.get("pageSize"),
                    "returned": len(filtered),
                    "listings": filtered,
                    "prototypeNote": "Free Repliers sample data. Live Ontario feed requires PropTx/ITSO paid access.",
                })
                return
            if parsed.path == "/api/poc-listings":
                self.send_json(fetch_poc(params))
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
            if parsed.path == "/api/health":
                self.send_json({"ok": True, "hasKey": bool(API_KEY), "baseUrl": BASE_URL})
                return
            if parsed.path == "/api/config":
                # Unprotected by design: the frontend needs this to bootstrap
                # the auth token before it can call anything else. Same
                # deterrent-not-security tradeoff as the token itself (D3/D11).
                self.send_json({"auth_token": APP_AUTH_TOKEN})
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
            self.send_json({"error": "not_found"}, 404)
        except Exception as exc:  # pragma: no cover, surfaced in browser for prototype speed
            self.send_json({"error": type(exc).__name__, "detail": str(exc)}, 500)


def main() -> None:
    init_db()
    backfill_poc_feedback()
    load_poc_listing_ids()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"House Hunter Repliers prototype running at http://127.0.0.1:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
