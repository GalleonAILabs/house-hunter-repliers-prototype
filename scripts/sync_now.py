#!/usr/bin/env python3
"""Entry point for a scheduled or command-line listing import.

Called by the LaunchAgent ai.galleonglobal.househunter-sync once an hour, and
runnable by hand. It calls the same sync.run_sync() the in-app refresh button
calls, so there is exactly one import implementation.

Why hourly plus a timezone gate rather than four launchd calendar entries:
StartCalendarInterval fires on the machine's local time. If this Mac's
timezone is ever changed, four fixed entries would silently drift off the
06/10/14/18 America/Toronto schedule the family is told to expect. Waking each
hour and asking zoneinfo what time it is in Toronto makes the schedule correct
by construction, including across both daylight-saving changeovers. A skipped
wake-up costs a few milliseconds.

Usage:
  python3 scripts/sync_now.py            # run only at a scheduled Toronto hour
  python3 scripts/sync_now.py --force    # run now regardless of the hour
  python3 scripts/sync_now.py --status   # print the last few runs and exit
"""
from __future__ import annotations

import datetime
import json
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import appconfig  # noqa: E402
import sync  # noqa: E402


def toronto_now() -> datetime.datetime:
    return datetime.datetime.now(ZoneInfo(appconfig.SYNC_TIMEZONE))


def main(argv: list[str]) -> int:
    force = "--force" in argv
    status_only = "--status" in argv
    trigger = "manual-cli" if force else "scheduled"

    if status_only:
        conn = appconfig.get_conn()
        try:
            sync.init_sync_schema(conn)
            print(json.dumps(sync.recent_runs(conn, 10), indent=2))
        finally:
            conn.close()
        return 0

    now = toronto_now()
    if not force and now.hour not in appconfig.SYNC_HOURS:
        return 0  # not a scheduled hour, nothing to do and nothing to log

    run = sync.run_sync(trigger=trigger)
    stamp = now.strftime("%Y-%m-%d %H:%M %Z")
    print(
        f"[{stamp}] sync {run.get('status')} source={run.get('source')} "
        f"trigger={run.get('trigger')} seen={run.get('rows_seen')} "
        f"added={run.get('rows_added')} changed={run.get('rows_changed')} "
        f"inactive={run.get('rows_inactive')}"
        + (f" error={run.get('error')}" if run.get("error") else ""),
        flush=True,
    )
    # Exit 0 even on a failed import. The contract is that a bad sheet leaves
    # the app serving what it already has; a non-zero exit would make launchd
    # treat a normal outage as a crash worth restarting.
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
