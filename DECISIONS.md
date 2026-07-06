# Batch 2 Decisions Log

This file records every ambiguity resolved without stopping to ask, per the
batch kickoff instructions. Entries are added as work proceeds. A summary
section is added at the top once the batch is complete.

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
