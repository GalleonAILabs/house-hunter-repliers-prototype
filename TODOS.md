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

## Cloudflare Access gate in front of the tunnel

**What:** Put Cloudflare Access (Zero Trust) in front of
`https://househunter.galleonglobal.ai`, gating it behind an email
one-time-PIN or allowed-email-list policy, so only approved people
(Mark, Katie, Anees, Kevin) can reach the app at all. A network-layer
gate at Cloudflare, in front of the app, not a change to the app's own
auth.

**Why:** The app now lives at a stable, guessable subdomain on the
primary business domain (`galleonglobal.ai`), always-on, with only the
shared-token deterrent (D3/D11) protecting it. That token is served
unprotected via `GET /api/config` by design, so anyone who loads the
page has it. A stable public URL is more discoverable than the old
random tunnel URLs were, so a real access gate is worth more now than
it was on the throwaway `*.loca.lt` / `*.trycloudflare.com` URLs.

**Pros:** Free on the Cloudflare Zero Trust plan (up to 50 users);
no app code change (policy lives in the Cloudflare dashboard, enforced
at the edge before traffic reaches `server.py`); email-PIN needs no
account setup for the people being let in; complements rather than
replaces the in-app actor model.

**Cons:** Adds a login step before the app loads (one-time PIN per
device/session), which is friction for an in-person demo where you
just want to hand someone the URL; requires the tunnel hostname to be
added as an Access application in the Cloudflare Zero Trust dashboard.

**Context:** Offered right after the stable named tunnel + persistence
work landed (the URL is now always-on at `househunter.galleonglobal.ai`).
This is the lightweight, near-term middle ground between today's
shared-token deterrent and the full per-workspace auth in "Real access
control" above: it controls *who can reach the app at all* without
building the account/session/data-isolation model that real
multi-tenancy needs. If the app stays single-workspace (one family
group), Access may be all the protection it ever needs.

**Depends on:** Nothing blocking. The tunnel is already on the
`galleonglobal.ai` Cloudflare zone, so adding an Access policy is
dashboard-only. Can be set up in one session on request.

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

## Mortgage calculator is Canada/Ontario only, and assumes resale

**What:** A real mortgage calculator now exists (`compute_mortgage_breakdown()`
in server.py): down payment against the federal minimum, CMHC premium
by LTV tier plus the extended-amortization surcharge, Ontario PST on
the premium, Ontario land transfer tax with the first-time-buyer
rebate, Toronto municipal land transfer tax with its own rebate when
the listing is in Toronto, fixed closing costs, and a recomputed
Monthly PIT. Every rate and bracket was fetched directly from CMHC's,
Ontario's, and Toronto's own published pages. It only activates for the
potential purchase price a person enters on a listing, when that price
differs from list price; the original `pitNum`/`dueNum`/`condoFeeNum`
figures (the family's own externally-produced numbers) are never
touched by it.

**Still Canada/Ontario only:** the calculator assumes Canadian
semi-annual-style monthly-compounding mortgage math and Ontario-specific
land transfer tax rules unconditionally. A US buyer group, or an
Ontario buyer group considering a property outside Ontario, would get
a confidently wrong number, not an obviously incomplete one. Not needed
for the current Mark/Katie/Anees/Kevin demo (all Canadian, Ontario
listings). No onboarding flow or country input exists to key a US
formula off of if this is ever picked up.

**Unverified assumption still open:** the POC listing data has no field
indicating new construction versus resale (confirmed: no such key
anywhere in `data/poc_listings.json`'s field list). The calculator
treats every listing as resale for now (it does not enforce or check
amortization eligibility at all, it takes `amortization_years` from
household_settings as given, whatever a person sets it to), since
resale is almost certainly correct for this family's actual search, but
it is still an assumption, not a verified fact from the data.
New-construction buyers are eligible for 30-year insured amortization;
resale repeat buyers are not. This needs to be either confirmed per
listing or asked directly before treating the amortization_years
setting as something the household is actually eligible for, rather
than just a number the calculator will use without checking.

**Depends on:** Nothing blocking; can be picked up independently. A
country selection step and a new-construction indicator would both need
an onboarding flow or a new per-listing field that does not exist yet.

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

## Planned/Proposed GO station coordinates are unverified, not just approximate

**What:** `static/layers/go_stations.geojson`'s 67 currently-operating
stations use real Metrolinx GTFS `stop_lat`/`stop_lon` values (see the
commit that replaced synthetic coordinates with GTFS data). The 12
Planned/Proposed stations do not: GTFS only reflects currently-operating
service, so there is no real coordinate to fetch for a station that
does not exist yet, and these 12 were carried over unchanged from an
earlier, unsourced dataset. One of them, Lakeview, was removed rather
than corrected: its coordinate sat in Lake Ontario, its own `status`
field said "Lakeshore East extension" while its own `lines` field said
"Lakeshore West" (Lakeview is a real Mississauga redevelopment site on
the Lakeshore West corridor, not Lakeshore East, which runs the opposite
direction toward Oshawa), and its longitude was an exact digit-for-digit
match with Innisfil, an unrelated station roughly 60km away on a
different line. That is corrupted data, not just an approximation, so no
replacement coordinate was guessed.

**Why:** The remaining 12 did not show that same internal
self-contradiction or an implausible shared coordinate with an unrelated,
distant station, so they were left in place rather than removed. But
"did not show a red flag on inspection" is not the same as "verified
against a real source." No authoritative source (a Metrolinx GO
Expansion planning document, an environmental assessment, a municipal
official plan) has been checked against any of them.

**Pros:** Removing Lakeview fixes the one demonstrably wrong, reported
pin without inventing a new guess in its place.

**Cons:** The map now shows 12 Planned/Proposed stations, not 13, and
Lakeview (a real, publicly discussed proposal) is simply absent until a
real coordinate is sourced, rather than shown in an approximately-right
place.

**Context:** Reported as a pin sitting in Lake Ontario, found via a user
screenshot.

**Depends on:** Sourcing each Planned/Proposed station's real proposed
location from Metrolinx's GO Expansion program materials or an
equivalent authoritative planning document, the same kind of source
the Highway 413 entry above depends on for its own remaining gaps.

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
