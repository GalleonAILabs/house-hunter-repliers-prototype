#!/usr/bin/env python3
"""Listing data sources behind one interface.

A source implements `fetch_listings() -> list[dict]` and returns normalized
records. Which source is live is decided by DATA_SOURCE=sheet|repliers, so the
Google Sheet importer can be retired by config alone once a paid Repliers feed
exists: nothing outside this module knows the sheet exists.

Stdlib only, per the project's no-pip constraint.

Identity note. A record's `source_key` is the listing id parsed out of the
listing Link (for example TREB-N13164916), not the sheet's MLS Number column.
Two reasons, both measured against the live sheet on 2026-08-11:
  - MLS Number is blank on 45 of 149 rows, so it cannot key an upsert. The
    link-derived id is present and unique on all 149.
  - On 5 rows the MLS Number has already moved on from the link id because the
    property was relisted. Keying on a value that changes for the same house
    would orphan every rating and note attached to it.
The MLS Number still travels on the record as an attribute; it is just not the
key. See sync.py for how a source_key maps to the stable public POC-<n> id.
"""
from __future__ import annotations

import csv
import io
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Iterable

import appconfig

FETCH_TIMEOUT = 30
USER_AGENT = "house-hunter-sync/1.0"


class SourceError(RuntimeError):
    """The source could not be read or was structurally wrong.

    Callers treat this as "keep serving what we already have". It never
    reaches the browser as a data-shaped response.
    """


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _clean(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def money(value: Any) -> float | None:
    """'$1,049,000' -> 1049000.0. Returns None for blanks and non-numbers."""
    text = _clean(value).replace("$", "").replace(",", "").replace("%", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def number(value: Any) -> float | None:
    """First number anywhere in the value: '175 ft' -> 175.0."""
    text = _clean(value).replace(",", "")
    if not text:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    return float(match.group(0)) if match else None


def intish(value: Any) -> int | None:
    num = number(value)
    return int(round(num)) if num is not None else None


def parse_beds(value: Any) -> tuple[Any, int | None]:
    """Returns (display, numeric).

    '3+1' means 3 main-floor bedrooms plus 1 in the basement, which a buyer
    reads differently from a flat 4. The display value keeps the composite
    string; the numeric value is the total, which is what range filters
    compare against. Matches the split server.normalize_poc already expects.
    """
    text = _clean(value)
    if not text:
        return "", None
    parts = [int(p) for p in re.findall(r"\d+", text)]
    if not parts:
        return text, None
    total = sum(parts)
    if len(parts) == 1 and re.fullmatch(r"\d+", text):
        return parts[0], total
    return text, total


def parse_sqft(value: Any) -> tuple[Any, float | None]:
    """'1500-2000' keeps the range for display and floors to 1500 for filters."""
    text = _clean(value)
    if not text:
        return "", None
    nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", text.replace(",", ""))]
    if not nums:
        return text, None
    if re.fullmatch(r"[\d,]+", text):
        return int(nums[0]), nums[0]
    return text, min(nums)


def parse_lot(lot: Any, frontage: Any) -> tuple[float | None, float | None]:
    """'175 x 232 Feet' -> (175.0, 232.0). Falls back to the Frontage column."""
    text = _clean(lot).replace(",", "")
    match = re.search(r"(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)", text)
    if match:
        return float(match.group(1)), float(match.group(2))
    return number(frontage), None


def acres_from(frontage: float | None, depth: float | None, stated: Any) -> float | None:
    """Prefer frontage x depth over the sheet's Acreage column.

    The CSV export hands back display-rounded cells, so Acreage arrives as
    '0.93' where the retired exporter had recorded 0.932. Recomputing from the
    lot dimensions reproduces the original precision exactly; the stated column
    is the fallback for rows with no parsable dimensions.
    """
    if frontage and depth:
        return round(frontage * depth / 43560.0, 4)
    return number(stated)


def fit_met(fit: Any) -> int | None:
    """'5/8, fails: ...' -> 5."""
    match = re.match(r"\s*(\d+)\s*/\s*(\d+)", _clean(fit))
    return int(match.group(1)) if match else None


def tier_for(met: int | None) -> str:
    """Bucket used for pin colour. Derived from the retired exporter's output:
    104 of its 105 rows fit met>=8 top / met>=4 mid / else bottom. The single
    exception was a stale value (a 3/8 row still carrying 'mid'), so this rule
    reproduces the intent rather than the one-row drift."""
    if met is None:
        return ""
    if met >= 8:
        return "top"
    if met >= 4:
        return "mid"
    return "bottom"


# Minutes from a GO station to Union by train. The sheet's "GO Train Min" and
# "Total to Union Min" columns are empty for every row today, but the retired
# exporter had populated them, so these are recovered from that export. Train
# time is a property of the station, not of the house, so a station seen here
# fills in for every listing that names it. Unknown stations stay blank rather
# than guessing.
STATION_TRAIN_MIN: dict[str, int] = {
    "Allandale Waterfront GO": 100,
    "Barrie South GO": 93,
    "Bradford GO": 73,
    "East Gwillimbury GO": 63,
    "Aldershot GO": 64,
    "Acton GO": 64,
    "Mount Pleasant GO": 51,
    "Bramalea GO": 39,
    "Malton GO": 30,
}


def normalize_address(address: str) -> str:
    """Loose key for matching the same house across a changed listing id."""
    text = _clean(address).lower().rstrip(".")
    text = re.sub(r"[^\w\s,]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


LISTING_ID_RE = re.compile(r"/listing/([A-Za-z]+-[A-Za-z]?\d+)")


def listing_key_from_link(link: str) -> str | None:
    match = LISTING_ID_RE.search(_clean(link))
    return match.group(1).upper() if match else None


# ---------------------------------------------------------------------------
# Geocoding
# ---------------------------------------------------------------------------

# The family's search region. A result outside this box is a geocoder mismatch
# (an Ontario street name that also exists 300 km away), not a real listing.
SEARCH_BBOX = (-81.6, 43.0, -78.6, 45.0)  # west, south, east, north
MIN_RELEVANCE = 0.6


class Geocoder:
    """Mapbox forward geocoding with a disk cache.

    Deliberately conservative. Measured against the 105 addresses whose
    coordinates the retired exporter had already resolved, querying
    "<street>, <Area>, Ontario, Canada" lands within 500 m on 20 of 25 sampled
    rows and within 2 km on 22, but it does occasionally return a same-named
    street in another county. So:
      - an address that already has coordinates is never re-geocoded, which
        makes every existing pin immune to this;
      - a result outside the search box or below MIN_RELEVANCE is discarded
        rather than stored, leaving the listing without a pin;
      - a low-confidence result that is kept is counted and reported by the
        sync run so it can be spot-checked instead of silently trusted.
    """

    def __init__(self, token: str) -> None:
        self.token = token
        self.cache: dict[str, Any] = {}
        self.low_confidence: list[str] = []
        self.failed: list[str] = []
        self._dirty = False
        if appconfig.GEOCODE_CACHE_PATH.exists():
            try:
                self.cache = json.loads(appconfig.GEOCODE_CACHE_PATH.read_text())
            except (ValueError, OSError):
                self.cache = {}

    def save(self) -> None:
        if not self._dirty:
            return
        try:
            appconfig.GEOCODE_CACHE_PATH.write_text(json.dumps(self.cache, indent=1))
            self._dirty = False
        except OSError:
            pass

    def preseed(self, address: str, lat: float, lon: float) -> None:
        """Record coordinates we already trust so they are never re-geocoded.

        sync.py calls this for every address that already has coordinates, from
        the listings table and from the retired exporter's output. That is what
        makes an existing pin immune to geocoder drift: the network is only ever
        touched for an address seen for the first time.
        """
        key = normalize_address(address)
        if key and key not in self.cache:
            self.cache[key] = {"lat": lat, "lon": lon, "relevance": None, "preseeded": True}

    def lookup(self, address: str, area: str = "") -> tuple[float | None, float | None, float | None]:
        key = normalize_address(address)
        if key in self.cache:
            hit = self.cache[key]
            if hit is None:
                return None, None, None
            return hit.get("lat"), hit.get("lon"), hit.get("relevance")
        result = self._query(address, area)
        self.cache[key] = result
        self._dirty = True
        if result is None:
            self.failed.append(address)
            return None, None, None
        if (result.get("relevance") or 0) < 0.8:
            self.low_confidence.append(address)
        return result.get("lat"), result.get("lon"), result.get("relevance")

    def _query(self, address: str, area: str) -> dict[str, Any] | None:
        if not self.token:
            return None
        street = _clean(address).split(",")[0]
        parts = [street, _clean(area), "Ontario", "Canada"]
        query = ", ".join(p for p in parts if p)
        url = (
            "https://api.mapbox.com/geocoding/v5/mapbox.places/"
            f"{urllib.parse.quote(query)}.json"
            f"?limit=1&country=ca&access_token={urllib.parse.quote(self.token)}"
        )
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
                payload = json.load(resp)
        except (urllib.error.URLError, ValueError, TimeoutError):
            return None
        features = payload.get("features") or []
        if not features:
            return None
        feature = features[0]
        lon, lat = feature.get("center", [None, None])[:2]
        relevance = feature.get("relevance")
        if lat is None or lon is None:
            return None
        west, south, east, north = SEARCH_BBOX
        if not (west <= lon <= east and south <= lat <= north):
            return None  # same street name, wrong county
        if relevance is not None and relevance < MIN_RELEVANCE:
            return None
        time.sleep(0.1)  # courtesy pacing, only ever hit for brand-new addresses
        return {"lat": round(lat, 7), "lon": round(lon, 7), "relevance": relevance,
                "place_name": feature.get("place_name")}


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

class ListingSource:
    """The interface every data source implements."""

    name = "base"

    def fetch_listings(self) -> list[dict[str, Any]]:
        raise NotImplementedError


REQUIRED_COLUMNS = ("Address", "Link", "Price")


class SheetSource(ListingSource):
    """The family's House Hunter Google Sheet, read as a public CSV export.

    CSV export rather than the Sheets API on purpose: it needs no OAuth client,
    no service-account key and no pip packages, which keeps the server inside
    its stdlib-only constraint. The tradeoff is that the sheet has to stay
    link-viewable, which it already is.
    """

    name = "sheet"

    def __init__(self, url: str | None = None, geocoder: Geocoder | None = None) -> None:
        self.url = url or appconfig.sheet_csv_url()
        self.geocoder = geocoder

    def fetch_rows(self) -> list[dict[str, str]]:
        req = urllib.request.Request(self.url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
                raw = resp.read()
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise SourceError(f"sheet unreachable: {exc}") from exc

        text = raw.decode("utf-8", "replace")
        if text.lstrip().startswith("<"):
            # An HTML body here means a sign-in or error page, not data.
            raise SourceError("sheet returned HTML, not CSV (is it still link-viewable?)")
        rows = list(csv.reader(io.StringIO(text)))
        if not rows:
            raise SourceError("sheet export was empty")
        header = [h.strip() for h in rows[0]]
        missing = [c for c in REQUIRED_COLUMNS if c not in header]
        if missing:
            raise SourceError(f"sheet is missing expected columns: {', '.join(missing)}")
        out = []
        for index, row in enumerate(rows[1:], start=2):
            if not any(cell.strip() for cell in row):
                continue
            record = dict(zip(header, row))
            record["_sheet_row"] = str(index)
            out.append(record)
        return out

    def fetch_listings(self) -> list[dict[str, Any]]:
        rows = self.fetch_rows()
        geocoder = self.geocoder
        records = []
        for row in rows:
            record = self.to_record(row, geocoder)
            if record is not None:
                records.append(record)
        if geocoder is not None:
            geocoder.save()
        if not records:
            raise SourceError("sheet parsed but produced no usable rows")
        return records

    @staticmethod
    def to_record(row: dict[str, str], geocoder: Geocoder | None = None) -> dict[str, Any] | None:
        address = _clean(row.get("Address"))
        link = _clean(row.get("Link"))
        source_key = listing_key_from_link(link)
        if not address or not source_key:
            return None  # nothing stable to key on, skip rather than invent one

        price_num = money(row.get("Price"))
        beds_display, beds_num = parse_beds(row.get("Beds"))
        sqft_display, sqft_num = parse_sqft(row.get("Sqft Above Grade"))
        frontage, depth = parse_lot(row.get("Lot Size"), row.get("Frontage"))
        acres = acres_from(frontage, depth, row.get("Acreage"))
        fit = _clean(row.get("Fit Score"))
        met = fit_met(fit)
        station = _clean(row.get("Nearest GO Station"))
        go_min = number(row.get("GO Drive Time Min"))
        go_train = intish(row.get("GO Train Min"))
        if go_train is None and station:
            go_train = STATION_TRAIN_MIN.get(station)
        go_total = intish(row.get("Total to Union Min"))
        if go_total is None and go_min is not None and go_train is not None:
            go_total = int(round(go_min + go_train))

        lat = lon = relevance = None
        if geocoder is not None:
            lat, lon, relevance = geocoder.lookup(address, _clean(row.get("Area")))

        return {
            "source_key": source_key,
            "sheetRow": intish(row.get("_sheet_row")),
            "address": address,
            "town": _clean(row.get("Town")),
            "area": _clean(row.get("Area")),
            "mlsNumber": _clean(row.get("MLS Number")),
            "lat": lat,
            "lon": lon,
            "geocodeRelevance": relevance,
            "price": _clean(row.get("Price")),
            "priceNum": price_num,
            "beds": beds_display,
            "bedsNum": beds_num,
            "baths": _clean(row.get("Baths")),
            "bathsNum": number(row.get("Baths")),
            "sqft": sqft_display,
            "sqftNum": sqft_num,
            "lot": _clean(row.get("Lot Size")),
            "frontageNum": frontage,
            "depthNum": depth,
            "acres": acres,
            "acresNum": acres,
            "yearBuilt": _clean(row.get("Year Built")),
            "heating": _clean(row.get("Heating")),
            "water": _clean(row.get("Water")),
            "sewer": _clean(row.get("Sewer or Septic")),
            "stories": _clean(row.get("Stories")),
            "fit": fit,
            "fitMet": met,
            "met": met,
            "tier": tier_for(met),
            "go": station,
            "goMin": go_min,
            "goMinNum": go_min,
            "goTrain": go_train,
            "goTotal": go_total,
            "features": _clean(row.get("Features")),
            "status": _clean(row.get("Status")),
            "link": link,
            "doc": _clean(row.get("Research Doc Link")),
            "image": _clean(row.get("Image")),
            "addedBy": _clean(row.get("Added By")),
            "dateAdded": _clean(row.get("Date Added")),
            "markRank": intish(row.get("Mark Rank /5")) or "",
            "katieRank": intish(row.get("Katie Rank /5")) or "",
            "markComments": _clean(row.get("Mark Comments")),
            "katieComments": _clean(row.get("Katie Comments")),
            "realtorComments": _clean(row.get("Realtor Comments")),
            "rejBy": _clean(row.get("Rejected By")),
            "rejReason": _clean(row.get("Reject Reason")),
            "pit": _clean(row.get("Monthly PIT")),
            "pitNum": money(row.get("Monthly PIT")),
            "dueClosing": _clean(row.get("Total Due on Closing")),
            "dueNum": money(row.get("Total Due on Closing")),
            "annualTaxes": money(row.get("Annual Taxes")),
            "mortgageAmount": money(row.get("Mortgage Amount")),
            "downPayment": money(row.get("Down Payment $")),
            "listingAgent": _clean(row.get("Listing Agent")),
            "brokerage": _clean(row.get("Brokerage")),
            "currentDom": intish(row.get("Current DOM")),
            "totalDom": intish(row.get("Total DOM")),
        }


class RepliersSource(ListingSource):
    """Placeholder for the paid Repliers feed.

    Present so DATA_SOURCE=repliers is a real, selectable path today rather
    than a code change later. It raises instead of returning data because no
    Canadian Repliers licence exists yet; the sync records the error and the
    app keeps serving whatever it already has, which is the same failure
    behaviour as an unreachable sheet.
    """

    name = "repliers"

    def fetch_listings(self) -> list[dict[str, Any]]:
        raise SourceError(
            "DATA_SOURCE=repliers is selected but no live Repliers listing feed is "
            "configured yet. Set DATA_SOURCE=sheet until Canadian access is licensed."
        )


def get_source(name: str | None = None, geocoder: Geocoder | None = None) -> ListingSource:
    """Resolve DATA_SOURCE to an adapter."""
    chosen = (name or appconfig.DATA_SOURCE or "sheet").strip().lower()
    if chosen == "sheet":
        return SheetSource(geocoder=geocoder)
    if chosen == "repliers":
        return RepliersSource()
    raise SourceError(f"unknown DATA_SOURCE {chosen!r}, expected 'sheet' or 'repliers'")
