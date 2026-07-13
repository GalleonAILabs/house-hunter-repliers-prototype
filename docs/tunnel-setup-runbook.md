# Public-hosting runbook: named Cloudflare Tunnel + LaunchAgent

How to put a local, loopback-bound stdlib server on a permanent public
`*.galleonglobal.ai` URL, surviving reboots, on this Mac (the `galleonglobalai`
user account). This is the exact pattern that hosts
`househunter.galleonglobal.ai`, generalized so it can be replicated for another
project without touching the House Hunter setup.

The shape: a Python server bound to `127.0.0.1:<PORT>` (never exposed on the LAN)
sits behind a named Cloudflare Tunnel. The tunnel makes an outbound connection to
Cloudflare's edge, so no inbound ports, no router config, no static IP. Two OS
services keep it alive across reboots: a **per-user LaunchAgent** runs the server
(needs the Google Drive mount that only exists after login), and the tunnel runs
as either a **system LaunchDaemon** (House Hunter's choice, a machine singleton)
or its own **per-user LaunchAgent** (recommended for the second project, see
step 5).

---

## Parameters

Set these once and substitute throughout. Example values shown are for a
hypothetical second project; replace them.

| Variable        | Meaning                                   | Example                     |
| --------------- | ----------------------------------------- | --------------------------- |
| `PROJECT_NAME`  | short slug, used in labels/filenames      | `deal-tracker`              |
| `SUBDOMAIN`     | the public hostname                       | `dealtracker.galleonglobal.ai` |
| `PORT`          | loopback port the server listens on       | `8788`                      |
| `TUNNEL_NAME`   | Cloudflare tunnel name                     | `deal-tracker`              |
| `SERVER_PY`     | absolute path to the project's server.py   | `.../projects/deal-tracker/server.py` |
| `LABEL`         | LaunchAgent label                          | `ai.galleonglobal.dealtracker-server` |

Pick a `PORT` not already in use (House Hunter owns `8787`). Check with
`lsof -nP -iTCP:<PORT> -sTCP:LISTEN`.

**Reference (House Hunter, the working example this runbook is derived from):**
`PROJECT_NAME=house-hunter`, `SUBDOMAIN=househunter.galleonglobal.ai`,
`PORT=8787`, `TUNNEL_NAME=house-hunter`, tunnel UUID
`cd2a79c3-145f-4c17-8702-c56b18554230`, `LABEL=ai.galleonglobal.househunter-server`.

---

## What is one-time-per-machine vs per-project

The Cloudflare **account login** is already done on this Mac. It produced
`~/.cloudflared/cert.pem` (present since 2026-07-07). That cert authorizes
creating tunnels and editing DNS on the `galleonglobal.ai` zone. **A new project
on this same machine reuses it. You do not log in again.**

Everything else below (create a tunnel, write a config, route DNS, install
services) is **per-project** and can be done end to end by a Claude Code session
in the other project, because `cert.pem` already grants the needed zone
permissions. See the "Who does what" table at the end for the one case that
requires Mark.

---

## Step 0 (one-time-per-machine, ALREADY DONE here): account login

Skip this on this Mac. Documented only so it is reproducible on a fresh machine.

```bash
cloudflared tunnel login
```

Opens a browser. Mark must be signed into the Cloudflare account that owns the
`galleonglobal.ai` zone and authorize the cert for that zone. Writes
`~/.cloudflared/cert.pem`. This is the only step that strictly needs Mark and a
browser. Confirm it is already present before doing anything else:

```bash
ls -l ~/.cloudflared/cert.pem   # exists -> skip step 0 entirely
```

---

## Step 1: create the named tunnel

```bash
cloudflared tunnel create "${TUNNEL_NAME}"
```

This mints a tunnel UUID and writes its credentials file to
`~/.cloudflared/<UUID>.json` (a `-r--------` secret; do not commit, do not paste
its contents anywhere). Capture the UUID:

```bash
cloudflared tunnel list        # find the row for ${TUNNEL_NAME}, copy its ID
```

Call that UUID `${TUNNEL_UUID}` for the rest of the runbook.

Verify:

```bash
ls -l ~/.cloudflared/${TUNNEL_UUID}.json   # credentials exist
```

---

## Step 2: write the tunnel config

Create `~/.cloudflared/config-${PROJECT_NAME}.yml` (a per-project config file so
it never collides with House Hunter's `~/.cloudflared/config.yml`):

```yaml
tunnel: ${TUNNEL_UUID}
credentials-file: /Users/galleonglobalai/.cloudflared/${TUNNEL_UUID}.json

ingress:
  - hostname: ${SUBDOMAIN}
    service: http://localhost:${PORT}
  - service: http_status:404
```

The trailing `http_status:404` catch-all is required; cloudflared refuses a
config whose last ingress rule has a hostname.

> House Hunter uses the default filename `~/.cloudflared/config.yml`. That works
> only because it is the sole default-config tunnel on the box. For the second
> project, always use a distinct `config-${PROJECT_NAME}.yml` and pass it
> explicitly with `--config` so the two never fight over the default path.

Validate the file:

```bash
cloudflared tunnel --config ~/.cloudflared/config-${PROJECT_NAME}.yml ingress validate
```

---

## Step 3: route DNS (creates the proxied CNAME)

```bash
cloudflared tunnel route dns "${TUNNEL_NAME}" "${SUBDOMAIN}"
```

This uses `cert.pem`'s zone permissions to create a **proxied CNAME** record for
`${SUBDOMAIN}` on the `galleonglobal.ai` zone, pointing at
`${TUNNEL_UUID}.cfargotunnel.com`. No dashboard step needed; the cert already
authorizes it. If the record already exists it errors, in which case fix it in
the dashboard rather than forcing it.

Verify the record resolves (it will resolve to Cloudflare edge IPs, since it is
proxied):

```bash
dig +short ${SUBDOMAIN}
```

---

## Step 4: run the tunnel once, by hand, to prove ingress works

Before installing any service, confirm the server + tunnel path end to end.
First make sure the server is listening locally (start it however the project
does; see step 6 for the permanent version):

```bash
curl -fsS http://127.0.0.1:${PORT}/api/health      # local server answers
```

Then run the tunnel in the foreground:

```bash
cloudflared tunnel --config ~/.cloudflared/config-${PROJECT_NAME}.yml run "${TUNNEL_NAME}"
```

In another shell:

```bash
curl -fsS https://${SUBDOMAIN}/api/health          # public URL answers
```

If that returns the server's health JSON, the tunnel and DNS are correct. Stop
the foreground `cloudflared` with Ctrl-C; steps 5 and 6 make both sides
permanent.

---

## Step 5: make the tunnel survive reboots

The tunnel must come back after a restart. There are two supported ways. **Read
the caveat before choosing.**

### Caveat: the system service is a machine singleton, already taken

House Hunter's tunnel runs as a **system LaunchDaemon**
`/Library/LaunchDaemons/com.cloudflare.cloudflared.plist`, installed with
`cloudflared service install`. That command installs exactly one daemon and
copies one config into `/etc/cloudflared/`. **Do not run
`cloudflared service install` for the second project.** It would overwrite House
Hunter's `/etc/cloudflared/config.yml` and credentials and break the existing
site. The machine already has its one system tunnel daemon, and it belongs to
House Hunter.

So for the second project, choose one of these instead:

### Option A (recommended): run the new tunnel as its own per-user LaunchAgent

This mirrors how the *server* is run (a per-user LaunchAgent), keeps the two
projects fully independent, and never touches House Hunter's system daemon. The
only functional difference from a system LaunchDaemon is that this tunnel starts
at **login** rather than at **boot**, which is fine here: the server it fronts is
itself a per-user LaunchAgent that also only starts at login (it needs the Google
Drive mount, which does not exist until login). Both come up together.

Create `~/Library/LaunchAgents/ai.galleonglobal.${PROJECT_NAME}-tunnel.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>ai.galleonglobal.${PROJECT_NAME}-tunnel</string>
    <key>ProgramArguments</key>
    <array>
      <string>/opt/homebrew/bin/cloudflared</string>
      <string>--no-autoupdate</string>
      <string>--config</string>
      <string>/Users/galleonglobalai/.cloudflared/config-${PROJECT_NAME}.yml</string>
      <string>tunnel</string>
      <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>/Users/galleonglobalai/Library/Logs/${PROJECT_NAME}-tunnel.out.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/galleonglobalai/Library/Logs/${PROJECT_NAME}-tunnel.err.log</string>
  </dict>
</plist>
```

Load it:

```bash
launchctl load -w ~/Library/LaunchAgents/ai.galleonglobal.${PROJECT_NAME}-tunnel.plist
```

### Option B: add the hostname to the EXISTING House Hunter tunnel

The lightest option, but it couples the two projects. One tunnel can front many
hostnames. Add a second ingress rule to House Hunter's config (both the user copy
`~/.cloudflared/config.yml` and the daemon copy `/etc/cloudflared/config.yml`,
which requires `sudo`), route DNS for `${SUBDOMAIN}` to the `house-hunter`
tunnel, and restart the system daemon. No new service. Use this only if you
specifically want one tunnel process for the whole machine; otherwise prefer
Option A, which keeps the projects independent and matches the "new LaunchAgent
per project" intent.

---

## Step 6: run the server permanently (per-user LaunchAgent)

The server itself always runs as a **per-user LaunchAgent** (not a system
daemon), because `server.py` and its data live under the user's Google Drive
mount, which only exists after login. RunAtLoad + KeepAlive give login-start plus
auto-restart on crash.

Create `~/Library/LaunchAgents/${LABEL}.plist`
(`LABEL=ai.galleonglobal.${PROJECT_NAME}-server`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>ai.galleonglobal.${PROJECT_NAME}-server</string>
    <key>ProgramArguments</key>
    <array>
      <string>/opt/homebrew/bin/python3</string>
      <string>${SERVER_PY}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/galleonglobalai/.../projects/${PROJECT_NAME}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>/Users/galleonglobalai/Library/Logs/${PROJECT_NAME}-server.out.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/galleonglobalai/Library/Logs/${PROJECT_NAME}-server.err.log</string>
  </dict>
</plist>
```

Notes that make this work:
- Use the **full path** to `python3` (`/opt/homebrew/bin/python3`); LaunchAgents
  do not inherit your interactive `PATH`.
- The server reads its port from a `PORT` env var (default in code). This stdlib
  pattern is `PORT = int(os.getenv("PORT", "<default>"))` and it binds
  `ThreadingHTTPServer(("127.0.0.1", PORT), ...)`. If the project's default port
  is not `${PORT}`, either change the default in code or add an
  `EnvironmentVariables` dict to the plist setting `PORT`. The `127.0.0.1` bind
  is deliberate: the server is never on the LAN, the tunnel is the only way in.

Load it:

```bash
launchctl load -w ~/Library/LaunchAgents/${LABEL}.plist
```

---

## Step 7: verify every layer

Run these in order. Each proves one layer independent of the ones above it.

```bash
# 1. Local port answers (server LaunchAgent is up, bound to loopback)
curl -fsS http://127.0.0.1:${PORT}/api/health

# 2. Server is a managed service, not a stray process
launchctl list | grep ${PROJECT_NAME}-server        # non-blank, exit code 0-ish

# 3. Tunnel process is up and registered (Option A) ...
launchctl list | grep ${PROJECT_NAME}-tunnel
cloudflared tunnel info ${TUNNEL_NAME}              # shows active CONNECTIONS

# 4. DNS resolves to Cloudflare edge (proxied CNAME)
dig +short ${SUBDOMAIN}

# 5. Public domain serves the app end to end
curl -fsS https://${SUBDOMAIN}/api/health

# 6. Survives a service reload (simulates the reboot path)
launchctl unload -w ~/Library/LaunchAgents/${LABEL}.plist
launchctl load   -w ~/Library/LaunchAgents/${LABEL}.plist
sleep 3 && curl -fsS http://127.0.0.1:${PORT}/api/health   # server came back
curl -fsS https://${SUBDOMAIN}/api/health                  # public still works
```

For a true reboot test: log out and back in (or restart) and re-run checks 1 and
5. Both LaunchAgents are `RunAtLoad`, so both should be up after login with no
manual command.

---

## Step 8: adapt the deploy script (tunnel-aware parts)

If the second project copies `scripts/deploy.sh`, these are the parts that encode
House Hunter's tunnel and must be re-pointed. Everything else in that script is
generic (cache-bust token bump, commit/push, LaunchAgent reload, local health
wait).

1. **Header constants** (top of the script):
   ```bash
   PORT=8787                                   # -> ${PORT}
   HOST="househunter.galleonglobal.ai"         # -> ${SUBDOMAIN}
   PLIST=".../ai.galleonglobal.househunter-server.plist"   # -> ${LABEL}.plist
   ```
   `LIVE` and `LOCAL` derive from `HOST`/`PORT`, so they follow automatically.

2. **Live-domain verification block (step 4b).** It curls `${LIVE}/api/health`,
   checks the live `index.html` cache-bust token matches, checks a known API
   route returns 200, and compares live `app.js` bytes against the local origin.
   These assume specific routes (`/api/person-thresholds`) and asset names
   (`app.js`, `styles.css`). Re-point them at routes/assets the new project
   actually has, or drop the ones that do not apply.

3. **Exit-code-2 tunnel-down path.** When `${LIVE}/api/health` is unreachable the
   script prints "start it with `cloudflared tunnel run house-hunter`" and exits
   2 (deployed locally, public tunnel down). Update the remediation hint:
   - Option A tunnel: `launchctl load -w ~/Library/LaunchAgents/ai.galleonglobal.${PROJECT_NAME}-tunnel.plist`
     (or the foreground `cloudflared tunnel --config ~/.cloudflared/config-${PROJECT_NAME}.yml run ${TUNNEL_NAME}`).
   - Option B / system daemon: `sudo launchctl bootstrap system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist`.

   The exit-code contract is worth keeping: `0` = verified live, `1` = local
   server broken after reload, `2` = deployed locally but public domain
   unreachable (tunnel down).

---

## Managing the services

```bash
# Server (per-user LaunchAgent)
launchctl unload -w ~/Library/LaunchAgents/${LABEL}.plist
launchctl load   -w ~/Library/LaunchAgents/${LABEL}.plist
tail -f ~/Library/Logs/${PROJECT_NAME}-server.err.log

# Tunnel, Option A (per-user LaunchAgent)
launchctl unload -w ~/Library/LaunchAgents/ai.galleonglobal.${PROJECT_NAME}-tunnel.plist
launchctl load   -w ~/Library/LaunchAgents/ai.galleonglobal.${PROJECT_NAME}-tunnel.plist
tail -f ~/Library/Logs/${PROJECT_NAME}-tunnel.err.log

# Tunnel, run in foreground for debugging (service stopped)
cloudflared tunnel --config ~/.cloudflared/config-${PROJECT_NAME}.yml run ${TUNNEL_NAME}
```

---

## Who does what: Claude Code session vs Mark

| Step | Who | Why |
| ---- | --- | --- |
| Step 0, account login (`cloudflared tunnel login`) | **Mark, in browser** | Needs an interactive Cloudflare dashboard auth for the `galleonglobal.ai` zone. **Already done on this Mac; a new project reuses `~/.cloudflared/cert.pem` and skips it.** Only recurs on a brand-new machine. |
| Step 1, create tunnel | Claude Code | Uses `cert.pem`, no dashboard. |
| Step 2, write config | Claude Code | Plain file write. |
| Step 3, route DNS (create CNAME) | Claude Code | `cloudflared tunnel route dns` uses `cert.pem`'s zone-edit permission; no manual dashboard record. |
| Step 4, foreground verify | Claude Code | Local commands. |
| Step 5A, tunnel LaunchAgent | Claude Code | Writes to `~/Library/LaunchAgents`, user-owned. |
| Step 5B or system daemon (`cloudflared service install`, `/etc/cloudflared`, `sudo launchctl`) | **Mark / needs sudo** | Writes under `/Library` and `/etc`, root-owned. Avoid for the second project anyway (machine singleton, see caveat). |
| Step 6, server LaunchAgent | Claude Code | User-owned `~/Library/LaunchAgents`. |
| Steps 7-8, verify + deploy script | Claude Code | Local commands and file edits. |

Net: on this machine, a Claude Code session in the other project can stand up the
whole thing itself (Option A), because the account cert already exists and the
DNS API permission comes with it. The only things that pull in Mark are a
fresh-machine login (step 0) or deliberately choosing the root-owned system
daemon (step 5B), which is not recommended here.

---

## Do-not-break checklist (protecting the House Hunter site)

- Do **not** run `cloudflared service install` for the new project. It clobbers
  `/etc/cloudflared/config.yml` (House Hunter's) and its daemon.
- Do **not** write to `~/.cloudflared/config.yml` (the unqualified default). Use
  `config-${PROJECT_NAME}.yml`.
- Do **not** reuse port `8787` or the `house-hunter` tunnel name / UUID.
- Credentials (`~/.cloudflared/*.json`, `cert.pem`) stay on disk only, never in
  git, never pasted into docs, issues, or PRs.
