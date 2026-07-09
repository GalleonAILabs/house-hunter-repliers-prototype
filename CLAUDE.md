# House Hunter Repliers Prototype: Claude Code Context

## What this is
A mobile-first home search prototype for a family buyer group.
Stdlib Python server (server.py) proxies the Repliers real-estate API.
Frontend is vanilla HTML/CSS/JS (static/) using Mapbox GL JS v3 for maps
(migrated from Leaflet; requires MAPBOX_TOKEN in .env, served to the
frontend via GET /api/config since Mapbox tokens are meant to be public).

## Current problem to solve
Build the dynamic "I am" actor selector. Every rating, note, reject/say-no,
and research request must be attributed to a specific `buyer_group_member`,
selected via an explicit "I am" control, not hardcoded to Mark/Katie and not
inferred from the shared browser session.

Rules (full detail in `DATA_MODEL_NOTES.md`):
- Selector must render dynamically from `buyer_group_members`, one choice
  per person. Must work for 1, 2, or N members.
- Selected person is the active actor for all subsequent rating/note/
  say-no/research actions until changed.
- Advisors/realtors can be actors too, but must be visually labelled so
  their input is not confused with buyer sentiment.
- Actions are labelled by person in the UI, e.g. "Katie said no", "Dad
  rated 4".

The map is no longer parked/experimental -- the original Leaflet tile-split
bug was root-caused (a corrupted SRI hash, see git history) and fixed, and
the map has since been migrated to Mapbox GL JS with GO Train Stations and
Highway 413 GeoJSON overlay layers, pin colouring by fit score, and a
clustering toggle for the Sample Data source. `HANDOFF.md`/`PROJECT_BRIEF.md`
describe the earlier parked state; treat this note as authoritative over
those for map status.

## What we need
1. List is the default view; Map is a fully supported second view.
2. Map view: full remaining viewport height, pins for all POC listings.
3. List view: scrollable cards with commute, ratings, financial, features.
4. Dark mode: follows system preference (prefers-color-scheme) with manual toggle.
5. Settings panel: toggle card sections on/off, saved to localStorage.
6. DO NOT use Flask, FastAPI, or any pip dependencies for the server layer.
7. DO NOT expose the Repliers API key in browser JS.

## Data
- POC data: data/poc_listings.json (104 Ontario listings, gitignored)
- Repliers sample: via /api/listings proxy (US sample, no Canadian data yet)
- Key POC fields: address, price, beds, baths, goStation, goMin, goTrain,
  goTotal, markRank, katieRank, markComments, katieComments, realtorComments,
  pit, pitNum, dueClosing, features, fit, poc.link, poc.doc, lat, lon

## Repo
/Users/markgarrett/Galleon/house-hunter-repliers-prototype
Git remote: https://github.com/GalleonAILabs/house-hunter-repliers-prototype

## Server
Running on port 8787 (python3 server.py; runs under 3.14 today, stdlib
only so any python3 works). Persistent: runs as a per-user LaunchAgent
`ai.galleonglobal.househunter-server`
(`~/Library/LaunchAgents/ai.galleonglobal.househunter-server.plist`,
RunAtLoad + KeepAlive), so it starts at login and auto-restarts if it
dies. A LaunchAgent (not a system LaunchDaemon) because server.py and
its data live in the user's Google Drive mount, which only exists after
login. Logs: `~/Library/Logs/househunter-server.{out,err}.log`.
Manage: `launchctl unload|load -w ~/Library/LaunchAgents/ai.galleonglobal.househunter-server.plist`.
Endpoints: /api/health, /api/config, /api/listings, /api/poc-listings,
/api/people, /api/feedback, /api/column-permissions (GET group defs +
resolved per-person grants + personal grid picks + admin_id; POST
admin-only group grant), /api/grid-prefs (POST personal column
show/hide), /api/transfer-admin (POST admin-only), /api/person-thresholds,
/api/poi (GET/POST/DELETE; DELETE refuses a pin still attached to a listing
unless force=true), /api/report-issue (POST; in-app tester bug report that
files a Linear Triage issue with an AI first-pass, GAL-42),
/layers/go-stations.geojson, /layers/highway-413.geojson.
Report-issue env vars (server-side only, never sent to the browser):
LINEAR_API_KEY enables the feature and the Report button (see /api/config
report_enabled); ANTHROPIC_API_KEY (a per-project console key) turns on the
AI title/label/duplicate first-pass, otherwise reports fall back to a derived
title plus the needs-triage label; LINEAR_TEAM_KEY defaults to GAL.
Column-permission model: /api/poc-listings and /api/feedback take an
optional person_id and strip data for any column group that person is
denied (server-side enforcement, denied data absent from the payload,
not hidden client-side; see DECISIONS.md 2026-07-08).
Phone test tunnel: stable named Cloudflare Tunnel at
`https://househunter.galleonglobal.ai` (permanent URL, does not change
on restart). Tunnel name `house-hunter`, UUID
`cd2a79c3-145f-4c17-8702-c56b18554230`, config in `~/.cloudflared/
config.yml` mapping that hostname to `http://localhost:8787`, DNS is a
proxied CNAME on the `galleonglobal.ai` Cloudflare zone. The tunnel is
always-on: `cloudflared service install` set up a system LaunchDaemon
`/Library/LaunchDaemons/com.cloudflare.cloudflared.plist` (root, RunAtLoad,
config copied to `/etc/cloudflared/config.yml` + credentials in
`/etc/cloudflared/`), so `househunter.galleonglobal.ai` comes back after a
restart with no manual command. It is a system LaunchDaemon (starts at boot),
unlike the server which is a per-user LaunchAgent (needs the Drive mount that
only exists after login); the tunnel just retries until the origin at
localhost:8787 is up post-login. Manage:
`sudo launchctl bootout system/com.cloudflare.cloudflared` /
`sudo launchctl bootstrap system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist`,
or `cloudflared service uninstall`. Logs go to the system log. To run it
manually instead (service stopped), `cloudflared tunnel run house-hunter`
reads `~/.cloudflared/config.yml`. The server binds 127.0.0.1 only (server.py),
so the tunnel is required; direct LAN access would need binding 0.0.0.0.

Replaced two earlier tunnel setups: localtunnel (dead URLs
`repliers-mark.loca.lt` / `house-hunter-repliers-mark.loca.lt`, forced
an interstitial "friendly reminder" page that blocked external phones)
and a Cloudflare quick tunnel (`cloudflared tunnel --url ...`, worked
but minted a fresh random `*.trycloudflare.com` URL every restart).

## Deploy

**After changing server.py or any static/ asset, deploy with
`bash scripts/deploy.sh`. Do not just edit files and assume the live site
updates.** Two failure modes make that assumption wrong, and the script
handles both, then verifies the live domain actually serves the new code
instead of trusting that the reload worked:

1. **Stale process.** The server runs as a LaunchAgent that does NOT
   hot-reload code. A `server.py` change is only live after the agent is
   reloaded (`launchctl unload -w && load -w` on the plist). An unreloaded
   process keeps serving the old code from memory: new API routes 404 even
   though disk has them. This is the failure that made a shipped feature's
   endpoint 404 on the live site while every local test passed.
2. **Cache-pinned assets.** Cloudflare's zone Browser Cache TTL (~4h)
   overrides the origin `Cache-Control: no-cache`, so browsers can run an
   old `app.js`/`styles.css` for hours after a deploy. The fix is a
   cache-bust `?v=<token>` query on the asset URLs in `index.html` (which is
   served `no-cache` and is not edge-cached, so it always picks up the new
   token). `scripts/deploy.sh` bumps that token every run.

`scripts/deploy.sh` bumps the token, commits + pushes it, reloads the
LaunchAgent, then verifies: local `/api/health` up, local
`/api/person-thresholds` == 200 (proves the new code is the running
process, not a stale one), live `index.html` references the new token, live
`/api/person-thresholds` == 200, and live `app.js?v=<token>` returns the
same bytes as the origin. Exit codes: `0` verified live, `1` local server
broken after reload, `2` deployed locally but the live domain is
unreachable (usually the on-demand tunnel is down: run
`cloudflared tunnel run house-hunter`).

## Constraints
- No em dashes in any output or comments
- No Flask/FastAPI/pip deps
- API key stays server-side only
- data/ folder is gitignored, never commit poc_listings.json

## Codex review policy

Codex CLI is authorized for use in this project (see DECISIONS.md for why
an earlier pause on running it no longer applies).

- Periodically run gstack's /codex review on changes during a session, for
  validation as work progresses.
- At the end of any major or substantial session (a significant batch of
  work, not every small fix), always run a full /codex audit of the code
  before considering the session closed.

## Linear discipline (team GAL, project House Hunter - Alpha)

Every request from Mark, however small, becomes a Linear issue via the Linear
MCP before or while you work on it. No exceptions for "quick" changes.

On receiving a request:
1. Create a GAL issue: imperative title, one-line context, type label
   (Bug/Feature/Improvement/Chore/Design/Docs), milestone Alpha unless told
   otherwise. Move it to In Progress and assign it to yourself.
2. Do the work. Commit messages reference the issue: "Refs GAL-NNN" or
   "Fixes GAL-NNN".

On completing a request:
3. Move the issue to In Review. Never move anything to Done.
4. Reassign to Mark (or the intern if Mark says so).
5. Comment with a testing block:
   - What changed
   - How to test: numbered steps starting from a URL or command
   - Expected result
   - Deployed: yes (househunter.galleonglobal.ai) or local only
6. If you discover side work, create a new issue in Triage. Never expand
   the current issue's scope.

No em dashes in any issue title, description, comment, or commit message.

## Standard issue-pull procedure

When Mark says "pull GAL-NN" (or /pull GAL-NN is run), execute this full
workflow with no further instruction.

**Multiple IDs:** a pull may name several issue IDs. Process them strictly one
at a time, completing the full workflow below (through the In Review handoff, or
the readiness skip) for one ID before starting the next. Never interleave.

For each issue ID, in order:

1. Fetch the issue and ALL its comments from Linear via MCP.
2. Determine mode:
   - Status Backlog/Todo: fresh work. Build to the acceptance criteria.
   - Status In Progress or In Review with newer review comments: rework.
     Treat Mark's latest comments as the spec delta and fix per comments.
3. Readiness guard (skip for rework driven by review comments). Check the
   issue's Readiness label before building. If it is `needs-spec`, do NOT
   build: comment on the issue listing the specific open questions blocking it,
   skip the issue, and continue to the next ID. Only `agent-ready` issues (or
   explicit rework per review comments) get built.
4. Check the Complexity label; switch models per the Model routing
   section if needed.
5. Move the issue to In Progress, assign to self.
6. Do the work. Commits reference the issue (Refs GAL-NN / Fixes GAL-NN).
7. If the change affects the running app, deploy via scripts/deploy.sh
   and verify per the six-width layout check when UI is touched (the
   390/600/768/900/1024/1280 standard, see DECISIONS.md).
8. Move to In Review, reassign to Mark, comment a testing block:
   what changed, how to test (numbered steps), expected result,
   deployed yes/no, model used.
9. Anything ambiguous: comment the question on the issue and stop.
   Side discoveries become new Triage issues, never scope creep.

## Model routing

Current mapping (update here when models change):
- standard → Opus 4.8 (default)
- frontier → Fable 5 (switch via /model)

When creating any Linear issue, assess and apply a Complexity label:
- frontier: architecture or data-model decisions, security/auth work,
  ambiguous specs needing judgment, effort class L, cross-cutting refactors
- standard: everything else (mechanical fixes, config, docs, well-specified
  features)

Before starting an issue labeled frontier, check the active model and
switch if needed. Note the model used in the In Review comment.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
