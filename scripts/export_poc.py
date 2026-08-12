#!/usr/bin/env python3
"""RETIRED (GAL-91). Use scripts/sync_now.py instead.

This was the one-off exporter that produced data/poc_listings.json. It depends
on ~/.hermes/skills/family/house-hunter/scripts (config, gapi,
generate_static_map), which exists only on the machine it was written on, so it
raises ImportError anywhere else and had left the property list frozen at 105
rows. It is kept only as a record of where data/poc_listings.json came from;
that file is now just the bootstrap that maps legacy addresses to their POC-<n>
ids, and the listings table is authoritative.

The replacement reads the same sheet over its public CSV export with no Google
API client, imports on a schedule, and never touches user-generated data:

    python3 scripts/sync_now.py --force      # import now
    python3 scripts/sync_now.py --status     # recent runs

The output is intentionally gitignored. It may contain family ratings, comments,
research links, and financial columns. Do not commit it to the public prototype repo.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOUSE_HUNTER_SCRIPTS = Path.home() / ".hermes/skills/family/house-hunter/scripts"
sys.path.insert(0, str(HOUSE_HUNTER_SCRIPTS))

import config  # type: ignore
import gapi  # type: ignore
import generate_static_map  # type: ignore


def main() -> None:
    out = ROOT / "data" / "poc_listings.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    services = gapi.get_services()
    data = generate_static_map.build_data(services, config.SHEET_ID)
    payload = {
        "source": "House Hunter POC Google Sheet",
        "sheetId": config.SHEET_ID,
        "count": len(data.get("properties", [])),
        "properties": data.get("properties", []),
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(json.dumps({"ok": True, "path": str(out), "count": payload["count"]}))


if __name__ == "__main__":
    main()
