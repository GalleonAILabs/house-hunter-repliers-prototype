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
random person finding the public tunnel URL, not real security — anyone
who has the token can read every private note and reject-reason. That's an
acceptable tradeoff for one in-person 4-person demo. It stops being
acceptable the moment a second real workspace (a second realtor team or
buyer group) has independent access to the app, since they'd all share the
same token and the same visibility into each other's data.

**Pros:** Real auth unlocks actual multi-tenancy, which is the whole
commercial direction (per `PROJECT_BRIEF.md`'s realtor-team-workspace
model).

**Cons:** Meaningful infrastructure work — account model, session handling,
per-workspace data isolation. Not justified by a single demo.

**Context:** Revisit when a second real workspace (beyond Mark/Katie/Anees)
is about to get access to the app, not before.

**Depends on:** Nothing from this plan blocks it; it's an independent
future workstream.
