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

## Dev workstation auto-open routine (VS Code + Claude Code)

Beyond the app server and the tunnel, the workstation itself rebuilds its
working state at login: two VS Code windows open, each with a Claude Code
session running, and both sessions become reachable from the Claude mobile app
Code tab within a few minutes of power returning. No manual steps.

This is developer convenience, not part of serving House Hunter to users. The
app is live for phones as soon as the server LaunchAgent and the tunnel are up
(the two processes above); the VS Code and Claude Code chain below only
restores Mark's dev cockpit.

### What comes back, in order

| Piece | What it is | Auto-starts | Kept alive |
|---|---|---|---|
| VS Code windows (House Hunter + MASS) | Per-user LaunchAgent `ai.galleonglobal.vscode-autolaunch` runs `open-project-windows.sh` | At **login** | No (one-shot, RunAtLoad only) |
| Claude Code in each window | `.vscode/tasks.json` task, `runOn: folderOpen` | On each window open | No (interactive session) |
| Mobile reachability | Claude Code Remote Control (persisted `/config` setting) | With each session | N/A |

### The chain

1. **`ai.galleonglobal.vscode-autolaunch` (LaunchAgent, per-user, login).**
   Plist at `~/Library/LaunchAgents/ai.galleonglobal.vscode-autolaunch.plist`,
   source copy in `scripts/launchagents/`. `RunAtLoad` with no `KeepAlive`: it
   is a one-shot job that fires once at login, not a kept-alive daemon. It runs
   the deployed script at
   `~/Library/Application Support/Galleon/vscode-autolaunch/open-project-windows.sh`
   (source in `scripts/open-project-windows.sh`).

2. **`open-project-windows.sh`.** Same Drive-mount problem as the server: the
   project folders live on the `CloudStorage` mount that only exists after
   login and can be slow on a cold boot. The script polls for both project
   paths (up to ~120s), waits a 5s settle, then opens each project in its own
   window with `code --new-window`: House Hunter first, then MASS
   (`projects/cgai/mass/mass-incident-report`). Logs to
   `~/Library/Logs/vscode-autolaunch.log` (and the plist mirrors stdout/stderr
   to `vscode-autolaunch.out.log` / `.err.log`).

3. **`.vscode/tasks.json` (per project).** Each project ships a task labelled
   "Launch Claude Code" with `runOptions.runOn: folderOpen`, so opening the
   window starts `claude` in a dedicated panel. House Hunter's is committed at
   `.vscode/tasks.json`; MASS has its own copy in that repo.

4. **Claude Code Remote Control.** Remote Control for all sessions is enabled
   in Claude Code via `/config`. That is a persisted user setting (stored in
   `~/.claude.json`), so it survives reboots and does not need to be re-toggled.
   With it on, each auto-started session registers itself and appears in the
   Claude mobile app Code tab within a few minutes of the session starting, so
   both projects are reachable from the phone with no action at the Mac.

### One-time approvals (not automatic)

Two prompts are one-time, per-machine, and only appear the first time. They are
not part of the recurring reboot path once accepted, but a freshly rebuilt Mac
(MM2 nuke-and-rebuild) will show them again:

- VS Code asks once per project to **allow automatic tasks** before it will run
  the `folderOpen` task. Until allowed, Claude Code will not auto-start in that
  window. Accept it once per project.
- The Claude mobile app connection relies on the account already being signed
  in on both the Mac and the phone; Remote Control does not re-authenticate.

### Managing the auto-open LaunchAgent

```bash
PLIST=~/Library/LaunchAgents/ai.galleonglobal.vscode-autolaunch.plist

# Check it is loaded
launchctl list | grep vscode-autolaunch

# Reload (also what you do after editing the script or plist)
launchctl unload -w "$PLIST" && launchctl load -w "$PLIST"

# Run the open routine by hand without waiting for a login
bash ~/Library/Application\ Support/Galleon/vscode-autolaunch/open-project-windows.sh

# Tail its log
tail -f ~/Library/Logs/vscode-autolaunch.log
```

If the windows do not open after a login, check the log: the usual cause is
the Drive mount not being ready within the ~120s poll (the script logs
`ERROR: drive not ready` and aborts). Log in, confirm the mount, and reload the
plist or run the script by hand.
