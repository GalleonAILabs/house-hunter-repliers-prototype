#!/usr/bin/env python3
"""Build 400-series highway GeoJSON layers from OpenStreetMap.

Offline ETL, same spirit as the script that produced go_lines.geojson: it
fetches the mainline geometry for each 400-series highway that runs near the
POC listings from the OpenStreetMap Overpass API and writes one
FeatureCollection of LineStrings per highway into static/layers/, in the
same [lon, lat] format as highway_413.geojson.

Highway 413 already has its own file (built earlier from MTO/WSP EA design
data, higher accuracy than OSM for that not-yet-built corridor), so it is
deliberately NOT rebuilt here. This script covers the existing highways
400, 401, 410, 427, whose real geometry is only available from a road
dataset like OSM, not from this repo.

Run manually when the highway set or coverage area changes:

    python3 scripts/build_highways.py

It is not run by the server; the server reads the committed .geojson output.
Straight-line distance from each listing to the nearest of these lines is
computed server-side at startup (see nearest_highway_km in server.py).
"""
from __future__ import annotations

import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAYERS = ROOT / "static" / "layers"

# Several public Overpass mirrors; the shared endpoints return 504/429 under
# load, so fetch_ref rotates through these with backoff rather than failing
# on the first busy instance.
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# 400-series highways to source. 413 is excluded on purpose (its file is
# built from more accurate EA design data, not OSM). Others near the POC
# area (403, 404, 407, QEW) can be added here later the same way if the
# family wants them factored into the nearest-highway distance.
HIGHWAY_REFS = ["400", "401", "410", "427"]

# Bounding box covering the 105 POC listings (lat 43.25-45.33, lon
# -81.15 to -79.01) padded by ~0.3 deg, so a highway just outside the
# listing cloud can still be the nearest one for an edge listing.
# Overpass wants (south, west, north, east).
BBOX = (42.95, -81.45, 45.65, -78.70)

# Drop points closer than this along a way. A ~150 m spacing keeps files
# small while bounding the worst-case straight-line distance error to well
# under the smallest threshold in use (5 km), since a nearest point can be
# off by at most about half the spacing.
MIN_POINT_SPACING_M = 150.0

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def decimate(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Keep the first and last point and any point at least
    MIN_POINT_SPACING_M from the last kept one. Preserves shape enough for
    a nearest-distance metric while cutting file size."""
    if len(points) <= 2:
        return points
    kept = [points[0]]
    for lat, lon in points[1:-1]:
        klat, klon = kept[-1]
        if haversine_m(klat, klon, lat, lon) >= MIN_POINT_SPACING_M:
            kept.append((lat, lon))
    kept.append(points[-1])
    return kept


def fetch_ref(ref: str) -> list[list[tuple[float, float]]]:
    """Return a list of ways (each a list of (lat, lon)) for one highway
    ref within BBOX. Matches the ref as a whole token so 401 does not also
    match 1401 or 4010, and still catches concurrencies like "401;409" and
    prefixed forms like "ON 401"."""
    south, west, north, east = BBOX
    ref_re = f"(^|[ ;,])({ref})($|[ ;,])"
    query = (
        "[out:json][timeout:120];"
        f'way["highway"="motorway"]["ref"~"{ref_re}"]'
        f"({south},{west},{north},{east});"
        "out geom;"
    )
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")

    payload = None
    attempts = [(url, wait) for wait in (0, 15, 40) for url in OVERPASS_URLS]
    last_err: Exception | None = None
    for url, wait in attempts:
        if wait:
            time.sleep(wait)
        try:
            # Overpass rejects urllib's default User-Agent with 406; identify the tool.
            req = urllib.request.Request(
                url, data=data,
                headers={"User-Agent": "house-hunter-repliers-prototype/1.0 (highway layer build)"},
            )
            with urllib.request.urlopen(req, timeout=180) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            break
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            last_err = exc
            print(f"  {url.split('/')[2]} failed ({exc}), trying next ...", file=sys.stderr)
    if payload is None:
        raise RuntimeError(f"all Overpass endpoints failed for ref {ref}: {last_err}")

    ways = []
    for element in payload.get("elements", []):
        geometry = element.get("geometry") or []
        points = [(pt["lat"], pt["lon"]) for pt in geometry if "lat" in pt and "lon" in pt]
        if len(points) >= 2:
            ways.append(decimate(points))
    return ways


def build_feature_collection(ref: str, ways: list[list[tuple[float, float]]]) -> dict:
    features = [
        {
            "type": "Feature",
            "properties": {
                "name": f"Highway {ref}",
                "ref": ref,
                "source": "OpenStreetMap via Overpass API (highway=motorway mainline), ODbL",
            },
            # GeoJSON coordinate order is [lon, lat], matching highway_413.geojson.
            "geometry": {
                "type": "LineString",
                "coordinates": [[round(lon, 6), round(lat, 6)] for lat, lon in way],
            },
        }
        for way in ways
    ]
    return {"type": "FeatureCollection", "features": features}


def main() -> None:
    LAYERS.mkdir(parents=True, exist_ok=True)
    for ref in HIGHWAY_REFS:
        print(f"Fetching Highway {ref} ...", flush=True)
        ways = fetch_ref(ref)
        total_points = sum(len(w) for w in ways)
        if not ways:
            print(f"  WARNING: no ways returned for {ref}", file=sys.stderr)
        fc = build_feature_collection(ref, ways)
        out = LAYERS / f"highway_{ref}.geojson"
        out.write_text(json.dumps(fc))
        print(f"  {len(ways)} ways, {total_points} points -> {out.relative_to(ROOT)}")
        time.sleep(2)  # be polite to the shared public Overpass endpoint


if __name__ == "__main__":
    main()
