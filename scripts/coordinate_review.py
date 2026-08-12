#!/usr/bin/env python3
"""Write the coordinate review list, ranked by whether an error would matter.

Not every uncertain pin is worth anyone's time. A pin can be several kilometres
out and change nothing, because the map is a triage view and the decisions come
from the sheet's own columns. What does change an outcome is a pin sitting near
a filter boundary: the household highway-distance threshold, or the edge of a
drawn search area. Those flip whether a house appears at all.

So the list is ordered by consequence, not by suspicion:

  check now    within 1.5 km of the highway threshold, or 5 km of an area edge
  worth a look near a boundary but with room to spare
  cosmetic     no live filter nearby; an error moves the dot and nothing else

Output goes to data/coordinate_review.md, which is gitignored: it carries the
family's addresses and must not reach the public repo.

Usage: python3 scripts/coordinate_review.py
"""
from __future__ import annotations

import datetime
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import appconfig  # noqa: E402
import datasources  # noqa: E402
import server  # noqa: E402

HIGHWAY_SETTING_KEY = "highway_km"
HIGHWAY_DEFAULT = 5.0
# How close to a boundary counts as "an error here could flip the result".
HIGHWAY_CRITICAL_KM = 1.5
AREA_CRITICAL_KM = 5.0
AREA_NEARBY_KM = 15.0


def polygon_points(raw: str) -> list[tuple[float, float]]:
    """Saved areas store a list of points; accept both shapes seen in the DB."""
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return []
    points = []
    for item in parsed:
        if isinstance(item, dict) and "lat" in item:
            points.append((float(item["lat"]), float(item["lng"])))
        elif isinstance(item, (list, tuple)) and len(item) == 2:
            points.append((float(item[1]), float(item[0])))
    return points


def point_in_polygon(point: tuple[float, float], poly: list[tuple[float, float]]) -> bool:
    x, y = point[1], point[0]
    inside = False
    for i in range(len(poly)):
        y1, x1 = poly[i]
        y2, x2 = poly[(i + 1) % len(poly)]
        if (y1 > y) != (y2 > y):
            if x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
                inside = not inside
    return inside


def main() -> int:
    server.load_highways()
    conn = sqlite3.connect(appconfig.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        threshold = HIGHWAY_DEFAULT
        row = conn.execute(
            "SELECT value FROM household_settings WHERE key = ?", (HIGHWAY_SETTING_KEY,)
        ).fetchone()
        if row and datasources.number(row["value"]) is not None:
            threshold = datasources.number(row["value"])

        areas = []
        for area in conn.execute("SELECT name, kind, polygon FROM saved_areas"):
            points = polygon_points(area["polygon"])
            if points:
                areas.append((area["name"], area["kind"], points))

        listings = [json.loads(r["payload"]) for r in conn.execute("SELECT payload FROM listings")]
    finally:
        conn.close()

    review = [
        p for p in listings
        if p.get("lat") is not None
        and p.get("geocodeProvider") and p["geocodeProvider"] != "sheet"
        and "cross-provider" not in (p.get("geocodeConfirmedBy") or [])
    ]

    ranked = []
    for listing in review:
        point = (listing["lat"], listing["lon"])
        highway_km, _name = server.nearest_highway_km(listing["lat"], listing["lon"])
        reasons, priority = [], "cosmetic"

        if highway_km is not None:
            margin = abs(highway_km - threshold)
            if margin <= HIGHWAY_CRITICAL_KM:
                priority = "check now"
                reasons.append(
                    f"{highway_km:.1f} km from a highway, against a {threshold:.0f} km "
                    f"threshold: an error either way flips this listing in or out"
                )
            elif margin <= 5:
                priority = max(priority, "worth a look", key=["cosmetic", "worth a look", "check now"].index)
                reasons.append(f"{highway_km:.1f} km from a highway (threshold {threshold:.0f} km)")

        for name, kind, poly in areas:
            edge = min(datasources.haversine_km(point, p) for p in poly)
            inside = point_in_polygon(point, poly)
            if edge <= AREA_CRITICAL_KM:
                priority = "check now"
                reasons.append(f"{edge:.1f} km from the edge of {kind} area '{name}'")
            elif edge <= AREA_NEARBY_KM:
                priority = max(priority, "worth a look", key=["cosmetic", "worth a look", "check now"].index)
                reasons.append(f"{'inside' if inside else 'near'} {kind} area '{name}' ({edge:.1f} km from edge)")

        ranked.append((priority, listing, reasons))

    order = {"check now": 0, "worth a look": 1, "cosmetic": 2}
    ranked.sort(key=lambda x: (order[x[0]], x[1].get("town") or "", x[1]["address"]))
    counts = {k: sum(1 for r in ranked if r[0] == k) for k in order}

    lines = [
        "# Coordinate review list",
        "",
        f"Generated {datetime.date.today().isoformat()} from the live listings table. "
        f"Regenerate with `python3 scripts/coordinate_review.py`.",
        "",
        f"{len(ranked)} of {len(listings)} pins are ones the two geocoders did not agree on. "
        "Every other pin is either a coordinate carried over from the original export or one "
        "both geocoders agreed on.",
        "",
        "They are ranked by whether an error would actually change anything. The map is a "
        "triage view and the real decisions come from the sheet's own columns, so a pin can be "
        "a few kilometres out and cost nothing. What does cost something is a pin near a filter "
        "boundary, because that decides whether a house appears at all.",
        "",
        f"- **check now: {counts['check now']}** near the highway threshold or a drawn area edge, "
        "where being wrong changes which listings you see",
        f"- **worth a look: {counts['worth a look']}** in the neighbourhood of a filter, with room to spare",
        f"- **cosmetic: {counts['cosmetic']}** no live filter nearby; an error moves the dot and nothing else",
        "",
        "**To fix one:** open the map link, find the real spot, right-click it in Google Maps and "
        "copy the coordinates. Put them in the `Latitude` and `Longitude` columns of the Properties "
        "tab (add the columns if they are not there yet). The next import uses them directly and "
        "stops geocoding that row. Fill in as many or as few as you like.",
        "",
        "| Priority | Sheet row | Address | Town | Current pin | Why it matters | Map |",
        "|---|---|---|---|---|---|---|",
    ]
    for priority, listing, reasons in ranked:
        lat, lon = listing["lat"], listing["lon"]
        why = "; ".join(reasons) if reasons else "no live filter nearby"
        lines.append(
            f"| {priority} | {listing.get('sheetRow','')} | {listing['address']} | "
            f"{listing.get('town','')} | `{lat}, {lon}` | {why} | "
            f"[open](https://www.google.com/maps/search/?api=1&query={lat},{lon}) |"
        )
    lines.append("")

    out = appconfig.DATA_DIR / "coordinate_review.md"
    out.write_text("\n".join(lines))
    print(f"wrote {out}")
    for key in order:
        print(f"  {key:14} {counts[key]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
