# House Hunter TODOs

Deferred work identified during review, not built in the current plan.

## Consensus filtering

**What:** Dynamic per-person filter rows (one per `buyer_group_member`) plus
group-level consensus filters (everyone likes it, hide if anyone said no,
hide if a veto-power member said no), replacing the POC's hardcoded "Both
like" filter.

**Why:** `DATA_MODEL_NOTES.md` specifies this explicitly as the intended
next step once per-person feedback attribution exists. It's a natural read
on top of the `listing_feedback` table this plan builds, not a separate
data model.

**Pros:** Directly extends the buyer-group model this plan already
generalizes; no new schema needed, just new queries and filter UI.

**Cons:** Filter UI complexity grows with buyer group size (N filter rows);
needs UX thought for what a 5+ person group's filter panel looks like.

**Context:** Not needed for the Anees demo, which only needs individual
actor attribution working, not group consensus views. Picked up once the
`listing_feedback` table (this plan) has real data in it to filter against.

**Depends on:** This plan's `listing_feedback` table and `GET
/api/feedback?listing_ids=...` batch endpoint landing first.

## Real access control

**What:** Authenticated accounts (real login, per-realtor-team or
per-buyer-group access), replacing the shared-secret header token added in
this plan (D3/D11).

**Why:** The current token is an explicitly-documented deterrent against a
random person finding the public tunnel URL, not real security. Anyone
who has the token can read every private note and reject-reason. That's an
acceptable tradeoff for one in-person 4-person demo. It stops being
acceptable the moment a second real workspace (a second realtor team or
buyer group) has independent access to the app, since they'd all share the
same token and the same visibility into each other's data.

**Pros:** Real auth unlocks actual multi-tenancy, which is the whole
commercial direction (per `PROJECT_BRIEF.md`'s realtor-team-workspace
model).

**Cons:** Meaningful infrastructure work: account model, session handling,
per-workspace data isolation. Not justified by a single demo.

**Context:** Revisit when a second real workspace (beyond Mark/Katie/Anees)
is about to get access to the app, not before.

**Depends on:** Nothing from this plan blocks it; it's an independent
future workstream.

## Wire the Chicago-metro query into fetch_repliers()

**What:** `fetch_repliers()` in `server.py` currently sends only `pageNum`
and `resultsPerPage` to the Repliers API, no location filter at all, so
`/api/listings` returns whatever the API's default global sample order is.
Add the verified 50-mile-radius query (`lat=41.8781&long=-87.6298&radius=50`)
so the Repliers data source actually returns the Chicago-metro sample
(197 listings) the demo is meant to prove the pipeline against.

**Why:** T8 confirmed the API supports real server-side location filtering
(`city=`, `lat`/`long`/`radius`), contrary to the earlier assumption that
only local substring filtering was possible. `fetch_repliers()` was written
before this was verified and never used it.

**Pros:** Small, isolated change (add the query params in one function);
makes the Repliers data source demo-realistic instead of an arbitrary
global sample.

**Cons:** None significant. It's a strict improvement over the current
unfiltered query.

**Context:** T8 also found the original "~300 listings" target was an
unverified estimate. The free tier plateaus around 250 total in the whole
Chicago region even at a 200-mile radius, so 197 (50mi, genuinely
metro-scoped) is the realistic number. `PROJECT_BRIEF.md`/the design doc's
"~300 listings" language should be corrected to "~200" alongside this fix.

**Depends on:** Nothing; `REPLIERS_API_KEY` is now in `.env`.

## Canadian vs US mortgage calculator selection during onboarding

**What:** The mortgage/PIT calculator currently assumes Canadian semi-annual
compounding unconditionally. Add a country selection step during onboarding
that sets the correct compounding formula: semi-annual for Canada, monthly
for the US.

**Why:** House Hunter's financial numbers (Monthly PIT, due at closing) are
only correct for a Canadian mortgage. A US buyer group using the same tool
would see a PIT figure computed with the wrong compounding convention,
silently wrong rather than obviously broken.

**Pros:** Small, well-scoped fix once picked up -- one formula branch keyed
off a single onboarding answer, no schema change.

**Cons:** Needs an onboarding step to exist first (there isn't one today --
"I am" actor selection is the closest thing, and country isn't currently
part of that model).

**Context:** Not needed for the current Mark/Katie/Anees/Kevin demo (all
Canadian, Ontario listings). Relevant the moment a US-based buyer group or
market is added.

**Depends on:** Nothing; independent of the current listing_feedback/actor
model.

## Highway 413 geometry is derived/simplified, not the authoritative file

**What:** `static/layers/highway_413.geojson` now uses real MTO/WSP design
geometry (sourced from the project's public ArcGIS Online data --
`EE_CAN_ON_HWY_413_Design_Lines_20260302_PUBIC`, ~78k raw vertices) instead
of straight lines between guessed points, and its 15 interchange points use
real cross-street names and municipalities from the published interchange
list (cross-checked against the "15 interchanges, 4 freeway-to-freeway"
official figure). But the LineString itself is a statistical simplification
(PCA-axis binning + smoothing) of that raw data, not a direct copy of an
authoritative single-alignment file -- MTO doesn't appear to publish one in
that form. 13 of 15 interchange points are placed by proportional distance
along the simplified line using the published km-markers; only the two
freeway-to-freeway interchanges with the least ambiguous published km
figures (410, 427) were cross-validated and corrected against the actual
"Proposed New Structure" bridge-cluster locations in the same source data.
Replace with MTO's authoritative alignment file directly if/when they
publish one, and consider structure-cluster-validating the remaining 11
interchange points the same way 410/427 were.

**Why:** A statistically-derived line and proportionally-placed points are
real improvements over guessed centroids, but they're still an
approximation with a documented, non-zero error margin -- worth being
explicit about rather than presenting as survey-grade.

**Pros:** Already a large accuracy improvement, grounded in the actual
government design data instead of estimation; isolated file swap if a
better source shows up later.

**Cons:** Depends on MTO publishing (or someone digitizing) a cleaner
authoritative centerline; the remaining interchange-placement refinement is
manual, slow work (structure-cluster disambiguation got ambiguous past the
4 freeway-to-freeway junctions, since the same "structure" layer also
includes river/creek bridge crossings unrelated to any interchange).

**Context:** Requested twice -- first pass used municipality centroids
(inaccurate), second pass found the project's public ArcGIS Experience
Builder app, traced its backing web map to the raw FeatureServer layers,
and queried those directly for the real design geometry.

**Depends on:** Sourcing the MTO Environmental Assessment GeoJSON (or an
equivalent authoritative corridor file).

## GO Station popup hover needs richer information

**What:** The GO station hover popup (`app.js`, `go-station-tooltip`)
currently shows only the station name, a "(planned)" suffix for non-
existing stations, and the comma-joined `lines` property. Add: planned
opening date for Planned/Proposed stations, a clearer status description
(not just the raw `"Planned: SmartTrack"`-style string), and a link to the
relevant Metrolinx project page where one exists.

**Why:** A bare status string like "Planned: GO Expansion" doesn't tell
Anees or anyone else when a station might actually open, which matters
for a house-hunting decision (e.g. "is this planned station realistic to
count on in the next 5 years"). A link to the source project page lets
someone verify the claim instead of trusting an unlabeled map pin.

**Pros:** Isolated to the popup's `setHTML()` call and the properties on
each station feature in `go_stations.geojson` -- no architecture change.

**Cons:** Opening dates and project-page URLs need to be sourced per
station (most Planned/Proposed stations don't have a firm date -- many
SmartTrack/GO Expansion candidates are still conceptual, not funded/
scheduled), which is real research work, not a mechanical code change.
Existing (currently operating) stations don't need an opening date at
all, so the popup template needs a status-dependent branch either way.

**Context:** Noted after shipping the existing/planned station layer
split and the real-GTFS station data fix.

**Depends on:** Nothing structurally; needs per-station research (likely
similar to the GTFS/ArcGIS research already done for station coordinates
and the Highway 413 alignment) to fill in real dates and links rather than
guessing them.
