# House Hunter Prototype Handoff

Saved: 2026-07-02 late session

## Current state

Repository:

- `/Users/markgarrett/Galleon/house-hunter-repliers-prototype`
- GitHub: `https://github.com/GalleonAILabs/house-hunter-repliers-prototype`
- Live phone tunnel: `https://house-hunter-repliers-mark.loca.lt`
- Local server: `python3.11 server.py` on port `8787`
- POC data export: `data/poc_listings.json`, gitignored, do not commit

## What works

- Public GitHub repo is live.
- Local Python stdlib server runs and proxies Repliers server-side.
- POC data source is wired in from the existing House Hunter sheet export.
- App defaults to `My POC data`.
- POC export currently has 104 listings.
- POC data is not committed. `data/*.json` is ignored.
- Repliers sample source still works as alternate data source.
- Cards show POC fields:
  - price
  - GO commute
  - beds/baths/sqft/acres
  - monthly PIT and due at closing
  - Mark/Katie ratings
  - fit tags
  - features
  - comments
  - listing/research links
- Card settings drawer exists and can toggle card sections on/off.
- Dark mode toggle exists:
  - Auto follows system setting via `prefers-color-scheme`
  - Light
  - Dark
- Two views exist:
  - Map
  - List
- List view works enough to keep building product flow.

## Current blocker

The Leaflet map view is still broken on Android Chrome through the localtunnel URL.

Observed behaviour:

- Header and floating controls render correctly.
- Map now fills the screen behind controls.
- Leaflet tiles still appear as separated blocks with black gaps.
- This remained true after:
  - flex layout fixes
  - `min-height: 0`
  - `ResizeObserver`
  - delayed `invalidateSize`
  - double `requestAnimationFrame`
  - explicit JS pixel height before `L.map()`
  - copying the POC-style full-screen map pattern

Conclusion:

- The issue is no longer normal container height/layout.
- It appears specific to Leaflet tile rendering in this Android Chrome/localtunnel context.
- The original POC uses Leaflet successfully because it is a simple full-page static/App Script map with controls floating over the map.
- The current prototype should stop spending time on this exact map rendering until we either:
  1. directly embed/reuse the working POC map approach more literally, or
  2. switch to Mapbox/Google Maps after a token/key exists.

## Important lesson from the working POC

The working POC map uses this simple pattern:

```css
html,body{margin:0;height:100%;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
#map{height:100%;width:100%}
```

And the map is the main page element:

```html
<div id="map"></div>
```

Controls are absolutely positioned over it.

The prototype was changed toward that structure in commit:

```text
86c92d0 fix: copy working POC Leaflet pattern, full-screen map with floating controls
```

But the phone screenshot still showed broken tiles.

## Latest commits of interest

```text
86c92d0 fix: copy working POC Leaflet pattern, full-screen map with floating controls
59bb958 fix: JS setLayout() positions all elements + map like working POC, no CSS flex
94ffe36 fix: explicit JS pixel height before Leaflet init, remove broken Opus fragments
cf372aa fix: double rAF defers Leaflet init until after browser layout and paint
92968f4 fix: ResizeObserver on map container, eliminates tile split on mobile
```

## Claude Code / model note

Mark wants House Hunter coding work to use OAuth tools only, not metered API fallback.

Approved direction:

- Claude Code OAuth, preferably `claude-opus-4-5` for hard reasoning
- Sonnet 4.5 for faster coding iteration if needed
- Codex OAuth is acceptable if configured
- Do **not** fall back to Anthropic API
- Do **not** use metered Claude API for this project

Claude Code OAuth status was checked:

```json
{
  "loggedIn": true,
  "authMethod": "oauth_token",
  "apiProvider": "firstParty"
}
```

A Claude Code Opus task was started, but killed after partial edits because the manual path moved faster and the file had to be cleaned. The repo currently passes syntax checks.

## Next recommended step

Do not keep fighting this Leaflet tile issue as the main thread.

Recommended next build path:

1. Make **List** the default view for the prototype.
2. Keep **Map** as experimental or hide it behind a beta label.
3. Build the core product flow next:
   - `I am` selector, dynamic from buyer group members
   - active actor controls for ratings, notes, reject/say no, research requests
   - consensus/person settings
   - card edit/settings UX
4. Revisit map after core flow works:
   - either embed/use the known working POC map more directly
   - or switch to Mapbox/Google Maps when a public token/key is available

## Specific next product feature

Build the **I am** person selector.

Rule:

- Selected person is the active actor.
- Rating, note, say-no, research request, and viewed/reviewed actions are recorded as that person.
- Must be dynamic, not hardcoded to Mark/Katie.
- Source should eventually be `buyer_group_members`.
- Advisors/realtors can exist as actors, but should be visually labelled so advisor input is not confused with buyer sentiment.

## Dark mode note

Logged in `DATA_MODEL_NOTES.md`:

- Dark mode is required.
- Buyers may review listings at night in bed.
- Default should respect system setting.
- Manual override should allow: system, light, dark.

## Files to inspect next session

- `static/index.html`
- `static/styles.css`
- `static/app.js`
- `server.py`
- `scripts/export_poc.py`
- `DATA_MODEL_NOTES.md`
- `CLAUDE.md`

## Verification commands

```bash
cd /Users/markgarrett/Galleon/house-hunter-repliers-prototype
node --check static/app.js
python3.11 -m py_compile server.py scripts/export_poc.py
curl -fsS http://127.0.0.1:8787/api/health
curl -fsS 'http://127.0.0.1:8787/api/poc-listings?resultsPerPage=5'
git status --short
```

## Current recommendation to Mark

Sleep. Tomorrow, start with:

> Continue House Hunter from HANDOFF.md. Make List the default view, park the broken Leaflet map as experimental, then build the dynamic `I am` actor selector and rating/note actions from buyer group members.
