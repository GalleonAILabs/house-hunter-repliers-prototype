# House Hunter: Backlog and Roadmap

Single authoritative list of everything outstanding, prioritized against a
commercial v1 line. Written to be honest and complete for a due-diligence read,
not flattering. Compiled 2026-07-08 by sweeping, in order: TODOS.md; every
"follow-up / deferred / needs-Mark / not-built" note in DECISIONS.md (all
sessions, including the overnight summary); tasks/plan.md; a code-level grep for
TODO/FIXME/HACK/XXX; and the known-deferred checklist, each verified against the
current code before being carried forward.

Effort classes: S (under a day), M (a few days), L (a week or more). Items are
descriptions of remaining work, not promises. Resolved-since-noted items were
dropped and are listed, with why, in the "Verified resolved" appendix so this
sweep is auditable.

Note on sources: the code grep found essentially no TODO/FIXME/HACK/XXX markers
(one comment referencing TODOS.md), so the backlog is documentation-driven, not
buried in code. tasks/plan.md has no unchecked checkbox items; its only "pending"
language refers to Canadian MLS data access, captured under B4.

---

## A. Alpha polish (current family-use app)

Small fixes and UX debt for the single-household app as it exists.

1. **[S]** Wire the Chicago-metro query (`lat=41.8781&long=-87.6298&radius=50`)
   into `fetch_repliers()` so Sample Data returns the metro-scoped ~200 listings
   instead of the arbitrary global default sample. Verified still unwired. Deps:
   none (key is in `.env`).
2. **[S]** POI delete with reference checking: add `DELETE /api/poi` that refuses
   or safely cascades when a pin is referenced by `listing_place_attachments`.
   Pins can be added but never removed today. Deps: none.
3. **[M]** Group-consensus filters (everyone likes it / hide if a veto-power
   member said no), extending the per-person rating filters that already exist.
   "Hide if anyone rejected" (hideVetoed) is built; the aggregate consensus views
   are not. Deps: per-person feedback (built).
4. **[S]** All-buyers aggregate highway-distance filter (within everyone's limit
   vs within anyone's limit). The shipped highway filter is the single active
   person's view only. Deps: per-person thresholds (built).
5. **[L]** Real per-buyer multi-modal commute computation (T13): door-to-door
   drive + GO + subway totals per buyer destination. Today POC listings carry
   precomputed `goMin`/`goTrain`/`goTotal`; place-attachment drive times use
   Mapbox Directions, but the full multi-modal per-buyer commute is not computed.
   GTFS timing/fare findings are documented; the threshold record already stores
   destination + mode so it plugs in without restructuring. Deps: GTFS feed
   (downloaded), geocoding, Directions (in use).
6. **[S]** GO station hover popup enrichment: planned opening date, clearer
   status text, and a Metrolinx project link for planned stations. Deps:
   per-station research.
7. **[S]** Filter-panel grouping pass: the panel has grown (search, ranges,
   per-person, household keywords, source); a visual sectioning pass would help
   scanability. Partial structure exists. Deps: none.
8. **[S]** Inline quick-rating from the cluster/chooser mini-card (today tapping a
   mini-card opens the full card to rate). Deps: none.
9. **[S]** Cloudflare Access gate in front of the tunnel (email one-time-PIN or
   allowed-email list) as the near-term "who can reach the app at all" control,
   distinct from the in-app token. Dashboard-only; the tunnel is already on the
   `galleonglobal.ai` Cloudflare zone. Deps: none.

## B. Commercial v1 (sellable multi-tenant product)

What a multi-tenant, sellable product requires. Security, tenancy, and
compliance detail belongs in `docs/security-compliance-spec.md` (see B8: that
document does not yet exist and must be written; this section references it
rather than duplicating it).

1. **[L]** Real authentication and accounts, replacing the shared-secret header
   token (which is a documented deterrent, not access control). Foundational for
   everything else in B. Deps: none blocking.
2. **[L]** Multi-tenancy with per-workspace data isolation (realtor-team and
   buyer-group workspaces), replacing the single shared database and fixed demo
   `people` table. Deps: B1.
3. **[M]** Permissions and roles (buyer vs realtor vs advisor): who can see and
   edit what within a workspace. The advisor/realtor visual labelling exists;
   enforcement does not. Deps: B1, B2.
4. **[L]** Productionized MLS/listing pipeline beyond the POC static file and the
   Repliers free-tier sample: real feed ingestion, dedupe, refresh, and the
   keyed-merge logic the overnight session specified but could not run (no export
   was present). Canadian access (PropTx/ITSO) is noted as pending in plan.md.
   Deps: data licensing.
5. **[M]** Realtor dashboard: manage buyer groups, listings, and activity across
   a workspace. Deps: B1, B2, B3.
6. **[M]** Property-intelligence layer: generalize and productionize the
   server-computed fields (commute, highway proximity, mortgage) per market,
   rather than Ontario-only and POC-precomputed. Deps: B4, and the mortgage
   generalization in D3.
7. **[M]** Share machinery: invite buyers and advisors to a workspace, controlled
   shareable links, revocation. Deps: B1, B2, B3.
8. **[S]** Write `docs/security-compliance-spec.md` (referenced across B but
   currently absent): PII handling, data retention, auth model, tenant isolation,
   audit logging. This is the reference document B is meant to defer to. Deps:
   none; should precede B1 implementation.

## C. Roadmap (post-v1)

Differentiators after a sellable v1 exists.

1. **[L]** Offer AI: draft offers, BATNA framing, and counter-strategy per
   listing. Deps: v1.
2. **[M]** Multilingual UI plus listing translation. Deps: v1.
3. **[L]** Semantic search over listings (natural-language queries). Deps: B4,
   embeddings infrastructure.
4. **[L]** Voice intake for preferences and notes. Deps: v1.
5. **[M]** Viral / guest mechanics: guest browsing, shareable saved searches,
   referral loops. Deps: B1, B7.
6. **[M]** Correspondence / dialogue threads per property (buyer-realtor
   messaging). Not built. Deps: B1, C7.
7. **[M]** Notification / email delivery (new-match alerts, activity digests).
   Not built (no email/push code exists). Deps: B1, B4.
8. **[S]** PWA install plus web push notifications. Deps: C7.
9. **[M]** Saved-search integration with the Repliers API (server-side saved
   searches and alerts), distinct from the client-side drawn areas already built.
   Deps: B4, C7.

## D. Known technical debt and honest caveats

What a technical due-diligence pass would find. Listing these ourselves is the
point.

1. **Shared-secret auth.** `X-App-Token` is served to the browser via
   `/api/config` by design, so anyone who loads the page has it. It deters a
   random URL-finder, nothing more. Every private note and reject reason is
   readable by anyone with the URL and token.
2. **Single-tenant assumptions baked in.** One shared SQLite database, a fixed
   demo `people` table, no workspace/account concept. Multi-tenancy (B1/B2) is
   not a config change; it touches the data model throughout.
3. **Mortgage math is Canada/Ontario-only and assumes resale.** Canadian
   compounding and Ontario/Toronto land-transfer rules are applied
   unconditionally; a US or out-of-Ontario listing yields a confidently wrong
   number. No new-construction vs resale indicator exists in the data, so
   amortization eligibility is assumed, not checked.
4. **Highway 413 geometry is derived, not survey-grade.** The LineString is a
   statistical simplification (PCA-axis binning plus smoothing) of MTO/WSP design
   data; 13 of 15 interchange points are placed proportionally by published
   km-markers, only the 410 and 427 freeway-to-freeway junctions were
   cross-validated against structure clusters.
5. **12 Planned/Proposed GO station coordinates are unverified.** Carried from an
   earlier unsourced dataset (GTFS only covers operating service). One
   demonstrably corrupt pin (Lakeview, coordinate in Lake Ontario, matching an
   unrelated station 60km away) was removed rather than guessed; the other 12
   passed inspection but were never checked against an authoritative planning
   source.
6. **SQLite plus stdlib HTTP server.** Single-process, single-file DB, no
   migrations framework, no pooling. Correct for one family; not sized for
   multi-tenant load.
7. **POC listing data is a gitignored static file** (~105 listings), not a live
   feed. Real data ingestion is B4.
8. **Repliers Sample Data is an arbitrary global sample** until A1 lands, and the
   free tier plateaus around 250 listings for the Chicago region regardless of
   radius.
9. **TTC Line 5/6 tiered EXISTING from the 2026 GTFS feed** (they carry active
   scheduled service in the feed). If the feed leads on-the-ground reality this
   could mislead; re-tier if wrong. Line 6's official colour is a low-contrast
   grey (#808080) on the street basemap.
10. **No automated frontend tests.** The server has 131 unit tests; `app.js` has
    none. WebGL is unavailable in the headless test browser, so on-map rendering
    (pins, clusters, drawing, TTC/GO overlays) is never machine-verified, only
    checked visually via CDP screenshots.
11. **Codex adversarial review has been quota-blocked for many sessions** (OpenAI
    billing). The standing review gate was substituted with structured
    self-review throughout; independent review is not currently running.
12. **Phone tunnel is run on demand,** not a launchd service, so it stops on Mac
    restart (per CLAUDE.md); the app binds 127.0.0.1 only, so the tunnel is
    required for phone access.

---

## Appendix: verified resolved (dropped from carry-forward)

Source notes that are stale because the work has since shipped. Verified against
the current code.

- **Grid view plus CSV/Excel export** (a known-deferred item): BUILT in an
  earlier session. Verified: `#btnGrid`, `renderGrid`, `/api/export`, and the
  stdlib-`zipfile` xlsx writer are present.
- **TTC subway layer** (known-deferred): BUILT overnight. Verified: Lines
  1/2/4/5/6 geometry plus 110 stations, `saved_areas`-style `/layers/` routes,
  Layers-menu toggles.
- **Saved / named drawn areas**: BUILT (server `saved_areas` table plus
  `/api/areas` GET/POST/DELETE and Layers-menu toggles), resolving the DECISIONS
  note "saved zones flagged as a follow-up, not built."
- **Map control size normalization plus Draw in the right stack**: DONE (control
  chips are one style; Draw moved into the right-side stack this session).
- **POC pin clustering** (batch2 flagged as a real rebuild): addressed by the
  client-side pill-collapse (`collapsePillGroups` / `renderPillMarkers`) that
  merges overlapping POC pins into fit-coloured count circles. The visual-pileup
  concern is resolved; server-side density clustering remains Repliers-only by
  design.
- **Line 3 Scarborough RT**: confirmed removed from the live TTC feed (closed
  2023), so any "add Line 3" assumption is moot.
