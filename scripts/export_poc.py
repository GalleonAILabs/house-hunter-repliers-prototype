#!/usr/bin/env python3
"""Export the existing House Hunter POC sheet into local JSON.

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
