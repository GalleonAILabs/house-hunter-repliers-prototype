# Security and compliance spec (GAL-6)

This documents how House Hunter handles data, who can reach it, what is stored
and for how long, and where the current prototype differs from the posture a
multi-tenant V1 needs. It is honest about the current state: this is a
single-household prototype, not a hardened multi-tenant service. Several items
below are gaps with a named target, not claims that the control exists today.

Scope: the House Hunter prototype (stdlib `server.py`, SQLite, vanilla JS
frontend, served over a Cloudflare tunnel). Sources of truth for behaviour are
`server.py` and `CLAUDE.md`; this doc is the security lens over them.

Last updated: 2026-07-11.

## 1. Data inventory and PII

The app stores opinions and household preferences about real homes and the real
people in one buyer group. The sensitivity is less about identifiers and more
about candid judgements ("said no", private notes) that were never meant to be
public.

Stored in the app database (SQLite):

- **People / buyer-group members** (`people`): display name, role (buyer or
  realtor), admin flag. No email, phone, password, or government id. Identity is
  a display-name selector ("I am"), not an authenticated account.
- **Opinions** (`listing_feedback`): per-person ratings, notes, reject/"say no"
  with reason, and research requests, each attributed to a person and timestamp.
  This is the most sensitive data: subjective, candid, and tied to a named
  person.
- **Comments and mentions** (`listing_comments`, `comment_mentions`,
  `comment_reads`, `comment_archives`): free-text discussion per listing, @person
  mentions, and per-person read/archive receipts.
- **Places and areas** (`poi_pins`, `saved_areas`, `listing_place_attachments`):
  pinned places (which can be home/work/school addresses), drawn search zones,
  and place-to-listing attachments with computed drive times. Pinned places can
  themselves be PII (a member's actual workplace or a relative's home).
- **Financial preferences** (`potential_purchase_prices`, `person_thresholds`,
  `household_settings`): per-listing target prices, per-buyer travel limits,
  shared household settings. Reveals budget and constraints.
- **Grid/column grants and prefs** (`person_column_permissions`,
  `person_grid_prefs`): who may see which data groups, and personal column
  layout.

Listing data (addresses, prices, MLS ids) comes from two sources:

- **POC data** (`data/poc_listings.json`): 104 real Ontario listings with
  addresses and links. This file is **gitignored** and never committed. It is
  the family's real shortlist, so it is treated as sensitive.
- **Repliers sample** (`/api/listings` proxy): a US sample slice, not Canadian
  buyer data.

Not stored by the app: no passwords, no payment data, no analytics/tracking, no
third-party cookies.

## 2. Secrets and keys

All third-party API keys are server-side only and must never travel to the
browser or through the `/api/config` bootstrap:

- **Repliers API key** (`REPLIERS-API-KEY`): used server-side to proxy listing
  search. Never exposed; the browser only ever calls our own `/api/*`.
- **Linear API key** and **Anthropic API key**: used server-side by the in-app
  issue reporter to file Linear issues and run the AI first-pass. Never exposed.
- **`APP_AUTH_TOKEN`**: the shared app secret (see auth model). Never returned by
  any endpoint, including `/api/config`.

Deliberately public:

- **Mapbox token** is served to the browser via `/api/config` by design (Mapbox
  public tokens are meant to be client-side). It should be a URL-restricted
  public token scoped to this domain, not a secret token.

`/api/config` returns only `mapbox_token` (public) and `report_enabled` (a
boolean feature flag derived from whether a Linear key is set). It leaks no
secret. Any new field added to `/api/config` must be reviewed against this rule.

Key storage: keys live in the server `.env` (gitignored) and, per the workspace
billing rule, a per-client Anthropic key is stored in the macOS Keychain and
referenced from `.env`. `.env` is never committed; `.env.example` documents the
variable names only.

## 3. Authentication and authorization

Two independent layers, one built and one planned:

### 3a. App-level shared token (built)

`require_auth` requires the header `X-App-Token` to equal `APP_AUTH_TOKEN` on
every `/api/*` call. It **fails closed**: if `APP_AUTH_TOKEN` is unset the
server rejects every request rather than running open. The token is a single
shared secret for the whole household, distributed out of band.

Known limitations (accepted for the prototype, tracked for hardening):

- It is a **single shared secret**, not per-user credentials. Anyone with the
  token has full app access; there is no per-person login.
- The comparison is a plain string equality, not a constant-time compare. Low
  risk over TLS, but a `hmac.compare_digest` swap is a cheap hardening item.
- The "I am" person selector is **attribution, not authentication**: it records
  who an action is for, and it is trivially spoofable by anyone who already has
  the app token. It is not a security boundary between household members.

### 3b. Edge access control (planned, GAL-23)

Cloudflare Access (Zero Trust) in front of the tunnel, gating the domain to an
allow-list of emails (email OTP), so only approved people can load the app at
all, independent of app code. This is the intended real gate for who can reach
the app; the shared token is a secondary deterrent behind it. Until GAL-23 is
enabled, the app is protected only by the shared token at a stable, guessable
subdomain.

### 3c. Column-permission model (built, the multi-tenant foundation)

Data is organised into **column groups**. An admin can deny a group to a
specific person; the server then **strips that group's fields from the payload**
before it leaves the process (`/api/poc-listings`, `/api/feedback`,
`/api/export`). Enforcement is server-side and **fail-closed**: denied data is
absent from the response, never merely hidden in the client. Admin transfer is
an explicit admin-only action. This is the schema and enforcement pattern that a
full multi-tenant role model will build on.

## 4. Tenant isolation

Current state: **single tenant.** One shared database serves one buyer group.
There is no `tenant_id` on any table; every authenticated caller sees the same
household's data (subject to the column-permission stripping above). The
column-permission model is intra-household (which member sees which groups), not
cross-household isolation.

Target for multi-tenant V1 (must precede onboarding a second household):

- A tenant/household id on every row, with every query scoped by it.
- Per-user identity (real login), replacing the single shared token, so
  attribution becomes authentication.
- Authorization checks that combine tenant scope + per-user role + the existing
  column-group grants.
- A test suite that proves no query can return another tenant's rows
  (fail-closed by default).

Until that exists, running more than one real household on one deployment is out
of scope. A second household today means a separate deployment with its own DB
and token.

## 5. Data retention and deletion

Current state:

- The SQLite database lives under the gitignored `data/` directory on the host.
  Backups are written to `data/backups/` (also gitignored) before risky
  operations. There is **no automated retention or purge**; data persists until
  manually removed.
- Deletions are supported at the row level through the app (delete a place, an
  area, a comment archive, reject/un-reject), but there is no "delete all my
  data" / right-to-erasure flow and no scheduled expiry.
- The in-app issue reporter sends captured context (person name, listing id,
  filters, viewport, user agent, an optional screenshot) **to Linear**, a
  third-party processor. That data leaves the app boundary and is retained under
  Linear's terms until the issue is deleted there. Screenshots may contain
  whatever was on screen, so testers should avoid capturing anything they would
  not put in a ticket.

Target for V1:

- A documented retention period and a purge job for stale data.
- A per-person erase path (remove a member and their attributed opinions).
- A note in the reporter UI that submissions go to Linear.

## 6. Audit logging

Current state: **lightweight attribution, no dedicated audit log.** Most tables
carry `created_by` / `created_at` (and some `updated_by` / `updated_at`), so who
created or last changed a row is recoverable, and admin transfer is an explicit
recorded action. There is no append-only log of reads, denials, permission
changes, or logins, and destructive data cleanups are recorded ad hoc in
`DECISIONS.md` and CSV dumps under `data/backups/`, not in a structured audit
trail.

Target for V1:

- An append-only audit table for security-relevant events: permission grants and
  revocations, admin transfer, bulk operations, and (once real logins exist)
  authentication events.
- Retain the existing `created_by`/`updated_by` attribution as the row-level
  provenance layer beneath it.

## 7. Transport and network exposure

- The server **binds `127.0.0.1` only**; it is not reachable on the LAN or the
  public internet directly.
- External access is exclusively through a named Cloudflare tunnel
  (`househunter.galleonglobal.ai`) terminating TLS at Cloudflare, so all remote
  traffic is HTTPS. There is no plaintext path from outside the host.
- Origin cache headers are `no-cache`; a Cloudflare edge browser-cache TTL is
  worked around with an asset cache-bust token, not by weakening origin headers.

## 8. Threat model summary

In scope for the prototype:

- Casual URL discovery of a guessable subdomain: mitigated by the shared token
  today, and by Cloudflare Access once GAL-23 is enabled.
- Secret leakage to the browser: mitigated by the server-side-only key rule and
  the `/api/config` no-secret review.
- One household member seeing another's restricted data: mitigated by the
  server-side column-permission stripping (fail-closed).

Explicitly out of scope for the prototype (accepted risk, tracked for V1):

- A member spoofing another member's identity (shared token + attribution-only
  "I am").
- Cross-household data isolation (single tenant today).
- Insider misuse by anyone holding the shared token.

## 9. Hardening checklist (prioritised)

1. Enable Cloudflare Access on the domain (GAL-23). Highest value, no code.
2. Ensure the Mapbox token served to the browser is a URL-restricted public
   token, not a secret token.
3. Swap the token comparison to `hmac.compare_digest`.
4. Add a reporter-UI note that submissions and screenshots go to Linear.
5. Before any second household: add tenant scoping, real per-user login, and the
   cross-tenant isolation test suite (Section 4).
6. Add the append-only audit table (Section 6) and a retention/purge policy
   (Section 5).

## 10. Related

- Auth and column-permission enforcement: `server.py` (`require_auth`,
  `COLUMN_GROUPS`, the `/api/column-permissions` endpoint), and the
  2026-07-08 column-permission decision in `DECISIONS.md`.
- Edge access gate: GAL-23.
- Tunnel and network setup: `CLAUDE.md` (Server / tunnel sections).
