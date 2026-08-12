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
# Nominatim's usage policy requires a User-Agent that identifies the
# application and offers a way to make contact.
USER_AGENT = "house-hunter-sync/1.0 (+https://househunter.galleonglobal.ai)"
NOMINATIM_MIN_INTERVAL_S = 1.1


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


# Coordinates the family enters in the sheet win over anything a geocoder
# says. Several spellings are accepted so the columns can be added without
# anyone having to match an exact string.
LAT_COLUMNS = ("Latitude", "Lat", "latitude", "lat")
LON_COLUMNS = ("Longitude", "Longitude ", "Lon", "Lng", "Long", "longitude", "lon", "lng")
# Ontario, generously bounded. A hand-typed coordinate that lands outside this
# is a typo (a dropped minus sign puts an Ontario house in Kazakhstan), and a
# typo must fall back to geocoding rather than move a pin across the world.
ONTARIO_BOUNDS = (41.5, 57.0, -95.5, -74.0)  # south, north, west, east


def first_present(row: dict[str, str], names: tuple[str, ...]) -> str:
    for name in names:
        if row.get(name):
            return str(row[name])
    return ""


def sheet_coordinates(row: dict[str, str]) -> tuple[float | None, float | None, str]:
    """Coordinates entered in the sheet, if usable. Returns (lat, lon, note).

    note is empty when the row simply has no coordinates, and carries a reason
    when values were present but rejected, so a typo is reported rather than
    silently ignored.
    """
    raw_lat = first_present(row, LAT_COLUMNS)
    raw_lon = first_present(row, LON_COLUMNS)
    if not raw_lat and not raw_lon:
        return None, None, ""
    if not raw_lat or not raw_lon:
        return None, None, "only one of latitude/longitude was filled in"
    lat, lon = number(raw_lat), number(raw_lon)
    if lat is None or lon is None:
        return None, None, f"could not read {raw_lat!r}, {raw_lon!r} as numbers"
    south, north, west, east = ONTARIO_BOUNDS
    if not (south <= lat <= north and west <= lon <= east):
        return None, None, f"{lat}, {lon} is outside Ontario"
    return round(lat, 7), round(lon, 7), ""


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

# Geocode acceptance thresholds (GAL-92). Both are measured, not guessed.
#
# TOWN_RADIUS_KM: across the 105 listings whose coordinates were already known
# good, the furthest any listing sits from the centroid of others in the same
# town is 19.0 km (p95 12.7). Townships are large, so 25 km leaves headroom
# without being loose: the wrong-county failure it has to reject is 247 km out.
TOWN_RADIUS_KM = 25.0
# MAX_IMPLIED_KMH: the sheet gives a nearest GO station and a drive time, and
# station coordinates are already in the map layer, so a candidate point can be
# cross-examined: does the straight-line distance make sense for that drive?
# Across 101 trusted listings the implied speed is median 41.5 and never exceeds
# 61.3 km/h. 90 leaves a wide margin for a faster highway route while still
# rejecting decisively: a Clearview listing mismatched to Ottawa implies 467.
MAX_IMPLIED_KMH = 90.0
MIN_RELEVANCE = 0.5
# Two independent geocoders landing within this distance of each other is
# treated as corroboration. Anything further apart is still used, but is
# reported for a human to glance at.
CROSS_PROVIDER_AGREE_KM = 1.0

# TREB district codes arrive in the Area column looking like
# "1064 - ES Rural Esquesing". The leading code is not part of any place name.
_DISTRICT_CODE_RE = re.compile(r"^\s*\d+\s*-\s*[A-Z]{1,3}\s+")


def clean_locality(area: str, town: str) -> str:
    """The Area column as a place a geocoder can actually find.

    Rural rows carry "Rural Clearview", which is not a place name and makes the
    query worse rather than sharper. Strip that and any TREB district code, and
    fall back to Town when nothing usable is left.
    """
    text = _DISTRICT_CODE_RE.sub("", _clean(area))
    text = re.sub(r"^\s*Rural\b\s*", "", text, flags=re.I).strip()
    return text or _clean(town)


# MLS street-type abbreviations as they actually appear in the sheet, surveyed
# across all 149 addresses rather than guessed. Sent verbatim, several of these
# return nothing at all from Nominatim: "6536 5th Sdrd, Essa" is a miss,
# "6536 5 Sideroad, Essa" is an exact hit.
STREET_ABBREVIATIONS = {
    "rd": "Road", "dr": "Drive", "st": "Street", "ave": "Avenue",
    "cres": "Crescent", "sdrd": "Sideroad", "crt": "Court", "tr": "Trail",
    "terr": "Terrace", "twnl": "Townline", "clse": "Close", "pt": "Point",
    "circ": "Circle", "blvd": "Boulevard", "pl": "Place", "conc": "Concession",
    "ln": "Lane", "hts": "Heights", "sq": "Square", "pkwy": "Parkway",
}
DIRECTIONALS = {"e": "East", "w": "West", "n": "North", "s": "South"}
# Ordinal words that appear as road names in the sheet ("Fifteenth Sdrd").
ORDINAL_WORDS = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6,
    "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10, "eleventh": 11,
    "twelfth": 12, "thirteenth": 13, "fourteenth": 14, "fifteenth": 15,
    "sixteenth": 16, "seventeenth": 17, "eighteenth": 18, "nineteenth": 19,
    "twentieth": 20,
}
_ORDINAL_DIGIT_RE = re.compile(r"\b(\d+)(?:st|nd|rd|th)\b", re.I)
_HOUSE_NUMBER_RE = re.compile(r"^\s*(\d+[A-Za-z]?)\s+")
# Roads that are numbered rather than named, where Ontario and OSM disagree on
# word order: the sheet's "15th Sdrd" is "15 Sideroad" or "Sideroad 15".
_NUMBERED_ROAD_RE = re.compile(
    r"^(?P<num>\d+)\s+(?P<kind>Sideroad|Line|Concession|Townline)\b(?P<rest>.*)$", re.I
)


def expand_street(street: str) -> str:
    """Abbreviations out, real words in, ordinals as plain numbers."""
    words = []
    for word in _clean(street).split():
        bare = word.strip(".,").lower()
        if bare in STREET_ABBREVIATIONS:
            words.append(STREET_ABBREVIATIONS[bare])
        elif bare in ORDINAL_WORDS:
            words.append(str(ORDINAL_WORDS[bare]))
        elif bare in DIRECTIONALS and words:
            words.append(DIRECTIONALS[bare])
        else:
            words.append(word.strip(","))
    # "Concession 7 Conc" expands to "Concession 7 Concession". The trailing
    # abbreviation was a redundant street-type suffix, so drop it when the same
    # word is already in the name.
    if len(words) > 1 and words[-1].lower() in {w.lower() for w in words[:-1]}:
        words = words[:-1]
    return _ORDINAL_DIGIT_RE.sub(r"\1", " ".join(words))


def street_variants(street: str) -> list[str]:
    """Ways of writing one street, best first, de-duplicated.

    A numbered rural road is the case that matters. The sheet writes "15th
    Sdrd"; OSM carries it as "Sideroad 15" in one township and "15 Sideroad" in
    the next, so both orderings get a turn before giving up on the address.
    """
    expanded = expand_street(street)
    variants = [expanded]

    house = ""
    match = _HOUSE_NUMBER_RE.match(expanded)
    body = expanded
    if match:
        house = match.group(1)
        body = expanded[match.end():]

    numbered = _NUMBERED_ROAD_RE.match(body)
    if numbered:
        swapped = f"{numbered.group('kind').title()} {numbered.group('num')}{numbered.group('rest')}"
        variants.append(f"{house} {swapped}".strip())
    if _clean(street) != expanded:
        variants.append(_clean(street))  # last resort: exactly what the sheet said
    return list(dict.fromkeys(v for v in (v.strip() for v in variants) if v))


def road_only(street: str) -> str:
    """The street with its house number removed, for an approximate pin."""
    return _HOUSE_NUMBER_RE.sub("", expand_street(street)).strip()


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    (lat1, lon1), (lat2, lon2) = a, b
    radius = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(h))


class Geocoder:
    """Mapbox forward geocoding, cross-examined against what the sheet already
    knows about each listing.

    An address that already has coordinates is never re-geocoded, so every
    existing pin is immune to anything here. For a genuinely new address, a
    single geocoder result is not trusted on its own: raw Mapbox happily
    returns a same-named street in another county ("18 Mill St, Essa" resolves
    to Odessa, 300 km away) and it also returns perfectly good matches that are
    named for the settlement rather than the township the sheet uses
    (Sundridge for Strong, Stayner for Clearview). A plain distance box gets
    both of those wrong in opposite directions.

    So each candidate is put through the checks that apply to it, and accepted
    only if at least one confirms it and none contradicts it:

      trusted neighbours  Listings in the same town whose coordinates are
                          already trusted. The strongest signal, and free.
      go_drive            The sheet names a GO station and a drive time, and
                          station coordinates are in the map layer, so the
                          straight-line distance has to be plausible for that
                          drive. Independent of any naming question.
      town centre         Only when the town has no trusted listings yet, and
                          only if the town lookup names the town back (that
                          check is what rejects "Adjala-Tosorontio" silently
                          resolving to the middle of Ontario).
      name match          The result's own context names the town or area.

    A candidate no check can speak to is left unresolved rather than guessed:
    a listing with no pin is honest, a pin in the wrong county is not.
    """

    def __init__(
        self,
        token: str,
        town_anchors: dict[str, tuple[float, float]] | None = None,
        stations: dict[str, tuple[float, float]] | None = None,
    ) -> None:
        self.token = token
        # town -> centroid of already-trusted listings in that town
        self.town_anchors = town_anchors or {}
        # GO station name -> coordinate, from the map layer
        self.stations = stations or {}
        self.cache: dict[str, Any] = {}
        self.low_confidence: list[str] = []
        self.failed: list[str] = []
        # Sheet coordinates that could not be used (typo, half-filled, out of
        # range). Reported by the run rather than silently ignored.
        self.rejected_coordinates: list[str] = []
        # normalized address -> which checks confirmed it, so the record can
        # carry its own provenance and anchors can exclude weak results.
        self.confirmations: dict[str, list[str]] = {}
        # normalized address -> which geocoder produced it. Absent means the
        # coordinate was preseeded, i.e. already trusted and never looked up.
        self.providers: dict[str, str | None] = {}
        # normalized address -> "address" (the house) or "road" (the street it
        # is on, when the house number could not be placed).
        self.precisions: dict[str, str] = {}
        self._town_centres: dict[str, tuple[float, float] | None] = {}
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

    def lookup(
        self,
        address: str,
        area: str = "",
        town: str = "",
        go_station: str = "",
        go_min: float | None = None,
    ) -> tuple[float | None, float | None, float | None]:
        key = normalize_address(address)
        if key in self.cache:
            hit = self.cache[key]
            if hit is None:
                return None, None, None
            return hit.get("lat"), hit.get("lon"), hit.get("relevance")
        result = self._resolve(address, area, town, go_station, go_min)
        self.cache[key] = result
        self._dirty = True
        if result is None:
            self.failed.append(address)
            return None, None, None
        self.confirmations[normalize_address(address)] = list(result.get("confirmed_by") or [])
        self.providers[normalize_address(address)] = result.get("provider")
        self.precisions[normalize_address(address)] = result.get("precision", "address")
        if "cross-provider" not in (result.get("confirmed_by") or []):
            # Measured against known-good coordinates, every corroborated result
            # was within 300 m, and every multi-kilometre miss was one the two
            # geocoders disagreed on. So this is the line worth reporting.
            self.low_confidence.append(address)
        return result.get("lat"), result.get("lon"), result.get("relevance")

    def _fetch_osm(self, query: str, limit: int = 3) -> list[dict[str, Any]]:
        """Nominatim, normalized into the same candidate shape as Mapbox.

        Primary provider, because it is demonstrably the one the retired
        pipeline used: on a 24-address sample, 21 of its results are identical
        to the stored coordinates to the last decimal and none is worse than
        270 m. Using it keeps a new pin consistent with the 105 already on the
        map instead of introducing a second source's idea of the same street.
        Its display_name also names the township as well as the settlement
        ("Sundridge, Strong Township"), which is what the naming checks need.
        """
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
            {"q": query, "format": "json", "limit": limit,
             "countrycodes": "ca", "addressdetails": 1}
        )
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
                payload = json.load(resp)
        except (urllib.error.URLError, ValueError, TimeoutError, OSError):
            return []
        # Nominatim's usage policy caps this at one request a second. Only ever
        # reached for an address seen for the first time.
        time.sleep(NOMINATIM_MIN_INTERVAL_S)
        out = []
        for hit in payload:
            try:
                lat, lon = float(hit["lat"]), float(hit["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            name = hit.get("display_name", "")
            out.append({
                "center": [lon, lat],
                "place_name": name,
                # importance is 0..1 and ranks results, close enough in spirit
                # to Mapbox relevance for the shared minimum-quality gate.
                "relevance": round(float(hit.get("importance") or 0.5), 3),
                "context": [{"text": part.strip()} for part in name.split(",")],
                "provider": "osm",
            })
        return out

    def _fetch(self, query: str, types: str | None = "address", limit: int = 5) -> list[dict[str, Any]]:
        if not self.token:
            return []
        url = (
            "https://api.mapbox.com/geocoding/v5/mapbox.places/"
            f"{urllib.parse.quote(query)}.json?limit={limit}&country=ca"
            + (f"&types={types}" if types else "")
            + f"&access_token={urllib.parse.quote(self.token)}"
        )
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
                payload = json.load(resp)
        except (urllib.error.URLError, ValueError, TimeoutError, OSError):
            return []
        time.sleep(0.1)  # courtesy pacing, only ever hit for brand-new addresses
        return payload.get("features") or []

    def town_centre(self, town: str) -> tuple[float, float] | None:
        """Coordinate for a municipality, but only if the lookup names it back.

        Without the name check this quietly returns the middle of the province
        for a township Mapbox does not carry: "Adjala-Tosorontio, Ontario"
        answers with plain "Ontario, Canada", 678 km from the real place.
        """
        town = _clean(town)
        if not town:
            return None
        if town in self._town_centres:
            return self._town_centres[town]
        centre = None
        for feature in self._fetch(f"{town}, Ontario, Canada", types="place,locality,district", limit=3):
            if normalize_address(town).replace(" ", "") in normalize_address(
                feature.get("place_name", "")
            ).replace(" ", ""):
                lon, lat = feature.get("center", [None, None])[:2]
                if lat is not None:
                    centre = (lat, lon)
                break
        self._town_centres[town] = centre
        return centre

    def station_coord(self, name: str) -> tuple[float, float] | None:
        name = _clean(name)
        return self.stations.get(name) or self.stations.get(name.replace(" GO", "").strip())

    def _judge(
        self, lat: float, lon: float, town: str, area: str, feature: dict[str, Any],
        go_station: str, go_min: float | None,
    ) -> tuple[bool, list[str], list[str]]:
        """Run every applicable check. Returns (accepted, confirmed_by, failed)."""
        point = (lat, lon)
        confirmed: list[str] = []
        failed: list[str] = []

        anchor = self.town_anchors.get(_clean(town))
        if anchor:
            if haversine_km(point, anchor) <= TOWN_RADIUS_KM:
                confirmed.append("trusted-neighbours")
            else:
                failed.append("trusted-neighbours")

        station = self.station_coord(go_station)
        if station and go_min:
            implied = haversine_km(point, station) / (float(go_min) / 60.0)
            if implied <= MAX_IMPLIED_KMH:
                confirmed.append("go-drive")
            else:
                failed.append("go-drive")

        blob = normalize_address(
            " ".join([feature.get("place_name", "")]
                     + [c.get("text", "") for c in feature.get("context", [])])
        )
        for candidate in (town, clean_locality(area, town)):
            token = normalize_address(candidate)
            if token and token in blob:
                confirmed.append("name-match")
                break

        # Only consulted when the town has no trusted listings to compare
        # against, so it can never override real data.
        if not anchor:
            centre = self.town_centre(town)
            if centre:
                if haversine_km(point, centre) <= TOWN_RADIUS_KM:
                    confirmed.append("town-centre")
                else:
                    failed.append("town-centre")

        return (bool(confirmed) and not failed), confirmed, failed

    def _resolve(
        self, address: str, area: str, town: str, go_station: str, go_min: float | None
    ) -> dict[str, Any] | None:
        street = _clean(address).split(",")[0]
        locality = clean_locality(area, town)
        # Every sensible spelling of the street crossed with every sensible
        # name for the place. Rural addresses often only resolve under the
        # settlement name, and a numbered sideroad only under one particular
        # word order, so these are real alternatives rather than duplicates.
        queries = []
        for spelling in street_variants(street):
            for loc in dict.fromkeys([locality, _clean(town)]):
                if loc:
                    queries.append(f"{spelling}, {loc}, Ontario, Canada")
        queries.append(f"{_clean(address)}, Ontario, Canada")

        def best_from(fetch) -> dict[str, Any] | None:
            fallback = None
            for query in queries:
                for feature in fetch(query):
                    lon, lat = feature.get("center", [None, None])[:2]
                    relevance = feature.get("relevance")
                    if lat is None or lon is None:
                        continue
                    # Only Mapbox's relevance means "how well did this match".
                    # Nominatim's importance ranks prominence, and a rural house
                    # scores low simply for being a rural house, so gating on it
                    # would throw away the most accurate results we get.
                    if (feature.get("provider") != "osm"
                            and relevance is not None and relevance < MIN_RELEVANCE):
                        continue
                    ok, confirmed, _failed = self._judge(
                        lat, lon, town, area, feature, go_station, go_min
                    )
                    if not ok:
                        continue
                    record = {
                        "lat": round(lat, 7), "lon": round(lon, 7), "relevance": relevance,
                        "place_name": feature.get("place_name"),
                        "provider": feature.get("provider", "mapbox"),
                        "confirmed_by": list(confirmed), "query": query,
                    }
                    if len(confirmed) >= 2:
                        return record
                    fallback = fallback or record
            return fallback

        # OpenStreetMap leads because it is the source the existing coordinates
        # came from; Mapbox is asked as well, as a second opinion.
        osm = best_from(self._fetch_osm)
        mapbox = best_from(self._fetch)

        chosen = osm or mapbox
        if chosen is None:
            # The exact house number cannot be placed. Fall back to the road it
            # is on, which for a rural fire number is still the honest answer to
            # "roughly where is this?". Flagged as approximate so it is never
            # read as the house, and never allowed to anchor another lookup.
            return self._resolve_road(street, area, town, go_station, go_min)
        # Two providers landing on the same spot is the strongest signal
        # available here, and its absence is the one that matters: every
        # multi-kilometre miss measured against known-good coordinates was a
        # case where the two disagreed. Recording it turns an invisible error
        # into a listing on the review list.
        if osm and mapbox:
            apart = haversine_km((osm["lat"], osm["lon"]), (mapbox["lat"], mapbox["lon"]))
            chosen["providers_apart_km"] = round(apart, 3)
            if apart <= CROSS_PROVIDER_AGREE_KM:
                chosen["confirmed_by"].append("cross-provider")
        chosen["precision"] = "address"
        return chosen

    def _resolve_road(
        self, street: str, area: str, town: str, go_station: str, go_min: float | None
    ) -> dict[str, Any] | None:
        """Locate the road rather than the house, as an explicitly rough pin."""
        road = road_only(street)
        if not road or road == expand_street(street):
            return None  # no house number to drop, so this adds nothing
        locality = clean_locality(area, town)
        for spelling in street_variants(road):
            for loc in dict.fromkeys([locality, _clean(town)]):
                if not loc:
                    continue
                query = f"{spelling}, {loc}, Ontario, Canada"
                for fetch in (self._fetch_osm, self._fetch):
                    for candidate in fetch(query):
                        lon, lat = candidate.get("center", [None, None])[:2]
                        if lat is None or lon is None:
                            continue
                        ok, confirmed, _failed = self._judge(
                            lat, lon, town, area, candidate, go_station, go_min
                        )
                        if not ok:
                            continue
                        return {
                            "lat": round(lat, 7), "lon": round(lon, 7),
                            "relevance": candidate.get("relevance"),
                            "place_name": candidate.get("place_name"),
                            "provider": candidate.get("provider", "mapbox"),
                            "confirmed_by": list(confirmed), "query": query,
                            "precision": "road",
                        }
        return None


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

        # A coordinate somebody entered in the sheet is the last word: no
        # geocoder is consulted for that row at all. This is the escape hatch
        # for the rural addresses no geocoder can place accurately, and it
        # works one row at a time, so the column can be filled in gradually.
        lat, lon, coord_note = sheet_coordinates(row)
        provider = "sheet" if lat is not None else None
        relevance = None
        confirmed: list[str] = ["sheet"] if lat is not None else []
        precision = "address"
        if lat is None and geocoder is not None:
            lat, lon, relevance = geocoder.lookup(
                address,
                area=_clean(row.get("Area")),
                town=_clean(row.get("Town")),
                go_station=station,
                go_min=go_min,
            )
            key = normalize_address(address)
            provider = geocoder.providers.get(key)
            confirmed = geocoder.confirmations.get(key, [])
            precision = geocoder.precisions.get(key, "address")
            if coord_note:
                geocoder.rejected_coordinates.append(f"{address}: {coord_note}")

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
            # Which independent checks agreed with this coordinate. Empty for a
            # preseeded (already trusted) address, which is never looked up.
            "geocodeConfirmedBy": confirmed,
            # None means preseeded: a coordinate we already held and trusted.
            # "sheet" means it was entered by hand and outranks every geocoder.
            "geocodeProvider": provider,
            # "road" means the pin marks the street, not the house. The card and
            # the map say so rather than letting it pass as an exact location.
            "geocodePrecision": precision,
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
