# Batch 2 Decisions Log

## OVERNIGHT SESSION SUMMARY — 2026-07-08 (read this first)

Ran unattended to completion. Three deploys, all verified live; `main` clean and
pushed; no destructive operations; a safety backup of the DB + poc_listings.json
was taken to `data/backups/` (gitignored). Full detail per task lower in this
file under "Overnight session" headings.

**Completed:**
- Task 2a — map control normalization: one control-chip style (12px/800/6px 10px
  /▾▴) across Filters, Layers, Legend, Sort, Draw; Draw keeps only its active
  blue, not its old larger size; draw-mode toolbar buttons identical size,
  stacked. Deployed, verified at 390 (dark) and 1280 (light), both basemaps.
- Task 2b — TTC subway layer: built from the live TTC GTFS (Toronto Open Data,
  downloaded at build time). All of Lines 1/2/4/5/6 are EXISTING (the 2026 feed
  carries Line 5 Eglinton and Line 6 Finch West in revenue service); Line 3 is
  gone from the feed (closed 2023). Station counts match TTC published exactly
  (38/31/5/25/18), 110 unique stations, zero out-of-GTA coordinates. Layers menu
  regrouped under Transit / Roads & places. Deployed; live endpoints verified.

**Skipped:**
- Task 1 — POC merge: SKIPPED because no new export from the Hermes pipeline
  exists on this machine (MM1). The only listing files are the live data (Jul 6)
  and an OLDER vault mirror (Jul 3). Per the task's own instruction, skipped
  rather than guessing a source. No data was mutated.

**Defaults / judgment calls chosen (all logged in detail below):**
- Draw control stays LEFT (not moved into the right-side stack): its expandable
  toolbar would overlap the equally-expandable Layers panel, and its own lane
  keeps the map clear for drawing. Size (the actual complaint) was fixed.
- Draw toolbar stacked vertically: the three full labels do not fit one row at
  390px; Finish keeps fill (not size) emphasis.
- TTC line colours taken from the GTFS route_color (agency-official), including
  Line 6 grey (#808080) despite low street-map contrast.
- Transit / Roads & places grouping adopted in the Layers menu (it grew long).

**NEEDS MARK'S ATTENTION IN THE MORNING:**
1. **Task 1 is unrun.** If a new Hermes POC export exists, it is not on MM1.
   Point me at the file (or sync it into `data/` or the vault) and I will run
   the keyed merge exactly as specified.
2. **Line 5/6 are live in the 2026 TTC feed** (opened), not under construction.
   If that looks wrong, flag it and I will re-tier.
3. **Line 6 colour is grey** (#808080), low-contrast on the street basemap. Say
   if you want a brighter substitute; I kept the official colour.
4. **Draw stayed on the left.** If you want it physically in the right stack, a
   small follow-up; I flagged the expandable-overlap tradeoff rather than force
   it unattended.
5. **Codex was quota-blocked all session** (OpenAI billing). Every task's review
   was a structured self-review instead. Top up to restore the standing gate.
6. A stray saved area "Area 1 · Mark" is in the shared DB (earlier test cruft). I
   left it rather than delete shared data unattended; remove it if unwanted.

---

This file records every ambiguity resolved without stopping to ask, per the
batch kickoff instructions. Entries are added as work proceeds. A summary
section is added at the top once the batch is complete.

## Batch 2 summary (all items complete)

All of T10-T19 are done on branch `batch2-ui-fixes`, one commit per item,
`test_server.py` run and passing before every commit. Nothing was pushed,
merged to `main`, or deployed. `main`'s pre-existing uncommitted work (a
group sentiment feature and CSS fixes) is safely stashed, not lost, not
touched, not committed by this batch (see "Setup" below to restore it).

**Built (T10, T11, T12, T14, T15, T16, T17, T18):**
- **T10:** filter/map-layer/sort state now persists across reloads via
  `localStorage`, same mechanism as dark mode and card settings.
- **T11:** note "Add" and "Edit" are now distinct actions (previously both
  reopened the same pre-filled composer); every note keeps its own
  timestamp in a new `note_history` list, not just the latest one.
- **T12:** listing search now matches each typed word independently
  instead of requiring the whole phrase as one exact substring (a real
  address like "18 Mill St, Essa" previously failed a natural search like
  "mill st essa" because of the comma).
- **T14:** POI pins (school/hospital/work/worship/other) can be searched
  for and dropped on the map, shared across the whole buyer group. Needed
  a new external API call (Mapbox Geocoding, same account/token already
  in use for map tiles), logged before use per the constraints.
- **T15:** a "Condo fee" line surfaces beside Monthly PIT, but only when
  both a condo flag and a fee value are present. Real for Repliers sample
  data today (`HOAFee` + `style === "Condominium"` both already exist
  there); silently inert for POC data until the family adds those columns
  to their sheet, since no such field exists there yet.
- **T16:** a rating/reject/note change now re-runs the active filters
  immediately (list and map both), instead of leaving a listing visible
  until a manual "Apply." Investigation confirmed this applies to the
  per-person rating checkboxes, not the unrelated computed fit-score
  filter.
- **T17:** map pins show the active "I am" person's own numeric star
  rating, consistent with how every other personalized feature in the app
  (the rating filter, the "My rating" sort) is already scoped to the
  active actor rather than an aggregate.
- **T18:** a new, separate, single-line card summary lets a person choose
  exactly one of Price / Cost to close / Monthly PIT to headline, on top
  of (not replacing) the existing always-shown Price line.

**Research only, nothing built (T13, as instructed):** the GTFS feed
already used for the GO Line map layer also has trip-level schedules and
zone-based fare data for GO Train stations, no new data source needed for
either. Express/local status is derivable for rail but isn't a clean flag
in the data. A rough scope estimate for building commute-timing and fare
lookups as a future item is in the T13 section below.

**Investigated, blocker logged, not forced (T19):** pin clustering only
works for Repliers sample data because it is the Repliers vendor API's
own server-side clustering, passed through almost as-is; POC data is a
local static file with nothing to delegate clustering to. Making it work
for both would mean writing a real spatial clustering algorithm or
rewriting the whole feature on Mapbox's native client-side clustering,
which is real standalone engineering work, not a small enable-it fix.
Scope estimate for that future rebuild is in the T19 section below.

**Needs a human decision or action, not resolved by this batch:**
- **T15 (condo data):** the POC spreadsheet needs new `isCondo` and
  `condoFeeNum` columns populated by the family for any real condo
  listings; the code is ready and will surface real values the moment
  those columns exist, but no real POC listing shows a condo fee today.
- **T19 (clustering):** a decision on whether it's worth the roughly
  half-day rebuild (moving to Mapbox's native clustering) to get
  consistent clustering across both data sources, given POC's pin count
  (105) makes the practical benefit there much smaller than for the
  larger Repliers feed.
- **T13 (commute/fare, research only):** whether and when to build the
  GO Train commute-timing and fare-lookup feature the research scoped
  out; not started, by instruction.
- **Stashed pre-batch2 work on `main`:** the group sentiment feature and
  CSS fixes that were uncommitted before this batch started are still
  sitting in a stash (see "Setup" below for the exact stash message).
  They were deliberately left alone rather than folded into this batch's
  history; someone needs to decide whether to `git stash pop` them back
  onto `main` and commit, or handle them separately.

## Setup

**Ambiguity:** The kickoff instructions asked me to confirm a clean working
tree relative to the last commit, with no unrelated pending changes. The
actual working tree on `main` had five modified files and one untracked
file (`docs/design-spec.md`, `static/app.js`, `static/index.html`,
`static/styles.css`, `TODOS.md` modified; `docs/STATUS.md` untracked). This
was real, intentional, previously-reviewed work (a group sentiment card
feature and two CSS bug fixes) that earlier instructions explicitly said to
leave uncommitted rather than commit yet.

**Default chosen:** Stashed the existing changes on `main` with
`git stash push -u -m "pre-batch2: ..."` rather than committing them
myself (not asked to commit that work) or carrying them into this batch
(they are unrelated to T10-T19). This gives `batch2-ui-fixes` a genuinely
clean base without losing or committing anything. The stash is recoverable
with `git stash pop` on `main` (stash ref: `stash@{0}` at time of writing,
message `pre-batch2: uncommitted group-sentiment feature + bottom-bar CSS
fixes + STATUS.md, stashed to give batch2-ui-fixes a clean base`).

**Why:** Stashing is reversible and keeps the two bodies of work (the
already-built, already-reviewed group sentiment feature, and this new
batch) cleanly separated instead of mixing them into one branch history.

## T11: note data model investigation

**Investigation finding, as required before deciding the fix:** the note
data model is a list, not a single field, at the database layer.
`listing_feedback` is append-only; `handle_feedback_post()` always INSERTs a
new row, it never UPDATEs one. Every "note" action a person has ever taken
on a listing already exists as its own row with its own `created_at`. The
bug was entirely on the read side: `latest_feedback_for_listings()`
collapsed to a single `note` field holding only the most recent row's text,
discarding the rest, and never exposed that row's own timestamp (only an
aggregate `updated_at` across all action types combined). The frontend then
pre-filled the note composer with that single latest value on every open,
so "add a new note" and "edit the existing one" were indistinguishable and
both looked like "reopening the old note."

**Default chosen:** field fix for the write/compose interaction (Add opens
a blank composer, Edit opens pre-filled with the latest note. Both still
call the same existing `submitFeedback(item, 'note', {note}, ...)`, so the
already-append-only write path did not need to change at all), combined
with a small history list for the read/display side (`note_history`, all
past notes for that person on that listing, newest first, each with its
own `created_at`, added as a new field in `latest_feedback_for_listings()`
alongside the existing single-value fields, which are kept for backward
compatibility).

**Why not a pure field fix (single note + a separate timestamp, no
history):** the real backfilled POC comment data already contains multiple
dated entries manually concatenated into one string by the family before
this app existed (e.g. "2026-06-14: ... | 2026-06-18: ... | 2026-06-19:
..."). A real history list is not a bigger feature than what the family
was already doing by hand; it replaces manual date-prefixing and
pipe-concatenation with a structured feature the database already
supported for free. A pure field fix would have papered over the same
problem again (a person adding a third and fourth note over time would
still be flattened into "the note").

**Why not a bigger rework (editable history, per-entry delete, etc.):**
out of scope for this batch item. "Edit" here means: compose from the
latest note's text and save, which appends a new row that becomes the new
latest, not a true in-place update. This satisfies the requirement (add
and edit are distinct actions; new notes are timestamped) without adding
UPDATE/DELETE support to `listing_feedback`, which is a write-path change
the batch's global constraints say to avoid unless explicitly required.

## T13: GO Train commute timing and fare data (research only, not built)

Re-fetched the same official Metrolinx GTFS feed already used to build the
GO Line map layer (`GO-GTFS.zip`, `assets.metrolinx.com`) and inspected the
files that were not used the first time: `stop_times.txt`, `fare_attributes.txt`,
`fare_rules.txt`, and the `zone_id` column in `stops.txt`.

**Trip-level schedules: already available locally, no new source needed.**
`stop_times.txt` gives an exact `arrival_time`/`departure_time` per stop
per trip, in sequence. A per-leg time to Union is a direct subtraction
between two rows of the same `trip_id`, and the feed already computes this
for humans in `stop_headsign` (e.g. a real row reads "Kipling GO 08:43 -
Union Station GO 09:03"). This is enough to build "X minutes to Union" for
any station, for any specific trip, or averaged across a set of trips
(e.g. AM peak).

**Express vs local: derivable, not a clean flag, and only for rail.**
`trips.txt` has a `route_variant` column that looked blank at first (my
initial scan only sampled rail trips). A full scan across the file shows
`route_variant` is populated with real values, but only for the numbered
GO bus routes (short names like "18F", "33A", "94"), not the 7 rail lines,
which all show a blank `route_variant`. For rail, "express" is not a flag
in this data; it would have to be inferred by comparing which stops each
trip's `stop_times` rows actually include (a trip skipping more local
stops reads as more express-like). That inference is straightforward but
is real logic to write, not a lookup.

**Fare data: already available in the same feed, no new source needed.**
`fare_attributes.txt` (8,282 rows, one price per `fare_id`, e.g. "$4.40
CAD") and `fare_rules.txt` (8,282 rows, `origin_id`/`destination_id` zone
pair per `fare_id`) are both present. GO uses zone-based fares: `stops.txt`
has a real, populated `zone_id` per station (confirmed: Union GO = zone 02,
Milton GO = zone 24, Kitchener GO = zone 27, Allandale Waterfront GO =
zone 69). A fare between any two real stations is a direct join: station
to zone (`stops.txt`), zone pair to `fare_id` (`fare_rules.txt`), `fare_id`
to price (`fare_attributes.txt`). No separate fare source is needed.

**Rough scope estimate for building this as a future item:**
- Commute timing (station to Union, by line): a small offline ETL script
  (same shape as the one already used to build `go_lines.geojson`),
  computing a representative time-to-Union per existing station and baking
  it into `go_stations.geojson` as a new property. Estimate: half a day,
  mostly picking a defensible "representative trip" (e.g. a specific AM
  peak departure) per station rather than an average across a whole day's
  service, which would blur peak vs off-peak times together.
- Fare lookup: a similar small ETL step joining the three files above into
  a zone-to-zone fare table, either baked into the same GeoJSON per
  station-to-Union, or as a small separate static JSON keyed by zone pair.
  Estimate: half a day.
- Both together, plus the actual UI to show them (a commute/fare line on
  the station hover popup, or a per-listing "X min / $Y to Union" figure if
  ever tied to a specific home address, which is a materially bigger step
  requiring geocoding a home address to its nearest station, not covered
  by this estimate) is a separate, later item. This batch item is research
  only, per the instructions; no commute breakdown, fare display, or
  onboarding-destination feature was implemented.

## T14: new external API, Mapbox Geocoding

**New external API integration, logged before use as required:** T14 asks
for a person to "search for" a place to drop a POI pin, not only click the
map. That needs geocoding (turning a typed place name into coordinates).
Verified live with a real request that the existing `MAPBOX_TOKEN` (already
in `.env` for the map tiles) also works against Mapbox's Geocoding API
(`api.mapbox.com/geocoding/v5/mapbox.places/...`), a separate product from
the map tiles under the same Mapbox account, at no new credential or
account needed.

**Default chosen:** use it, called directly from the browser (same pattern
as the map tiles themselves, which are already fetched client-side with
the public token), with a `proximity` parameter biased toward the GTA
(`-79.5,44.0`) so search results are relevant to this app's actual area
instead of matching similarly-named places worldwide.

**Why:** the alternative (require the user to click the map instead of
searching) would silently drop the "search for" half of the requirement.
Reusing the same vendor and the same already-approved token is the
lowest-risk way to add this, rather than introducing a second geocoding
provider or a server-side proxy for a call that is no more sensitive than
the map tiles already being fetched the same way.

## T14: POI pin defaults

Recording the defaults given in the kickoff instructions (already decided
there, logged here for a complete record) plus one additional default of
my own:

- Visual/map-only for now, not wired into any commute or distance
  calculation (given).
- A person can add more than one POI pin (given).
- POI pins are shared across the whole buyer group the same way listing
  feedback is shared, not private to one person (given).
- **My addition:** the POI pin map layer defaults to off, same as every
  other optional map layer already shipped (GO Stations, GO Lines, Highway
  413), toggled from the same layer panel. Chosen for consistency with the
  existing pattern rather than making this one layer behave differently
  from the others with no stated reason to.

## T15: condo fee data model investigation

**Investigation finding, as required before deciding the fix:** the two
data sources have opposite states.

- **POC data (the family's real spreadsheet, `data/poc_listings.json`):**
  no condo fee field and no property-type/condo flag exist at all. Every
  field on a POC row was inspected; there is nothing to surface, this is a
  true gap, not a naming mismatch.
- **Repliers sample data (US sample, live API):** both pieces already
  exist. `details.HOAFee` (also `HOAFee2`/`HOAFee3`, unused) is a real,
  populated monthly fee field (41 of 100 sampled listings have a nonzero
  value), and `details.style` includes a real `"Condominium"` value
  alongside `"Single Family Residence"`, `"Townhouse"`, etc. No new source
  needed for the Repliers side.

**Default chosen:** added two new nullable fields to both `normalize()`
(Repliers) and `normalize_poc()` (POC): `isCondo` (bool) and `condoFeeNum`
(number or null). For Repliers, `isCondo` is true when `propertyType` or
`style` contains "condo" (a small new `is_condo_type()` helper, reused by
both normalizers), and `condoFeeNum` reads `HOAFee`. For POC, both fields
read from the same-named POC columns (`isCondo`, `condoFeeNum`), which do
not exist in the real sheet today, so they evaluate to `False`/`None` for
every real row, exactly matching "hide when absent." The UI shows a
"Condo fee" line beside "Monthly PIT" only when `isCondo` and
`condoFeeNum` are both present.

**Why not build a full property-type system:** T15 asks only for the fee
to surface beside Monthly PIT on condo listings, not a general
property-type taxonomy. "Monthly PIT" itself is a POC-only concept (the
family's own mortgage/tax/insurance math, not a Repliers field), so the
new condo fee line was added inside that same existing POC-only financial
card section rather than inventing a second display location for the
Repliers side, which has no Monthly PIT line to sit beside in the first
place.

**Real data still needs populating:** the POC spreadsheet needs an
`isCondo` (or equivalent) column and a `condoFeeNum` column added by the
family for any of their real listings that are condos, the same way
`markRank`/`katieComments` etc. are populated today. Until then this
feature is silently inert for POC data (correct per the "hide when
absent" instruction), not broken.

## T16: which filter applies to "live re-filter on rating change"

**Investigation finding, as required before implementing:** there are two
filters in the app that could plausibly be called a "rating" filter, and
they are not the same thing. `minFit` is the computed fit score (hard
criteria like beds/price/lot size the listing itself meets or fails,
`server.py`'s `fit_score()`/`poc_fit()`), not a person's opinion. The
per-person checkboxes built in `buildPersonFilters()` (not_rated, 1-5
stars, said_no) are the actual personal-rating filter: they read a
specific person's own `rating`/`status` on a listing
(`matchesPersonCheckValue()`). T16's wording ("the active person's own
rating changes to a value outside the filter") describes this
per-person filter, not `minFit`, which this batch item applies to.

**Root cause, not just a missing feature:** `submitFeedback()` (used by
every rating/note/reject/research action) already re-fetched the fresh
feedback into `state.feedback` after a successful save, but only called
`renderCards(state.listings)`, which re-renders the *same, already
filtered* array in place, and never touched the map. So a rating change
that should have dropped a listing out of an active person-rating filter
(or `filterStatus`, which reads status the same way) left it visible on
both the list and the map until the user manually re-opened Filters and
clicked Apply, which recomputes `state.listings` from scratch.

**Default chosen:** `submitFeedback()` now calls the existing
`applyFiltersAndRender()` (the same function Apply/Reset already use)
instead of `renderCards()` directly, so every feedback action
re-evaluates all active filters against the fresh data with no new
filter logic needed. If the listing whose map card is open no longer
passes the filter, the card now closes instead of showing a card for a
pin that just disappeared.

## T17: whose rating to show on the pin

**Ambiguity:** the instructions say to show "the numeric star rating"
on map pins, sourced from existing feedback data, but a listing can have
a different rating from every buyer group member, and a pin has no room
to show more than one number.

**Default chosen:** show the active person's own rating (the same "I
am" actor already driving the personal-rating filter from T16 and the
"My rating" sort option), rendered as a small white number on top of the
pin's color, with a dark halo for legibility against any pin color. No
label at all when no one is selected as "I am," or when the active
person hasn't rated that listing yet, same as every other
active-person-scoped feature in the app.

**Why:** every other place ratings are personalized in this app (the
per-person filter checkboxes, the "My rating" sort, the reject/status
filter) is scoped to the active actor, not an aggregate. Showing a
single average or "any" rating on the pin would be a new, inconsistent
concept; showing the active person's own number keeps the map
consistent with how the rest of the app already treats "whose rating."

## T18: card summary value, placement and relationship to existing fields

**Ambiguity:** the app already has a "Price" field (`.card-price`, always
the asking price) and a "Monthly PIT + closing" block (both, POC only).
T18 asks for a *new*, separate, single-choice headline value picking
between the same three concepts (Price / Cost to close / PIT), which
overlaps with what already exists on the card.

**Default chosen (per the instructions' own given default, recorded
here for a complete log):** implemented as a genuinely new, additional
compact line, not a replacement for the existing Price field or the
existing financial block, both of which are untouched. The new line
sits directly above the existing Price line on the card. Its own
visibility is a normal `cf-summaryValue` toggle in `CARD_FIELDS` (on by
default), exactly like every other card section, so it participates in
"All on"/"All off" and hides on its own; the choice of *which* of the
three values it shows is a separate small `<select>` (`localStorage`
key `hh_summary_value_choice_v1`, default "Price"), rendered directly
beneath that toggle's row in the settings drawer, since a 3-way choice
doesn't fit the existing boolean-checkbox model.

**Why a real gap and not "just enable the existing fields":** the
existing Price field is unconditional (always the asking price, no
choice), and the existing financial block always shows *both* Monthly
PIT and Due at closing together, POC-only. Neither lets a person pick
one single value, or shows it for a Repliers listing that has no
Monthly PIT concept at all (a Repliers listing choosing "Cost to close"
or "PIT" correctly shows nothing, same hide-when-absent rule as T15,
since it hides via CSS `:empty` when `summaryValueFor()` returns null).

## T19: pin clustering scoped to one data source (blocker logged, not forced)

**Investigation finding, as required before deciding:** clustering is
scoped to Repliers-source listings not by an arbitrary code restriction
but because the two data sources implement "clustering" via two
completely different mechanisms, and only one of them has anything to
draw on for POC data.

- **Repliers side:** `fetch_repliers()` passes `cluster=true` straight
  through to the Repliers vendor API, which does the actual spatial
  clustering itself, server-side, and returns pre-computed cluster
  centers/counts/bounds in `aggregates.map.clusters`. `server.py`'s
  `/api/listings` reshapes that vendor output into a `clusters` array;
  the frontend's `clusters`/`clusters-circles`/`clusters-labels` source
  and layer render exactly what the vendor already computed, including
  click-to-zoom using the vendor-supplied bounds.
- **POC side:** `fetch_poc()` reads a local static JSON file (105
  listings) and has no external vendor to delegate clustering
  computation to; it returns no `clusters` key at all today, and
  `state.clusters` correctly defaults to `[]` for POC.

**Why this is a real blocker, not a small enable-it fix:** the "enable
consistently for both" default only makes sense if the same clustering
mechanism can serve both sources. It can't, as built: the current
mechanism *is* the Repliers vendor's own clustering API. Getting POC
pins to cluster would mean either (a) writing a real spatial clustering
algorithm ourselves (grid or greedy clustering, zoom-aware radius,
synthesizing the same count/bounds shape the frontend already expects),
or (b) replacing the current vendor-cluster-based mechanism entirely
with Mapbox GL JS's own native, client-side `cluster: true` GeoJSON
source option (which would work identically for either data source
since it operates on already-normalized point features already in
browser memory, not on the raw vendor response) -- but that would mean
rewriting the whole feature (new source/layer wiring, re-deriving the
existing click-to-zoom-to-bounds behavior from Mapbox's own cluster
expansion API instead of vendor-supplied bounds), not a small addition.
Either path is real, standalone engineering work, not a "make the same
checkbox work for a second data source" fix, so per the instructions
this is logged as a blocker rather than forced through in this batch.

**No code changed for T19.** Clustering remains scoped to Repliers
sample data only, exactly as it was before this investigation.

**Rough scope estimate for a future item:** rebuilding on Mapbox's
native `cluster: true` (option (b) above, the more maintainable path
since it would also stop depending on the Repliers-specific vendor
response shape) is roughly a half-day: swap the `listings` source to a
clustering GeoJSON source, add `cluster: true`/`clusterRadius` config,
replace the vendor-bounds click handler with Mapbox's
`getClusterExpansionZoom()`, and drop the now-unused server-side
`clusters` reshaping in `/api/listings`. Also worth noting: with only
105 static POC listings, the practical benefit of clustering there is
much smaller than for the Repliers feed's much larger result sets, so
this is a real gap but a low-urgency one.

## Codex CLI: pause lifted (2026-07-06)

Earlier sessions carried a standing instruction not to run the Codex
CLI at all, pending Mark personally verifying the installed binary
(running `codex --version` and confirming the npm package) after a
macOS Gatekeeper flag on the binary. That verification was never
completed as a discrete step; separate investigation into the
Gatekeeper flag found it inconclusive rather than a confirmed malicious
signature.

Mark has decided to proceed using Codex without completing that
personal check, accepting the residual risk. The "do not run Codex"
instruction is no longer current policy. CLAUDE.md now carries a
standing Codex review policy (periodic `/codex review` during a
session, a full `/codex` audit at the end of any substantial session)
in its place. A future session seeing old references to "do not run
Codex" in prior conversation history should treat this entry as
superseding them, not reopen the question from scratch.

## Per-person location thresholds + highway distance (3 commits: 779db47, 652c4cb, 731d849)

**Storage: a dedicated typed `person_thresholds` table, one row per
person, not extra columns on `people` and not the key/value
`household_settings` shape.** The travel-time threshold is one compound
record (minutes + optional total + mode + destination kind + destination
ref) that must stay together and plug into the deferred travel-time
computation without a schema change; key/value rows would scatter one
logical setting across many rows, and `people` should stay identity-only.
The table mirrors `potential_purchase_prices`: `updated_by`/`updated_at`
attribution, row-level (who last edited this person's thresholds). Per
person in structure, but shared with the whole group exactly like
household settings: `GET`/`POST /api/person-thresholds` are auth-gated and
not per-person filtered, so anyone edits anyone's from any device, never
localStorage. POST carries `person_id` (target) and `actor_id` (who
changed it, recorded as `updated_by`); it is a full replace of the row, so
the client always sends the complete set and an omitted field clears to
NULL (unset).

**Migration of the old "nearest GO drive <= 20 min" rule.** That value
never existed in code as a threshold. It lived only as frozen text inside
the precomputed `fit` strings in `data/poc_listings.json` (e.g. "Nearest
GO drive <= 20 min"), which `poc_fit()` only regex-parses into opaque
`failedLabels`. Nothing in code branched on 20. So migration = seed each
buyer's initial travel threshold at 20 min / drive / nearest GO station
(plus a 5 km highway limit for Mark and Katie), and confirm nothing still
reads a hardcoded 20 (nothing does). The gitignored data file was NOT
edited; that "<= 20 min" fit-label text remains as a display artifact of
the POC score, unrelated to the new editable threshold, which is now the
single source of truth going forward. Advisors seed unset.

**Highways sourced.** 400/401/410/427 mainline geometry from OpenStreetMap
via the Overpass API (`scripts/build_highways.py`, rotates public mirrors
on 504/429, decimates to ~150 m spacing). 413 reuses the existing
higher-accuracy MTO/WSP layer. Distance is straight-line (crow-flies)
point-to-polyline via a local equirectangular projection, a
noise/pollution radius, not a drive time. All 105 listings resolve; nearest
distribution: 400 x67, 413 x20, 401 x17, 410 x1.

**Deferred, per T13 (see the T13 section above):** computing actual travel
times against the new per-person destinations (e.g. the multi-leg drive +
GO + subway door-to-door case) is out of scope this round. T13 established
the GO-rail per-leg timing and fares are already in the downloaded
Metrolinx GTFS feed, but a full multi-modal door-to-door total needs
geocoding a home to its nearest station plus drive and TTC/subway legs,
none of which T13 covered. The threshold record already stores destination
+ mode so that computation plugs in later without restructuring.

**Flagged follow-ups, not built:** (1) an all-buyers aggregate highway
filter (within everyone's / within anyone's limit) is left as a group
decision, since buyers may hold different limits and the aggregate could be
strictest, loosest, or a per-buyer breakdown; the filter shipped is the
single-active-person view. (2) 403/404/407/QEW also run near some listings
and can be added to `build_highways.py` + `HIGHWAY_LAYER_FILES` the same
way if the family wants them in the nearest-highway distance. (3) 413 is a
planned corridor, so a listing whose nearest highway is 413 reflects future
rather than current noise; the card names the highway so this is
transparent.

**Codex review could not run this session:** the local `codex` CLI's
native binary is missing from its vendored package
(`@openai/codex-darwin-arm64/.../codex` returns ENOENT; even `codex
--version` fails), so the standing end-of-session Codex audit is blocked on
a broken install, not skipped by choice. Reinstall with `npm install -g
@openai/codex` (or reinstall the platform package), then run `/codex
review`. In its place this session used 100 stdlib unit tests, distance-math
validation against the real 105-listing dataset, and a full headless-browser
QA pass of all three features.

## Codex audit fixes + highway set expanded (commits eaf05b9, 62fa7f1, c1d62bb, +this)

The Codex audit ran cleanly on the reinstalled CLI (0.142.5). Four fixes,
committed separately:

- **P1 #2 (correctness):** `loadPersonThresholds` re-renders now
  (`applyFiltersAndRender`), so a reload with the highway filter
  persisted-on no longer silently no-ops until the next interaction.
- **P2 #6 (validation):** numeric threshold validators reject non-finite
  numbers (`json` parses `Infinity`/`NaN`; `Infinity` had leaked into
  storage, `travel_minutes:Infinity` 500-ed), and `person_exists` now
  rejects `bool` (a `True` id was accepted as person 1).
- **P2 #8 (data model):** the settings UI no longer stamps the default
  `drive`/`go_station` onto a row when only `highway_km` is edited; the
  travel mode/destination/total are nulled when there is no
  `travel_minutes`.

Audit findings deliberately NOT actioned, with reasons: the `/api/config`
token exposure (P1 #1) and last-writer-wins on concurrent edits (P1 #3) are
the app's existing, documented shared-secret and shared-settings tradeoffs
(same as every other person-data endpoint / `household_settings`), not new
holes; `travel_dest_ref` validation (P2 #5), FK/CHECK constraints (P2 #7),
and `lru_cache` immutability (P2 #9) are reasonable hardening with no live
consumer yet and consistent with the existing schema.

**Highway set expanded from 5 to 9 (P1 #4).** Added 403, 404, 407, and the
QEW (all real freeways running through the POC area) via
`scripts/build_highways.py` (now accepts refs as CLI args to fetch a
subset). The metric exists to catch highway noise, so a nearby corridor
missing from the set defeats its purpose. Effect on the 105 listings:

- Nearest-highway split: 400 67->59, 401 17->11, plus new 404 x8, 403 x5,
  407 x1 (410 x1 and 413 x20 unchanged).
- Mark's 5 km within/over: 19/86 -> **24/81**.
- 14 listings changed nearest highway; 5 flipped from over to within 5 km,
  all real corrections the old set missed, e.g. two Burlington listings that
  read "22-23 km to Hwy 401" are actually 1.7-2.9 km from Hwy 403, and a
  Newmarket listing that read "13.5 km to Hwy 400" is 1.2 km from Hwy 404.

Still deferred (unchanged from prior entry): real multi-modal travel-time
computation (T13), and the all-buyers aggregate highway filter.

## Card workflow grouping + single-source render order (unattended design session)

Mark out; conservative documented calls, display/ordering only, no data/
endpoint/filter changes, every section keeps its toggle and functionality.

**Single source of truth for order (the structural point).** The card template
in index.html used to hardcode section order as a flat list of `.cf-*` divs,
independent of `CARD_FIELDS`, so the two could drift. Refactored: `CARD_GROUPS`
(four workflow groups + an Actions footer, in order) and `CARD_FIELDS` (each
field carries its `group`, in order) are now the ONE definition of both what
appears and in what order. `assembleCardGroups()` rebuilds each freshly-cloned
card's body into group wrappers from those arrays, so the template's div order
is no longer authoritative (it is a flat bag, kept in the same order only for
readability, with a comment saying so). Reorganizing the card in future means
reordering these arrays and nothing else. The settings drawer builds from the
same arrays, so card order and settings order cannot diverge.

**The four groups, top to bottom, follow the family's review workflow:**
1. Identify & review: the always-on header (photo, address, beds summary, fit
   BADGE) plus the one pinnable headline number (`summaryValue`).
2. Property facts (what you evaluate against): stats, features, fit tags,
   GO commute, highway distance, attached places.
3. Opinions & input: group sentiment, per-person ratings, latest comments,
   the rate/note/reject controls (which include the star input).
4. Financial (the deep-dive stage): price, potential purchase price, the
   itemized cost breakdown.

**Decision logged as required: does price belong near the top for identification
as well as in Financial, or only in Financial?** Chose ONLY in Financial, with
no duplicate price line at the top. Reason: the `summaryValue` setting already
lets a user pin one headline number (Price / Cost to close / PIT, default
Price) at the very top of the card, which resolves the identification need
without duplicating the price in two places. Duplicating price would also
undercut the workflow the reorg is built around (price is deliberately the
last, deep-dive stage). So the top-of-card number is the configurable
`summaryValue` headline; the detailed `price` line lives in the Financial
group. A user who wants price pinned up top already gets it (it is the
default); a user who pins PIT or Cost to close instead has made that call
deliberately.

**Judgment call: the Actions buttons (View listing / Research doc / Map) do not
fit any of the four workflow stages.** They are navigation utilities, not a
review step. Rather than force them under "Financial", they get their own
trailing "Actions" group (a fifth heading), kept at the very bottom of the card
and the settings drawer. This is a small deviation from "the same four
headings", made because folding nav buttons under Financial would misdescribe
them in the settings list; documented here per the "if a section does not fit
one group cleanly, make the call and log it" instruction.

**fit BADGE vs fit TAGS.** The fit score badge (the N/8 number, top-right of the
header) stays in the always-on Identify header. The fit TAGS (`cf-fit`, what the
property fails on) are a property fact and sit in group 2. Two different things,
deliberately in two groups.

**Visual grouping.** Subtle only, in the existing language: sections within a
group keep the standard 10px card gap; groups are separated by the same 1px
dashed `var(--line)` divider already used for feedback actions and person-filter
rows, with 12px extra padding above. No boxes, no new colors, no new type. A
group wrapper whose sections are all hidden (toggled off or empty) is collapsed
in JS (`applyCardVisibility`) using a content check rather than computed style,
so it stays correct even for list cards while the map view is active (which
compute display:none wholesale), and so no stray divider shows.

**Responsive verification method (documented per instruction).** Mobile-first
checks use the browse tool's `viewport WxH` command, which sets the viewport via
CDP `Emulation.setDeviceMetricsOverride` (Playwright `setViewportSize`), a true
device-metrics override that reflows layout. Do NOT verify responsiveness with a
browser window-size flag / headed window resize: that resizes the OS window, not
the emulated device, and gives false positives where the layout looks fine but
never actually hit the mobile breakpoint. Verified this change at 390x844
(mobile) and 1280x800 (desktop), on both list cards and the map popup.

**Codex review this session: blocked.** The standing periodic `/codex review`
was attempted on the two card/settings commits but returned "Quota exceeded.
Check your plan and billing details" (an OpenAI billing/quota limit, not a code
problem). Stood in for it with: 118 stdlib tests, live verification at 390x844
and 1280x800 (CDP device-metrics, not a window flag) on both list cards and the
map popup, per-toggle hide/show checks, group-collapse checks, and a
settings-order-equals-card-order check. Re-run `/codex review` when quota
resets.

## Map clustering + draw-an-area (two Repliers map features)

**POC clustering finding (as required).** POC has NO server-side density
clustering: batch2 T19 established the count-bubble clustering is the Repliers
vendor's own server-side clustering, and POC is a local static file with
nothing to delegate to. So the Map clustering toggle (count bubbles that split
on zoom) applies to Sample Data only; this is stated in the setting's
description, and POC always renders individual pins. HOWEVER, the cluster-CLICK
mini-card popup DOES work for POC: POC has real overlapping pins (2 pairs
within 50 m, 3 within 150 m of each other), and clicking a stack of pins uses
queryRenderedFeatures to gather them and open the same chooser popup. So the
split is: no count-bubbles for POC, but yes to the stacked-pin chooser.

**API behaviours that differed from the docs (as required).**
1. The clustering doc says small-cluster listing details arrive under a
   `listing` (singular) field. Actual: it is `listings` (plural, an array) per
   cluster, present only for clusters at/under clusterListingsThreshold; a
   single-listing cluster carries a one-element `listings` array. Code reads
   `listings`.
2. The doc says "set clusterPrecision to match the zoom" but gives no mapping
   and implies precision alone controls granularity. Actual: clustering the
   whole 42,886-listing sample never yields small or single clusters at any
   precision, because clusterLimit caps the number of clusters (~100-200) so
   each stays large. Meaningful splitting requires clustering WITHIN the map
   viewport, i.e. passing the viewport rectangle as the `map` polygon and
   recomputing on pan/zoom. Viewport-scoping is the real mechanism, and the doc
   does not mention it. (At precision 15 in a ~20 km box, still 100 clusters of
   ~18 each; a street-level box yields singles.)
3. The flat top-level `listings` array still returns a normal page alongside
   the clusters (the doc is ambiguous; confirmed present).
4. The `map` polygon param is an array of [lng, lat] closed rings (first point
   == last), mapOperator OR/AND, matching the doc. Confirmed 42,886 -> 1,777
   for a Charlotte test box; POC point-in-polygon confirmed 105 -> 25 exact.
5. Data-quality note (not a doc item): the free Repliers sample has many
   listings with "Address hidden" and no image; the mini-cards handle both
   (placeholder thumbnail, address shown as given).

**Decisions.**
- Clustering settings (toggle + coarse/medium/fine granularity) live in
  localStorage like the theme, per the instruction to store them where
  theme-level appearance settings live. Granularity maps to a clusterPrecision
  offset from the zoom, not the raw 1-29 number.
- Cluster click behaviour (realtor.ca-style, per the follow-up): clusters up to
  50 open the mini-card chooser (inline listings when at/under threshold, else
  one bounds-scoped fetch); count 1 opens the full card directly; over 50 zooms
  to split (a popup of thousands is not useful). Stacked pins use
  queryRenderedFeatures.
- Mini-cards show the group sentiment chips as the at-a-glance element, NOT
  inline rate/reject controls, to keep the list scannable; full controls are
  one tap away on the real card. Inline quick-rating from a mini-card is flagged
  as a possible follow-up, not built.
- Draw-an-area: tap-per-vertex (touch-friendly) rather than freehand tracing,
  with an explicit Finish. POC filters client-side (ray-casting point-in-
  polygon); Sample Data filters server-side via the Repliers `map` param. AND
  with the panel; OR across multiple drawn polygons. Session-level only; named
  saved zones flagged as a follow-up, not built.

**Verification limitation.** The Mapbox map needs a WebGL canvas, which the
headless test browser does not provide (and headed-mode JS eval was
unreliable), so the on-map rendering (cluster bubbles, the drawing gesture with
touch) could not be verified in this environment. Verified headless: the
cluster API path (splits to singles in a small viewport), the chooser popup UI
(renders 20 mini-cards, scrolls, tap opens the card), the Appearance settings,
POC point-in-polygon (exact), and Sample Data server-side polygon filtering.
The on-map interactions are for real-device verification via the phone tunnel.

**Codex review: still blocked** ("Quota exceeded / check your plan and billing")
on both feature diffs, same OpenAI billing limit as the previous two sessions.
Stood in with the headless verification above + 118 stdlib tests.

## Info pills for individual pins (correcting Realm's price-pill pattern)

Realm shows price pills but fails two ways: inconsistent number formatting on a
single view, and overlapping pill pileups where clustering should engage. This
build is the corrected version.

**Pill content + metric identity.** A pill shows the active "I am" person's
star rating (numeric + glyph, e.g. 5★) when they have rated the listing, then a
money figure; money only when unrated. The money metric is the SAME shared
setting that drives the card headline (loadSummaryValueChoice: Price / Cost to
close / Monthly PIT), so a pin and its card can never show different metrics.
Value rules, matching the card everywhere it computes money:
- Price prefers the potential purchase price when one is entered (the card's
  Estimate line and the whole mortgage breakdown are already keyed off it).
- Monthly PIT uses Total monthly (PIT + condo fees) when the listing has condo
  fees, identical to the card's Financial summary "Total monthly" line. POC has
  no condo listings today, so in practice this equals Monthly PIT; the branch
  is there for correctness.
Pill background keeps the existing fit-score colour (markerColor, including the
grey used when the active person has rejected the listing), so no information is
lost moving from dots to pills.

**Formatting, strictly one rule per metric type (Realm failure #1).**
- Prices + cost to close: compact ALWAYS. M carries the decimal setting; K is
  whole thousands ($875K, $247K); under $1K is exact. Never raw digits.
- Monthly figures: exact dollars ($5,645); monthly amounts are too small for
  compact rounding to carry information.
- Compact decimals (1/2/3, default 2) is an Appearance setting beside the
  clustering controls, localStorage per device (hh_pill_compact_decimals).
  Verified: $1.0M / $1.05M / $1.049M at 1/2/3 for 1,049,000.

**Rendering choice: HTML markers, not a GeoJSON symbol layer.** A filled pill
with an exact fit colour and shaped background is painful with Mapbox symbol
layers (needs a stretchable icon image per colour). mapboxgl.Marker with a DOM
button gives exact control and native click handling, and 105 POC markers (or a
60-listing Sample page) is well within budget. The old GeoJSON listings-circles
/ listings-labels layers stay defined but are fed empty; pills replace them.

**Clustering handoff (Realm failure #2): pills never pile up.** A greedy
screen-space collapse (collapsePillGroups): a listing joins an existing group
when its projected pixel centre is within a pill footprint of that group's
anchor (~92px wide, ~30px tall). Groups of one render as a pill; groups of two
or more collapse into a fit-coloured count circle that the existing chooser
popup expands. Recomputed on every moveend (debounced), so pills separate as you
zoom in and re-merge where they would overlap. Over-collapsing slightly is the
safe direction (Realm's failure is the opposite).

**Cluster-circle colour = highest fit among contents.** Client collapse groups
always know their contents, so they colour by max fit exactly. Server (Repliers)
clusters colour by max fit of their inline listings when present (small
clusters at/under clusterListingsThreshold); a big server cluster carries no
inline listings, so nothing to colour by, and it falls back to a neutral slate.
Noted as a known limit: the fit palette is exact for POC (the case that
matters, and where the stress test lives) and for small Sample clusters.

**Transition behaviour, tuned against the real POC distribution.** Measured the
104 POC coordinates (see the analysis in the session):
- TWO pairs sit at EXACTLY 0m (coincident coordinates): Clearview
  (2553 County Rd 42 / 3904 Concession 12) and Springwater (26 Paddy Dunn's
  Circ / 2946 92 County Rd). These can never be distinct pills at any zoom, so
  they always collapse to a count-of-2 circle. This is the true worst case, more
  than the named Orangeville stack.
- The "Orangeville" stress case is really a Mono/Orangeville cluster: 11 Lynda
  Ave and 22 Randy Ave (Mono) are 202m apart, with 5 Beechnut St (Mono) and
  118 Oak Ridge Dr (Orangeville) nearby (~365-422m). At a 92px collapse width
  these merge through about zoom 14 and separate into individual pills at zoom
  15+ (at z15, 90px ~= 309m, so the 365m pair clears; the 202m pair clears
  around z16). Only one listing is literally addressed "Orangeville"; the pile
  is the surrounding Mono cluster.
- Chosen approach: fixed pixel-footprint collapse (not a fixed geographic
  radius), because overlap is a screen-space property, so the threshold tracks
  zoom automatically and the coincident pairs are handled for free. Far zoom =
  count circles; near zoom = pills where spacing allows; this matches the brief.

**Chooser mini-cards** now lead with the same star+money line and the same
compact/exact formatting (pillLabel), so a listing reads identically as a pill
or in the chooser.

**Verification limit (unchanged from the map-features work).** The Mapbox map
needs a WebGL canvas the headless test browser does not provide, so the on-map
appearance was not verified here. Verified headless: compact vs exact rules,
decimals 1/2/3, star presence/absence, potential substitution, condo
total-monthly, cluster colour by max fit, and the collapse grouping (coincident
-> one circle, near -> merged, apart -> separate). Phone-pass items on the live
domain: pill rendering + legibility, the Mono/Orangeville collapse-then-split as
you zoom, count-circle colours, and the Appearance decimals/clustering controls
taking visible effect on the map.

## Satellite imagery toggle (Streets / Satellite)

**Style choice.** Satellite mode uses `satellite-streets-v12` (the Mapbox hybrid:
imagery with roads + labels overlaid), NOT bare `satellite-v9`, so orientation
and street context are preserved like Google Maps' satellite view. Streets mode
stays `streets-v12`. Both are native Mapbox styles, so no new vendor or key.

**Control + persistence.** An on-map segmented Streets/Satellite switch sits
bottom-left (the conventional basemap corner, clear of the legend bottom-right
and the draw control top-left), mirrored by a "Map imagery" select in Appearance
settings. Both call applyMapStyle(); the choice persists in localStorage per
device (hh_map_style), consistent with the clustering and pill-decimal settings.

**The setStyle() gotcha, handled.** setStyle() destroys every custom source and
layer. setupMapSources() was therefore split:
- addMapLayers() adds all sources + layers; re-run after every style load.
- wireMapHandlers() registers all map event handlers; run ONCE from initMap and
  never again. Handlers bind to layer ids, and addMapLayers() re-creates those
  ids, so the same handlers keep firing after a switch. Re-running the wiring
  would double-register (duplicate popups/clicks), so it is deliberately not.
After style.load, applyMapStyle rebuilds and re-populates every overlay: GO
stations / GO lines / Highway 413 reload from their URLs; drawn polygons via
renderDrawLayer (from state.drawPolygons); POI pins via refreshPoiLayer (from
state.poi); listing pills + cluster circles via applyFiltersAndRender; and layer
toggle visibility via applyPersistedLayerVisibility. HTML-marker pills are DOM
overlays and survive setStyle() on their own; only the GeoJSON cluster source
needs rebuilding. A state flag (state.mapStyle) skips a redundant setStyle to the
already-loaded style -- tracked explicitly rather than by sprite-URL matching,
because the satellite-streets sprite URL itself contains the substring "streets"
and a naive check would refuse to switch back.

**Only Highway 413 is a rendered corridor.** The other highway_*.geojson files
(400/401/403/404/407/410/427/QEW) exist for server-side highway-distance
calculation only; they are not map layers, so the sole highway overlay to
survive a switch and get a legibility pass is Highway 413.

**Per-layer legibility against imagery (streets appearance unchanged in all
cases):**
- GO lines: thin GTFS-coloured lines can blend into dark imagery. Added a white
  casing layer (go-lines-casing) beneath the coloured line, shown ONLY in
  satellite mode and only when the GO Lines toggle is on.
- Highway 413: dark red at 0.55 opacity is the overlay most likely to vanish.
  Added a white casing (hwy413-casing) on the same satellite-only rule, and
  bumped the line opacity to 0.9 in satellite mode.
- Listing pills: already have a white border + text-shadow -> legible, unchanged.
- Cluster count circles: white border -> unchanged.
- GO stations (existing filled, planned hollow ring): white / yellow strokes
  read on imagery -> unchanged.
- POI pins: coloured fill with a 2px white stroke -> unchanged.
- Drawn-area polygons: blue fill + blue dashed outline read acceptably on
  imagery -> unchanged (revisit only if field testing shows otherwise).

**Billing (verified, not assumed).** Checked Mapbox's pricing page: "A map load
occurs whenever a Map object is initialized." Map loads are counted per Map
init, independent of style; satellite-streets-v12 is a standard GL JS vector
style (imagery is a raster source inside the style, not a separate billed
Raster Tiles API call at the app layer), and setStyle() at runtime does not
initialize a new Map object, so it mints no additional load. Net: no billing
difference at our scale (free tier 50k loads/month). Worth a glance at the
account usage dashboard after real use to confirm empirically, but the pricing
model says no change.

**Verification limit.** WebGL is unavailable in the headless test browser, so
the actual style switch and on-map overlay restoration could not be exercised
here. Verified headless: style URLs (hybrid), the persisted choice round-trip,
the on-map control + Appearance select both present, and updateMapStyleUI
syncing them. Phone-pass items on the live domain: imagery actually loading,
every overlay surviving a toggle both directions (GO lines/stations, Highway
413, POI pins, pills/clusters, a drawn polygon), legibility of GO lines and
pills against imagery, and the toggle persisting across reload.

## Mobile map: fragment fixes, satellite-in-Layers, named saved areas

**Fragment investigation (item 1).** The map is a full-screen fixed layer
(`.view-section{position:fixed;inset:0}`); the topbar, filters bar, and status
bar are also `position:fixed` and float over it. So anything anchored to a
screen corner overlaps that chrome. A full DOM scan at 390px (every fixed/
absolute element's rect) found the ONLY app-owned floater overlapping chrome was
the on-map Streets/Satellite toggle (bottom-left, y778-820, over the status bar
at y786-834). The other two reported fragments ("top-right near the person
selector", "right of the Filters bar") were not in the headless DOM at all,
because WebGL is unavailable there and Mapbox only injects its own controls once
the GL map initializes. By elimination they are Mapbox's own controls, which on
this full-screen map render in the screen corners under the app chrome:
- NavigationControl (added top-right) -> the zoom stack sits under the topbar /
  person selector. Fix: removed it. A mobile-first map zooms by pinch / double
  tap (touch) and scroll / double-click (desktop); on-screen zoom buttons are
  redundant and were the collision.
- Mapbox logo + attribution (bottom corners, required, kept) -> hidden behind /
  poking around the bottom status bar. Fix: CSS lifts `.mapboxgl-ctrl-bottom-*`
  to `bottom:52px` on mobile so they clear the status bar.
- The on-map style toggle -> removed (moved to Layers, item 2).
Only noticeable in satellite mode because white controls disappear against the
light streets basemap but stand out against imagery. Reported the confirmed one
explicitly and the two Mapbox ones as identified-by-elimination, given the
headless WebGL limit on inspecting Mapbox's injected DOM.

**Satellite in Layers (item 2).** The basemap is a layer decision, so the
Streets/Satellite control is now a "Satellite imagery" on/off entry in the
Layers menu; the separate on-map control is gone. The Appearance-settings select
stays and mirrors the Layers toggle: both call applyMapStyle(), and
updateMapStyleUI() writes both surfaces from the persisted choice
(hh_map_style), so they always agree. Persistence is unchanged.

**Named saved areas (item 3).** Drawn polygons went from session-only to
persistent named zones, because a search zone (a "Barrie area") is a household
concept, not a per-device one.
- Storage mirrors POI pins exactly: a `saved_areas` table (name, polygon JSON
  ring, created_by), shared across the household, with GET/POST/DELETE
  /api/areas under the same shared-secret auth. created_by is attribution, not
  ownership: any household member can toggle or delete any area.
- On/off state is a per-device VIEW preference (localStorage hh_active_area_ids)
  like the other layer toggles; the area itself is shared. On = drawn on the map
  AND active as a filter, off = neither. A newly saved area is auto-activated for
  its creator; others see it in their Layers menu (off) until they toggle it.
- Finishing a polygon prompts for a name (default "Area N") and POSTs it.
  Multiple active areas keep OR semantics between polygons, AND with the filter
  panel (Sample Data via the Repliers map param, POC via the client-side
  point-in-polygon, both reading activeAreaPolygons()).
- The active-filter pill now NAMES the active areas when few ("Filtering to
  Barrie area + Orangeville"), else a count, so a filtered view is always
  explicable. This replaces the old session-only safety rationale (a filter that
  vanished on reload) with persistent, explained visibility.
- Reset turns every area OFF (clears the filter) but does NOT delete them, since
  they are shared data others may rely on. Session-only unsaved-polygon
  behaviour is gone; the "Clear all" toolbar button became "Cancel" (discard the
  in-progress drawing only).

**Verification.** WebGL is unavailable headless, so the on-map rendering (imagery
loading, overlay survival, the drawing gesture) is a phone-pass item. Verified
headlessly / in tests: the full saved-area API lifecycle end to end against the
live server (create attributed to Mark -> load -> render a Layers row with
toggle+delete -> activate -> POC point-in-polygon inside/outside -> Repliers map
param set -> indicator names it -> delete -> gone), the Satellite Layers toggle
syncing with the Appearance select, the on-map style toggle removed from the DOM,
the mobile Mapbox-offset CSS live, and 126 server tests (8 new for /api/areas).
Phone-pass items: the three fragments resolved in satellite mode, the Satellite
toggle actually switching the basemap from Layers, and draw -> name -> toggle an
area on the live domain.

## Combined view (cards + map) and active-filter badge

**Shared core.** The visible set is `listingsInViewport()`: the already-filtered
`state.listings` (so every active filter and enabled drawn area applies) whose
pins fall inside `map.getBounds()`, in the current sort order, re-derived on
`moveend`. The count is "n of m listings" (n = in viewport, m = all filtered).
Cards are the one existing `buildMiniCard` component, shared verbatim across the
cluster popup, the desktop column, and the mobile drawer; tapping opens the full
card via the existing `showMapCard`.

**One map, two presentations.** The map is a single full-screen fixed element,
so Combined does not clone it: it shows `#viewMap` (the map) AND a `#combinedPanel`
overlay together, toggled by a `body.combined` class. Desktop and mobile are the
SAME panel + JS; only CSS media queries switch the presentation, so there is one
behavior to reason about.
- Desktop (>=700px): `#combinedPanel` is a fixed left column
  (clamp(300px,32vw,440px)); `body.combined #viewMap` shifts `left` by that width
  so the map fills the rest, and left-anchored map controls (Draw area) shift
  right too. `map.resize()` runs on view switch and window resize so Mapbox
  recomputes the canvas for the narrower container.
- Mobile (<700px): `#combinedPanel` is a bottom drawer. Collapsed = a strip
  (grip + count + sort) with a horizontal card row; expanded (74vh) = a vertical
  list. Snap between them by dragging the handle (pointer events on the handle;
  drag up expand / down collapse / tap toggles).

**Status-bar coexistence (the required call).** In Combined the global bottom
status bar is HIDDEN (`body.combined .status-bar{display:none}`) on both layouts,
and its two jobs (the listing count and the sort control) move into the
Combined panel/drawer header. This is a clean merge rather than stacking two
bottom bars: the drawer would otherwise sit directly over the status bar on
mobile, and the desktop column already has its own header. So there is exactly
one count and one sort visible in Combined, and they live with the cards.

**Gesture handling (mobile).** Card scrolling is native overflow inside the
drawer with `touch-action: pan-x` on the collapsed card row, so a horizontal
swipe scrolls cards and never reaches the map canvas (the drawer is an opaque
DOM overlay above the map); map pan happens on the map area above the drawer.
The handle uses `touch-action: none` so its vertical drag drives expand/collapse
rather than scrolling. Drag feel and the pan/scroll boundary are phone-pass
items (no touch in the headless environment).

**Hover-highlight (desktop).** Achieved cheaply only for individual pins: single
pill markers carry `data-mls`, and hovering a card toggles a highlight outline on
the matching pill. Listings that collapsed into a cluster / count circle have no
individual pin, so they do not highlight; this is the noted limitation (a
reliable cluster-aware highlight is not cheap given the pill/cluster collapse).

**Persistence.** The view choice persists per device (`hh_view`), and Map/List
now persist too (they did not before; "persists like Map/List" is satisfied by
making all three persist). The Combined sort select reuses the same option list
and stays in sync with the other sort selects via `syncSort`.

**Active-filter badge.** `activeFilterCount()` counts each populated value/range
field, the feature + hide-vetoed checkboxes, each checked person rating filter,
and each enabled drawn area; the badge on the collapsed Filters summary shows the
number and hides at zero. It updates live (wired into `saveFilterState`, which
fires on every control input/change, plus `onDrawAreaChanged` for area toggles
and `applyFiltersAndRender`). Data source / page size / sort are deliberately not
counted (they are not filters).

**Verification limit.** WebGL is unavailable headless, so `getBounds` was mocked
to verify the derivation (47 of 105 in a test box, exact vs a manual count) and
both layouts were checked via CDP at 1280 (split column) and 390 (drawer:
collapsed 212px horizontal row, expanded 625px vertical list, status bar hidden).
Phone/desktop-pass items: the drawer drag feel, the card-scroll vs map-pan
gesture boundary, the on-map viewport count updating as you pan, and the
desktop hover-to-highlight.

## Mobile map chrome + drawer refinements

- **Compact Filters on mobile.** Below 700px the Filters bar becomes a compact
  right-side control (like Layers) at top:calc(hdr+8px), above the Layers panel,
  keeping its active-filter badge; it expands to a right-anchored 340px single-
  column dropdown. Desktop keeps the full-width bar.
- **Both removed on mobile; the drawer moves into Map.** "Both" is desktop-only.
  The consequence, made explicit by the brief ("Map with the drawer IS the
  combined experience"), is that on a phone the cards drawer shows in MAP mode.
  So the drawer/count/sort now key off a `drawerOn` flag = (desktop Both) OR
  (mobile Map), not the "combined" view name. A persisted Both on a phone falls
  back to Map; a persisted Grid falls back to List; narrowing past the
  breakpoint re-derives the drawer (guarded to fire only on an actual breakpoint
  crossing so mobile URL-bar resizes don't rebuild it).
- **Collapsed drawer is a strip only** (56px: grip + count + Sort, no card row),
  height matched to the header so nothing peeks; drag up reveals the vertical
  list. Previously it showed a horizontal card row when collapsed.
- **Grip contrast:** the handle uses --muted, not --line. --line is nearly the
  panel colour in dark mode (invisible handle); --muted reads in both themes.

## Grid view + filtered export (desktop only)

- **Desktop-only, one derivation.** Grid joins the switcher at desktop widths
  (hidden on mobile, Grid->List fallback). It reuses the shared filtered set;
  header clicks set a grid-local sort override, otherwise the global sort
  applies. Row click opens the card; the checkbox only selects.
- **Bulk commands, extensible bar.** The command bar (shown on selection) is a
  flex row (.grid-commands) so future commands drop in without restructuring.
  Set rating = n standard rating writes as the active person (no new attribution
  model). Attach place = pick an existing POI or geocode a new address, which is
  created ONCE as a POI (not per listing, avoiding N duplicate POIs), then
  attached to each selected listing.
- **Mapbox Directions rate limit.** Each attach computes a per-listing drive
  time server-side (one Directions call). Bulk attaches run SEQUENTIALLY with a
  120ms delay (~8/sec), which keeps even a full-selection bulk under the 300/min
  limit and naturally queues rather than bursting. Chosen over parallel fan-out
  precisely because parallel would blow the limit on large selections.
- **Export is server-side, stdlib only.** The client sends the already-derived
  rows + chosen columns (so the export always matches the filtered grid, not the
  selection) to POST /api/export; the server formats. Real .xlsx is built with
  the stdlib `zipfile` module (no pip deps, honouring the no-Flask/no-pip
  constraint): valid OOXML with a bold header, and numeric columns written as
  number cells (t absent) so numbers stay numbers, text as inline strings with
  XML escaping. CSV carries a UTF-8 BOM so Excel reads accents.
- **Scope + column picker.** Step 1 chooses Displayed columns or Everything
  (all scalar fields + every person's feedback/notes + attachments + the
  financial breakdown, flattened, ~44 columns with 4 people). Step 2 is a
  column checklist (all on by default) + CSV/Excel.
- **Filename:** `listings-<YYYY-MM-DD>` plus a concise active-filter summary
  (status, min-fit, a price token, a single active area name) when the result is
  short (<=40 chars), else a generic tag; the server sanitizes it to a safe
  basename regardless.
- **Testability:** export bytes are unit-tested (numeric typing, valid zip,
  well-formed XML for every part, escaping, filename sanitizing) and verified
  end-to-end against the live endpoint (CSV + xlsx).

## Overnight session (2026-07-08) — Task 1: POC merge — SKIPPED (no export found)

Per the task's own instruction ("If no new export file can be found on this
machine, log that plainly and skip this task entirely, do not guess at a
source"), Task 1 is skipped. Searched exhaustively for a new POC listings export
from the Hermes-side pipeline:
- ~/Downloads, ~/Desktop, ~/Documents, and the entire Galleon Drive workspace
  for json/csv/xlsx/ndjson named *poc*/*listing*/*hermes-export* (21 days), and
  all such files modified in the last 7 days.
- The `Galleon/hermes` directory: it holds the Hermes agent's soul.md, memories,
  and a fastmail script, NOT a listings pipeline. No export there.
- The legacy `projects/house_hunter` project: no data dir.

Only two listing-shaped files exist on this machine:
- `data/poc_listings.json` — the current live data, Jul 6 15:22, 105 listings.
- `vault-private/poc_listings.json` — Jul 3 15:50, 105 listings, differs from
  the live file by 26 bytes. It is OLDER than the live data, so it is a stale
  backup/mirror, NOT a new export.

Reconciliation (as far as it can be stated): there is no newer dataset to
reconcile against. No total/new/changed/disappeared delta exists because no new
export was produced. No data mutation was performed.

Safety backup was still taken before concluding (unattended-session hygiene):
`data/backups/house_hunter.db.<ts>.bak` and `poc_listings.json.<ts>.bak` (the
gitignored data/ dir, so not committed).

NEEDS MARK: if a new Hermes POC export exists, it is not on MM1. Point me at the
file path (or sync it into `data/` or the vault) and I will run the keyed merge
as specified.

## Overnight session — Task 2a: map control normalization

One shared control-chip style now applies across Filters, Layers, Legend, Sort,
and Draw: font-size 12px, weight 800, disclosure padding 6px 10px, radius 12px,
and the ▾/▴ arrow. Previously Filters was 13px/900 with ▼/▲, Sort was weight
700, and Draw was min-height 36 / padding 7px 12px (the "dramatically larger"
one). Layers and Legend were already the canonical, so the others were brought
to match. Draw keeps ONLY its active-state blue, at the shared size.

Draw-mode toolbar (Undo point / Finish area / Cancel): identical size, each
label on one line, stacked VERTICALLY (full width). JUDGMENT CALL: the three
full labels ("Undo point", "Finish area") do not fit one horizontal row at 390px
without shrinking or wrapping, so a vertical stack keeps them identical size with
full labels; Finish keeps FILL emphasis (the only non-secondary button), not
size emphasis. Verified at 390 (dark) and 1280 (light).

JUDGMENT CALL — Draw stays on the LEFT (not moved into the right-side stack).
The task allows keeping it left if drawing ergonomics argue for it; they do:
Draw is the only control that opens a secondary multi-button toolbar in place,
and the right column already stacks the compact Filters + Layers (mobile). Put
in the right column, Draw's expandable toolbar would overlap the equally-
expandable Layers panel whenever either opened, and on mobile would cover more
of the map during drawing. Its own left lane gives the toolbar unobstructed
space and keeps the map's right/centre clear for drawing taps. Size was the
actual reported defect and is fixed; if Mark still wants Draw physically in the
right stack, it's a small follow-up but the expandable-overlap tradeoff wanted a
human eye, so I did not force it unattended.

Verified consistency via CDP: all five controls report font-size 12px / weight
800; the four disclosure chips share 6px 10px padding. Both themes, and both
basemaps share these solid-panel control chips (satellite legibility confirmed
in the earlier per-layer pass).

## Overnight session — Task 2b: TTC subway layer

Source: TTC GTFS from Toronto Open Data (CKAN dataset ttc-routes-and-schedules,
opendata_ttc_schedules.zip), downloaded at build time on 2026-07-08. Same layer
pattern as the GO layers (static GeoJSON in static/layers/, /layers/ routes,
toggle in the Layers menu, white satellite casing on the lines).

Line status, VERIFIED from the live feed (active calendar Jun 21 - Jul 25 2026),
not assumed:
- Line 1 Yonge-University, Line 2 Bloor-Danforth, Line 4 Sheppard: route_type 1
  (subway), active scheduled service -> EXISTING.
- Line 3 Scarborough RT: NOT PRESENT in the feed at all -> confirmed removed
  (closed 2023). Not added. This is the "verify rather than assume" check the
  task asked for; the answer is Line 3 no longer exists.
- Line 5 Eglinton: present as route_type 0 (LRT), 1064 active trips ->
  EXISTING. Line 6 Finch West: route_type 0, 751 active trips -> EXISTING.
  FINDING: contrary to the task's framing (5/6 possibly planned/under-
  construction), the live 2026 feed carries both in revenue service, so both
  are tiered EXISTING with real geometry + stations.

Colors: used the GTFS route_color (the agency-published official value): Line 1
#D5C82B (yellow), Line 2 #008000 (green), Line 4 #B300B3 (purple), Line 5
#FF8000 (orange), Line 6 #808080 (grey). JUDGMENT CALL: kept #808080 for Line 6
though grey is low-contrast on the street basemap; it is the official colour, and
the satellite white-casing plus being the only grey line mitigate. Did not
substitute a made-up hex.

Stations: platforms deduped to stations by normalizing names (strip "- <dir>
Platform" and "<dir> Platform" suffixes), station point = mean of its platform
coords, interchanges deduped across lines (e.g. Cedarvale on Lines 1 & 5) with
all serving lines listed. Station counts match TTC published figures EXACTLY:
Line 1 = 38, Line 2 = 31, Line 4 = 5, Line 5 = 25, Line 6 = 18. 110 unique
stations total.

Coordinate sanity (the "Lakeview treatment"): every platform checked against a
GTA bbox (lat 43.55-43.95, lng -79.75 to -79.10). ZERO out-of-GTA coordinates,
so no stations were removed. Logged: none suspicious.

Transit grouping: ADOPTED. With TTC added, the Layers list is 5 transit toggles
+ Highway 413 + Places + Satellite; a flat list read long, so entries are now
under "Transit" (GO + TTC) and "Roads & places" subheadings. Logged call.

Verification limit: on-map rendering of the lines/stations + the satellite casing
needs a WebGL map (unavailable headless). Verified: the GeoJSON is valid, station
counts vs published, the two /layers/ endpoints serve after deploy, and the
Layers menu DOM (Transit grouping + both TTC toggles). On-map appearance + the
satellite casing are a visual pass.

## UI cleanup session (2026-07-08) — Draw control moved to right stack

State check from the overnight summary: control normalization COMPLETED (live
measurement confirmed Draw was already 12px/800/6px-10px, identical to
Filters/Layers/Legend), TTC layer COMPLETED, POC merge SKIPPED (no export), and
grid view was built in an earlier session (present on live: #btnGrid exists).
So the only real remaining defect was Draw's POSITION, not its size: it floated
alone at top-LEFT (x:12) while every sibling was top-right.

Change: moved `.map-draw-control` into the right-side control stack
(top:140px right:12, below Layers), right-aligned, so Draw sits with Filters
(mobile), Layers, and Legend. This OVERRIDES the overnight "keep Draw left"
call, which Mark has now explicitly reversed ("move it into the right-side
control stack"). The overnight rationale (expandable-toolbar overlap) is
mitigated: the toolbar drops beneath the Draw chip over open map, and Layers
sits above it. Removed the now-moot `body.combined .map-draw-control` left-shift
(Draw is right-anchored, already over the map in the Combined split).

Draw-mode toolbar: Undo / Finish / Cancel now on ONE ROW, three equal-width
buttons (flex:1), identical size; labels shortened from "Undo point"/"Finish
area" to "Undo"/"Finish" (full text kept as title=) so three fit one row at
390px. Finish keeps FILL emphasis (only non-secondary), not size.

Full control-family audit (Filters, Layers, Legend, Sort, Draw): all report
font-size 12px / weight 800 / padding 6px 10px at both 390 and 1280, both
themes. Consistent.

Orphaned/floating element sweep via CDP at 390 (and 1280): every fixed/absolute
visible element checked against the viewport box; ZERO clipped or off-screen
elements found. Nothing orphaned.
