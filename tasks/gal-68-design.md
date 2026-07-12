# GAL-68 Design: unified per-place, per-buyer travel-limit model

Status: design for sign-off. No code in this issue; it produces the spec that
future build issues implement. Grounded in the current model documented in
`docs/location-and-commute-filters.md` and the code (`person_thresholds`,
`poi_pins`, `listing_place_attachments`). No em dashes.

## 1. Problem

Location/commute controls were added organically and cannot express what buyers
actually want: per-place, mixed-unit limits held at once, per buyer. Example:
"school max 15 km, work max 30 min, mother-in-law max 1 hour." Today:
- "Drive to attached place (min)" is ONE global minutes range across all places.
- The per-buyer travel time (`person_thresholds`) holds ONE destination, minutes
  only, and only badges (does not filter) as of GAL-56.
- There is no km option for a travel limit (only the separate highway minimum).

## 2. Answers to the open questions (recommendations)

1. **Per (place, buyer), not per place shared.** A limit is a personal
   tolerance: Katie's acceptable school commute differs from Mark's. Model it as
   a row keyed by (person_id, poi_id). A place with no row for a person means
   that person has no limit on it (no badge, no filter contribution).

2. **Allow km OR minutes per limit.** Each limit carries a unit. Evaluate it
   against values already computed per (listing, place) in
   `listing_place_attachments`:
   - `min` uses `drive_minutes` (routed drive time, already cached).
   - `km` uses `straight_km` (crow-flies, already stored, cheap and stable).
   This reuses existing data with zero new geocoding or routing.

3. **Both, per limit, filter is opt-in.** Every limit always badges the card
   (pass/fail for that person on that place, the GAL-56 pattern). A limit also
   filters the list only when its `as_filter` flag is on. Default off, so adding
   a limit never silently hides homes until the buyer chooses to filter by it.

4. **Replace the two overlapping controls; keep the two unrelated ones.**
   - REPLACE "Drive to attached place (min)" (one global range): superseded by
     per-place limits. Remove the control once limits ship.
   - REPLACE the `person_thresholds` single-destination travel limit: migrate a
     row that points to a poi into a place limit; a row pointing at "nearest GO"
     stays as the Max commute concept (see below).
   - KEEP "Max commute (min)" (nearest GO drive) and "Highway distance (km)" as
     separate top-level filters. GO commute is not an attached-place concept;
     highway distance is a listing property, not a place. Folding them in would
     overload the model for no gain in Alpha.

5. **Group consensus: strict filter + per-person pass/fail badges.** On the card,
   an attached place shows each buyer's limit result (who clears it, who does
   not), extending the current single-active-person badge. For the list filter,
   reuse the GAL-19 consensus pattern: a home passes when every buyer with a
   filtering limit on any of its attached places clears that limit (strict). A
   later mode can relax this ("hide only if a veto member fails"), but strict is
   the safe default.

## 3. Data model

New table (per-(buyer, place) limit):

```sql
CREATE TABLE IF NOT EXISTS place_limits (
    person_id INTEGER NOT NULL REFERENCES people(id),
    poi_id INTEGER NOT NULL REFERENCES poi_pins(id),
    value REAL NOT NULL,                       -- the limit magnitude
    unit TEXT NOT NULL CHECK (unit IN ('km', 'min')),
    as_filter INTEGER NOT NULL DEFAULT 0,      -- 0 = badge only, 1 = also filters
    updated_by INTEGER REFERENCES people(id),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (person_id, poi_id)
);
```

Evaluation input already exists: `listing_place_attachments` holds, per
(listing, poi), `straight_km`, `drive_minutes`, `drive_km`. A limit is checked
against the attachment for the listing being evaluated. No new computation.

Pass/fail for (listing, poi, person):
- measured = `drive_minutes` if unit is `min`, else `straight_km`.
- If measured is null (drive time not yet computed), the result is `unknown`
  (badge says "cannot check", never silently fails a filter).
- Else pass = measured <= value.

## 4. Endpoints

- `GET /api/place-limits?person_id=N` -> that person's limits (or all, the set is
  small). Include in the existing people/threshold bootstrap to avoid a round
  trip.
- `POST /api/place-limits {person_id, poi_id, value, unit, as_filter}` -> upsert.
- `DELETE /api/place-limits {person_id, poi_id}` -> remove a limit.
Auth: the acting person sets their own limits (person_id must match the active
actor); no admin gate (a limit is personal, not household policy).

## 5. UI

**Setting a limit (per place, per person).** In the place's own management (the
Layers-menu place list row, or a place detail), each person sees "My limit:
[value] [km|min] [ ] also filter the list". Because a limit is per place (not per
listing), it is set once and applies to every listing that place is attached to.

**Card (per listing).** The "Attached places" section already badges the active
person's limit (GAL-56). Extend to:
- Show the active person's pass/fail/unknown for each place that has a limit.
- Optionally expand to a group breakdown ("OK for Mark and Katie, over for
  Anees") when more than one buyer has a limit on that place.

**Filter panel.** Remove "Drive to attached place (min)". Add a single "Attached
place limits" consensus control (mirrors GAL-19): Off / "Homes that clear my
filtering limits" / "Homes that clear everyone's filtering limits". Only limits
with `as_filter = 1` participate.

## 6. Filter semantics (precise)

Let F = the set of (person, poi) limits with `as_filter = 1`.
A listing L passes the "everyone" mode when, for every limit (person, poi) in F
whose poi is attached to L, the pass/fail for (L, poi, person) is pass or
unknown. `unknown` never hides (drive time not computed yet). A limit whose poi
is not attached to L does not apply to L. This ANDs with all other filters.

The "my filtering limits" mode restricts F to the active person.

## 7. Migration and consolidation

1. Ship `place_limits` + per-place limit UI + card badges (reusing GAL-56).
2. Migrate `person_thresholds`: for each row with `travel_dest_kind = 'poi'` and
   a `travel_dest_ref`, create a `place_limits` row (unit `min`, value
   `travel_minutes`, `as_filter` per whether it was ever a filter, default 0).
   Rows with `travel_dest_kind = 'go_station'` map to the existing Max commute
   filter and are left alone. After migration, retire the per-buyer travel-time
   fields from the settings UI.
3. Remove the global "Drive to attached place (min)" range control and its
   filter code.
4. Update `docs/location-and-commute-filters.md`: pieces 3 and 4 collapse into
   this one model; Max commute and Highway distance remain.

## 8. Phasing (each a buildable issue)

- **68a Build:** `place_limits` schema + endpoints + per-place limit UI + card
  pass/fail badge for the active person (opt-in filter for the active person).
- **68b Build:** group breakdown badges + the "everyone clears" consensus filter
  mode (reuse GAL-19 wiring).
- **68c Build:** migrate `person_thresholds` poi limits, remove the global
  "Drive to attached place" control, update the docs.

## 9. Risks and notes

- Keep `unknown` (uncomputed drive time) non-hiding, or a new place with no
  computed drives would wrongly empty the list.
- Straight-line km vs routed km: km uses straight-line for stability and zero
  cost; if buyers expect driving distance, `drive_km` is available and the unit
  set could later add `road-km`. Start with straight-line.
- This model subsumes GAL-56 (badge) and the GAL-20 aggregation question (which
  was moot for highway distance but is the real thing here for travel time).
- No change to Max commute (GO) or Highway distance; they stay top-level.
