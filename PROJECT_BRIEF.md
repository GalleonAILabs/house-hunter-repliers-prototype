# House Hunter Repliers Prototype: Project Brief

Saved: 2026-07-03

## What House Hunter is

House Hunter is a home search product for buyer groups (families, couples,
investor groups) working with a realtor team. It shows listings as map pins
and cards, carries commute data (GO train), financials (monthly PIT, due at
closing), fit scoring, and per-person feedback (ratings, notes, say-no,
research requests), so a group of decision-makers can search together and
see where they agree and disagree, instead of each person tracking listings
separately or a realtor manually collating opinions.

## POC vs alpha

**POC (original House Hunter):** a manual, scraping-based tool built around
one buyer group (Mark and Katie), pulling Ontario listings by scraping, with
Mark/Katie hardcoded as the two raters. It proved the product concept: fit
scoring, GO commute data, financial fields, and per-person ratings are
useful. `data/poc_listings.json` (104 Ontario listings) is the POC's
real data, carried into this prototype as a data source, gitignored.

**Alpha (this prototype):** rebuilding on a real data API (Repliers) instead
of scraping, and generalizing the data model so it is not hardcoded to Mark
and Katie. The alpha must support any buyer group (1 to N members) and any
realtor team (1 to N members), with every action attributed to a specific
named person, not a shared account. This prototype exists to prove the
Repliers integration and the dynamic actor/buyer-group model before House
Hunter is rebuilt properly for a real customer.

## Why we are rebuilding

- Scraping is fragile and not a defensible long-term data source.
- The POC's Mark/Katie-hardcoded model does not generalize to other buyer
  groups or to realtor teams with multiple members (lead agent, buyer agent,
  coordinator, mortgage partner, etc.).
- Buyer identity needs to be modeled properly from the start (buyer_groups,
  buyer_group_members) so notes, ratings, and vetoes are attributed to a
  real person, not folded into one generic comments blob. See
  `DATA_MODEL_NOTES.md` for the full schema and reasoning.
- Repliers gives a real, keyed API (Ontario data on the paid PropTx/ITSO
  tier; free tier is US sample data only, sufficient to prove workflow and
  schema, not Ontario search quality).

## Commercial path

- Customer path: realtor-led, buyer-collaborative. The realtor team owns the
  relationship; buyer group members collaborate inside it.
- First real workspace: Anees / Anees's realtor team. The alpha is being
  built around this one real team and one real buyer journey rather than a
  generic multi-tenant product, to stay grounded in an actual investment
  conversation.
- **Anees and his partner are co-investors in House Hunter as a product,
  not just the first realtor customer.** Their relationship to the project
  is dual: inside the app they act as advisors (realtor/advisor role,
  visually distinct from buyer sentiment per the Rules to follow below),
  and at the business level they are investors in House Hunter itself. Do
  not conflate the two: their in-app actions are still labeled and counted
  as advisor input, never as buyer sentiment, regardless of their investor
  status.
- Galleon owns the app and IP.
- The free Repliers sample account stays under Mark for prototype work.
  Paid Repliers/PropTx access (needed for real Ontario data) moves to Anees
  or his team when the investment/deal is ready.
- A successful alpha with Anees is the path to a second realtor-team
  customer.

## Current code state (as of 2026-07-03)

- Stdlib-only Python server (`server.py`) proxies Repliers server-side; the
  API key never reaches the browser. Runs on port 8787.
- Endpoints: `/api/health`, `/api/listings` (Repliers sample), `/api/poc-listings`
  (POC data).
- Frontend is vanilla HTML/CSS/JS in `static/` (`index.html`, `app.js`,
  `styles.css`). No frontend framework, no build step.
- List view works: cards show price, GO commute, beds/baths/sqft/acres,
  monthly PIT and due-at-closing, Mark/Katie ratings, fit tags, features,
  comments, listing/research links.
- Card settings drawer toggles card sections on/off, saved to localStorage.
- Dark mode works: follows `prefers-color-scheme` by default, with a manual
  light/dark/auto override saved to localStorage.
- POC data source wired in and set as the default (`data/poc_listings.json`,
  104 Ontario listings, gitignored, never commit).
- Repliers sample source works as an alternate data source (US sample data
  only; `state=ON`/Toronto filters returned 0 results as of 2026-07-02).
- **Leaflet map view is broken on Android Chrome and is parked.** Tiles
  render as separated blocks with black gaps despite exhausting layout and
  sizing fixes (flex layout, `min-height:0`, ResizeObserver, delayed
  `invalidateSize`, double `requestAnimationFrame`, explicit JS pixel height
  before `L.map()` init, and copying the working POC's simpler full-page map
  pattern verbatim). This is no longer treated as a layout/CSS bug; it
  appears specific to Leaflet tile rendering in this Android
  Chrome/localtunnel context. Do not spend further time debugging this as
  the main thread of work. Revisit later by either embedding the
  known-working POC map more literally, or switching to Mapbox/Google Maps
  once a public token/key exists.

## Rules to follow

- No Flask, FastAPI, or pip dependencies for the server layer. Stdlib
  Python only.
- Repliers API key stays server-side only, never exposed to browser JS.
- `data/` is gitignored; never commit `poc_listings.json`.
- No em dashes in any output, comments, code, or docs.
- Buyer and realtor-team filters/selectors must be dynamic, rendered from
  data (`buyer_group_members`, `realtor_team_members`). Never hardcode to
  Mark/Katie or assume a maximum of two people.
- Never infer the acting person from a shared browser session. The
  explicitly selected "I am" identity is the actor of record for that
  action.
- Do not store notes as a single generic comments blob. Store every note,
  rating, rejection, and research request as a person-attributed feedback
  event (see `listing_feedback` in `DATA_MODEL_NOTES.md`).
- Buyer sentiment and realtor/advisor input must stay visually distinct.
  Realtor/advisor ratings should not silently count toward buyer consensus.
- Claude Code work on this project should use OAuth tools only (Claude Code
  OAuth, Codex OAuth), not the metered Anthropic API.

## What to build next

The core product flow, in order:

1. Make **List** the default view. Keep **Map** as experimental/beta-labeled
   until revisited.
2. Build the dynamic **"I am" actor selector**, populated from
   `buyer_group_members` (not hardcoded to Mark/Katie). This is the current
   priority (see `CLAUDE.md`).
3. Wire active-actor controls: ratings, notes, reject/say-no, and research
   requests are recorded against the selected actor, and the UI labels
   actions by that person's name (e.g. "Katie said no", "Anees flagged
   resale risk").
4. Allow advisors/realtors to exist as actors, visually labelled separately
   from buyer sentiment.
5. Replace the POC's "Both like" filter with dynamic per-person consensus
   filtering (one row per `buyer_group_member`), plus group-level consensus
   filters (at least one likes it, everyone likes it, hide if anyone said
   no, hide if a veto-power member said no).
6. Revisit the Leaflet map only after this core flow works, per the
   Leaflet note above.

## Repo

- GitHub: `https://github.com/GalleonAILabs/house-hunter-repliers-prototype`
- Server: `python3.11 server.py`, port 8787
- Phone test tunnel: stable named Cloudflare Tunnel at `https://househunter.galleonglobal.ai` (permanent, does not change on restart). Run the forwarder with `cloudflared tunnel run house-hunter`. Replaced localtunnel (interstitial page blocked external phones) and an earlier quick tunnel (random URL each start).

## Reference docs

- `HANDOFF.md`: most recent session handoff, map blocker detail
- `DATA_MODEL_NOTES.md`: full buyer/realtor data model, actor rules,
  consensus filtering, feedback event schema
- `README.md`: setup and file overview
- `CLAUDE.md`: Claude Code operating context for this repo
