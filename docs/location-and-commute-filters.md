# Location and commute: how the pieces work and stack (GAL-61)

This explains every location/commute control in the app, what data each uses,
whether it filters (hides homes) or just labels (badges a home), and how they
combine. They were added at different times, so this is the map of the current
state, plus where it does not yet do what a buyer expects.

## The five pieces

1. **Max commute (min)** — Filters panel.
   - Hides any home whose nearest GO drive (`goMin`, minutes) is over the value.
   - Data: the POC listing's precomputed nearest-GO drive time. Not per person.

2. **Highway distance (km), Min/Max** — Filters panel.
   - Hides homes outside the straight-line distance range to the nearest
     400-series highway (`highwayKm`). Min is the usual control: "at least this
     far" (a noise/pollution buffer). Not per person.
   - Related: the **household highway minimum** (Settings) is one shared km value
     for the group. It drives the card badge ("clears the N km minimum") and can
     seed this filter's Min. It is a household position, not per person.

3. **Drive to attached place (min), Min/Max** — Filters panel.
   - Hides a home unless at least one of its attached places has a drive time
     (minutes) inside the range. It is a single global range in minutes, applied
     to any attached place, not per place and not per type.
   - Data: the Mapbox drive time computed when you attach a place to a home.

4. **Per-buyer travel time** — Settings, per person.
   - Each buyer can set one Max travel time (minutes) + mode + a single
     destination: nearest GO station, or one pinned place.
   - As of GAL-56 this shows a warning on that place's row on the card (red when
     the drive is over the limit, green when within). It does NOT filter the
     list, and it holds only ONE destination per person.

5. **POC fit criteria** — server-side, static per listing.
   - The original 8-point POC fit includes location rules like "Nearest GO drive
     <= 20 min". When a home fails one, the card shows a red "x ..." tag and the
     fit score drops. These are fixed POC data, not user-editable, and are the
     red badges you see at the top of a card.

## How they stack

- The Filters panel controls (1, 2, 3) combine with AND: a home must pass every
  active filter to show. Within "Drive to attached place" the test is OR across
  a home's attached places (any one in range keeps it).
- The per-buyer travel time (4) and the POC fit (5) are labels, not filters:
  they change what a card shows, not which homes appear.
- Nothing today links a specific place to a specific limit with its own unit.

## The gap your examples expose

Your examples want per-place, per-type, mixed-unit limits held at once:
"school max 15 km, work max 30 min, mother-in-law max 1 hour." The current model
cannot express that:

- The per-buyer travel time holds ONE destination, in minutes only.
- The "Drive to attached place" filter is ONE global minutes range across all
  attached places, so it cannot say 15 km for school AND 30 min for work.
- There is no distance (km) option for a travel limit, only minutes (except the
  highway minimum, which is a different concept).

A unified model would let each attached place carry its own limit, per buyer,
in the buyer's chosen unit (km or minutes), and optionally act as a filter, not
just a badge. That is a design change, tracked as its own issue rather than
folded in here.
