# House Hunter Repliers Prototype — Claude Code Context

## What this is
A mobile-first home search prototype for a family buyer group.
Stdlib Python server (server.py) proxies the Repliers real-estate API.
Frontend is vanilla HTML/CSS/JS (static/) using Leaflet for maps.

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

The Leaflet map (mobile Chrome tile-split bug) is parked as experimental.
Do not spend further time on it; see `HANDOFF.md` and `PROJECT_BRIEF.md` for
the parked map context and revisit path.

## What we need
1. List is the default view; Map stays experimental/beta-labeled.
2. Map view (when revisited): full remaining viewport height, pins for all 104 POC listings.
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
Running on port 8787 (python3.11 server.py)
Endpoints: /api/health, /api/listings, /api/poc-listings
Phone test tunnel: https://house-hunter-repliers-mark.loca.lt

## Constraints
- No em dashes in any output or comments
- No Flask/FastAPI/pip deps
- API key stays server-side only
- data/ folder is gitignored, never commit poc_listings.json
