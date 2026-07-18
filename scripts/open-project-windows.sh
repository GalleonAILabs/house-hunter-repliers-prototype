#!/bin/bash
#
# open-project-windows.sh
#
# Opens the House Hunter and MASS projects in separate VS Code windows at
# login. Called by the per-user LaunchAgent
# ai.galleonglobal.vscode-autolaunch (RunAtLoad, no KeepAlive: one-shot).
#
# Both projects live on the Google Drive CloudStorage mount, which only
# appears after login and can take a while to mount on a cold boot. So we
# poll for the mount to exist before opening anything, then add a short
# settle delay, rather than a blind fixed sleep.
#
# Each folder is opened with `code --new-window` so it lands in its own
# window. Each project ships a .vscode/tasks.json that starts Claude Code on
# folder open (VS Code asks once per project to allow automatic tasks).

set -u

LOG="$HOME/Library/Logs/vscode-autolaunch.log"
CODE="/opt/homebrew/bin/code"
[ -x "$CODE" ] || CODE="/usr/local/bin/code"

DRIVE="$HOME/Library/CloudStorage/GoogleDrive-mark@galleonglobal.ai/My Drive/Galleon"
HOUSE_HUNTER="$DRIVE/projects/house-hunter-repliers-prototype"
MASS="$DRIVE/projects/cgai/mass/mass-incident-report"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

log "vscode-autolaunch: start"

# Wait for the Google Drive mount to be ready (up to ~120s), polling both
# project paths. Then a short settle delay so Drive metadata is stable.
ready=0
for i in $(seq 1 60); do
  if [ -d "$HOUSE_HUNTER" ] && [ -d "$MASS" ]; then
    ready=1
    log "drive ready after ${i} checks (~$((i*2))s)"
    break
  fi
  sleep 2
done

if [ "$ready" -ne 1 ]; then
  log "ERROR: drive not ready after ~120s; project paths missing, aborting"
  log "  checked: $HOUSE_HUNTER"
  log "  checked: $MASS"
  exit 1
fi

sleep 5   # settle delay

if [ ! -x "$CODE" ]; then
  log "ERROR: code CLI not found at /opt/homebrew/bin/code or /usr/local/bin/code, aborting"
  exit 1
fi

log "opening House Hunter window"
"$CODE" --new-window "$HOUSE_HUNTER" >> "$LOG" 2>&1

sleep 3

log "opening MASS window"
"$CODE" --new-window "$MASS" >> "$LOG" 2>&1

log "vscode-autolaunch: done"
