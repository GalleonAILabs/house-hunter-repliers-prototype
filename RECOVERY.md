# RECOVERY.md: House Hunter reboot and recovery runbook

What runs House Hunter, what comes back on its own after a power cut or
restart, and the exact commands to check or restart each piece. This is the
single source of truth for reboot survival. CLAUDE.md points here.

## The one-line answer

After an unexpected shutdown, House Hunter comes back on its own once the Mac
is **logged in**. No terminal commands are needed. Confirm with:

```bash
bash scripts/healthcheck.sh
```

Exit 0 means the whole chain is healthy.

## The two processes

House Hunter is two long-running processes plus a SQLite database. There are
no watchers, cron jobs, or queues.

| Piece | What it is | Auto-starts | Kept alive |
|---|---|---|---|
| App server (`server.py`, port 8787) | Per-user LaunchAgent `ai.galleonglobal.househunter-server` | At **login** | Yes (KeepAlive) |
| Public tunnel (`househunter.galleonglobal.ai`) | Root system LaunchDaemon `com.cloudflare.cloudflared` | At **boot** | Yes (KeepAlive) |

### Why the split (boot vs login)

The tunnel is a system LaunchDaemon, so it starts at boot before anyone logs
in. The server is a per-user LaunchAgent because `server.py` and the database
live on the Google Drive `CloudStorage` mount, and that mount only exists
after a user logs in. So:

- **A reboot that stops at the login screen will NOT bring the app up.** The
  account must actually be logged in. This is inherent to running from Drive.
- When launchd first tries to start the server at login, Google Drive may not
  have finished mounting yet. The server exits, and KeepAlive retries every
  ~10 seconds (ThrottleInterval) until the mount is ready. It self-heals; no
  action needed.
- The tunnel starts before the server and simply retries the origin
  (`localhost:8787`) until the server is up.

## Logs

Both processes log to the macOS-standard location (not the project folder, to
avoid Google Drive sync churn):

```
~/Library/Logs/househunter-server.out.log
~/Library/Logs/househunter-server.err.log
```

The tunnel logs to the system log (`log show --predicate 'process ==
"cloudflared"'`).

## Managing the server (LaunchAgent, per-user)

```bash
PLIST=~/Library/LaunchAgents/ai.galleonglobal.househunter-server.plist

# Check it is loaded (prints a line with the label if so)
launchctl list | grep househunter-server

# Stop
launchctl unload -w "$PLIST"

# Start
launchctl load -w "$PLIST"

# Restart (also what scripts/deploy.sh does after a code change)
launchctl unload -w "$PLIST" && launchctl load -w "$PLIST"

# Tail its error log
tail -f ~/Library/Logs/househunter-server.err.log
```

Note: the LaunchAgent does NOT hot-reload code. After editing `server.py` or
any `static/` asset, run `bash scripts/deploy.sh` (it reloads the agent and
verifies the live domain serves the new code).

## Managing the tunnel (LaunchDaemon, system, needs sudo)

```bash
# Check it is running
pgrep -fl "cloudflared.*tunnel run"

# Stop
sudo launchctl bootout system/com.cloudflare.cloudflared

# Start
sudo launchctl bootstrap system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
```

The tunnel maps `househunter.galleonglobal.ai` to `http://localhost:8787` per
`/etc/cloudflared/config.yml`. The server binds `127.0.0.1` only, so the
tunnel is required for external (phone) access.

## Healthcheck

```bash
bash scripts/healthcheck.sh
```

Checks, in order: the LaunchAgent is loaded, the local server answers, the
database passes `PRAGMA integrity_check` and is in WAL mode, the tunnel
process is running, and the public domain answers end to end. Exit 0 =
healthy; exit 1 = at least one check failed (each FAIL line names the fix).

## Database crash safety

`data/house_hunter.db` is SQLite in **WAL mode** with **synchronous = FULL**,
set explicitly on every connection in `server.py` (`get_db` and `init_db`).
This means a power cut mid-write cannot corrupt the database and cannot lose
the last committed transaction. On the next open after an unclean shutdown,
SQLite recovers the WAL automatically. No manual repair step is needed.

The database lives on the Google Drive mount (the `data/` folder is
gitignored, so Drive is its only off-machine copy). Running SQLite on a
cloud-sync filesystem is low-risk single-machine but not zero-risk, so take a
snapshot before risky work:

```bash
bash scripts/backup_db.sh
# writes data/backups/house_hunter.db.<YYYYMMDD-HHMMSS>.bak, verified
```

The backup is safe to run while the server is live (it checkpoints the WAL and
uses SQLite's online backup API). To restore: stop the server, copy a `.bak`
over `data/house_hunter.db`, restart.

```bash
PLIST=~/Library/LaunchAgents/ai.galleonglobal.househunter-server.plist
launchctl unload -w "$PLIST"
cp data/backups/house_hunter.db.<TS>.bak data/house_hunter.db
rm -f data/house_hunter.db-wal data/house_hunter.db-shm   # if present
launchctl load -w "$PLIST"
bash scripts/healthcheck.sh
```

## If something is down after a reboot

1. Run `bash scripts/healthcheck.sh` and read which check failed.
2. Server not loaded or not answering: `launchctl load -w` the plist (above),
   then check `~/Library/Logs/househunter-server.err.log`. If it logs a
   missing-path error, Google Drive has not mounted yet; wait and it
   self-heals, or confirm the account is logged in.
3. Tunnel not running: `sudo launchctl bootstrap` the daemon (above).
4. Database integrity_check not "ok": restore from `data/backups` (above).
