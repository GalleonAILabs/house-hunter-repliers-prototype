#!/usr/bin/env python3
"""House Hunter Repliers prototype.

Small stdlib-only web server. It keeps the Repliers API key server-side,
normalizes sample listing data, and serves a Leaflet/card UI.
"""
from __future__ import annotations

import json
import os
import re
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
    return {
        "mls": f"POC-{p.get('row')}",
        "address": p.get("address") or "Address hidden",
        "city": "",
        "state": "ON",
        "price": intish(p.get("priceNum") or p.get("price")),
        "originalPrice": None,
        "soldPrice": None,
        "beds": intish(p.get("bedsNum") or p.get("beds")),
        "bedsPlus": None,
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
        "agent": p.get("rejBy") or "",
        "brokerage": p.get("go") or "",
        "estimate": None,
        "imageSummary": None,
        "rawClass": "poc",
        "fit": fit,
        "poc": {
            "row": p.get("row"),
            "link": p.get("link"),
            "doc": p.get("doc"),
            "go": p.get("go"),
            "goMin": p.get("goMin"),
            "goTrain": p.get("goTrain"),
            "goTotal": p.get("goTotal"),
            "markRank": p.get("markRank"),
            "katieRank": p.get("katieRank"),
            "markComments": p.get("markComments"),
            "katieComments": p.get("katieComments"),
            "realtorComments": p.get("realtorComments"),
            "dueClosing": p.get("dueClosing"),
            "pit": p.get("pit"),
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
            if parsed.path == "/api/health":
                self.send_json({"ok": True, "hasKey": bool(API_KEY), "baseUrl": BASE_URL})
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


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"House Hunter Repliers prototype running at http://127.0.0.1:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
