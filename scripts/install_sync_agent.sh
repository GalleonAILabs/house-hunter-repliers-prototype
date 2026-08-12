#!/usr/bin/env bash
# Install the scheduled listing-import LaunchAgent.
#
# The agent wakes at the top of every hour and runs scripts/sync_now.py, which
# imports only when the America/Toronto hour is one of the four scheduled ones
# (06:00, 10:00, 14:00, 18:00). See the header of sync_now.py for why the
# timezone gate lives in Python rather than in four launchd calendar entries.
#
# A per-user LaunchAgent, not a system LaunchDaemon, for the same reason the
# server is: the code and database live on the Google Drive mount, which only
# exists after login.
#
# Usage:
#   bash scripts/install_sync_agent.sh            # install and start
#   bash scripts/install_sync_agent.sh --uninstall
set -euo pipefail

LABEL="ai.galleonglobal.househunter-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-/opt/homebrew/bin/python3}"
LOG_DIR="$HOME/Library/Logs"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl unload -w "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL"
  exit 0
fi

if [[ ! -x "$PYTHON" ]]; then
  echo "ERROR: python3 not found at $PYTHON. Set PYTHON=/path/to/python3 and retry." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
	<dict>
		<key>Label</key>
		<string>$LABEL</string>
		<key>ProgramArguments</key>
		<array>
			<string>$PYTHON</string>
			<string>$REPO/scripts/sync_now.py</string>
		</array>
		<key>WorkingDirectory</key>
		<string>$REPO</string>
		<!-- Wakes hourly at :00. sync_now.py decides whether this hour is one
		     of the four scheduled America/Toronto pull times. -->
		<key>StartCalendarInterval</key>
		<dict>
			<key>Minute</key>
			<integer>0</integer>
		</dict>
		<key>RunAtLoad</key>
		<false/>
		<key>StandardOutPath</key>
		<string>$LOG_DIR/househunter-sync.out.log</string>
		<key>StandardErrorPath</key>
		<string>$LOG_DIR/househunter-sync.err.log</string>
	</dict>
</plist>
PLIST_EOF

launchctl unload -w "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo "Installed $LABEL"
echo "  plist:    $PLIST"
echo "  schedule: 06:00, 10:00, 14:00, 18:00 America/Toronto (hourly wake, gated in Python)"
echo "  logs:     $LOG_DIR/househunter-sync.{out,err}.log"
echo
echo "Check it is registered:  launchctl list | grep househunter-sync"
echo "Run one now by hand:     python3 scripts/sync_now.py --force"
echo "See recent runs:         python3 scripts/sync_now.py --status"
