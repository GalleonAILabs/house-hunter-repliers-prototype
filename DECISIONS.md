# Batch 2 Decisions Log

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
