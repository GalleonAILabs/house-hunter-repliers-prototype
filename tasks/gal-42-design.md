# GAL-42 Design: In-app "Report issue" button filing AI-triaged Linear issues

Status: design, ready to implement. Authored by a Fable 5 planning pass; implemented by Opus. No em dashes or en dashes appear in this document, per project rules.

## A. Configuration and environment

New module globals in `server.py`, next to the existing env block:

```python
LINEAR_API_KEY = os.getenv("LINEAR_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
LINEAR_TEAM_KEY = os.getenv("LINEAR_TEAM_KEY", "GAL")
LINEAR_API_URL = "https://api.linear.app/graphql"
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_TRIAGE_MODEL = "claude-haiku-4-5-20251001"
```

`.env` additions (Mark provisions on the server machine, never committed):
- `LINEAR_API_KEY=lin_api_...`: Linear personal API key. Sent as the raw value of the `Authorization` header (no Bearer prefix).
- `ANTHROPIC_API_KEY=sk-ant-...`: per the CLAUDE.md per-project billing rule, a NEW console key created specifically for this project.

Degradation:
- `LINEAR_API_KEY` empty: `POST /api/report-issue` returns 503 `{"error": "report_unconfigured"}`. `/api/config` gains one boolean `"report_enabled": bool(LINEAR_API_KEY)`, so the client hides the Report button when unconfigured. Never add either key to `/api/config`.
- `ANTHROPIC_API_KEY` empty or the call fails: the issue is still filed (AI is best-effort, Linear filing is the hard requirement).

Team GAL id and Triage state id: resolved by name at call time via one GraphQL query, cached in a module global `_REPORT_TRIAGE_CACHE`. The resolver must never run at import/startup so the server still boots keyless.

## B. Endpoint contract

`POST /api/report-issue`, auth required (`require_auth`, same 401 shape as every other POST).

Request JSON: `description` (required, non-empty, max 5000 chars), `image_base64` (optional, no data: prefix, decoded cap 8 MB), `image_mimetype` (required when image present, one of image/jpeg png webp gif), `context` (optional dict: person_id, person_name, listing_id, listing_address, view, source, filters, viewport {lat,lng,zoom,bearing}, deploy_token, user_agent). Server also captures the request User-Agent header (authoritative) and a server timestamp.

Responses:
- 200: `{"ok": true, "identifier": "GAL-57", "url": "...", "title": "...", "label": "Bug", "duplicate_of": "GAL-31"|null, "ai_triage": true|false, "image_attached": true|false}`
- 400 invalid_request, 401 unauthorized, 413 image_too_large, 503 report_unconfigured, 502 linear_error (only the issueCreate call failing produces 502; AI and upload failures degrade).

Route wiring in `do_POST`: copy the `/api/feedback` block (auth, Content-Length read, JSON parse, dict check), then `data, status = handle_report_issue_post(body, self.headers.get("User-Agent"))`.

## C. Linear integration (stdlib urllib only)

`linear_graphql(query, variables)`: POST JSON to `LINEAR_API_URL`, headers `Authorization: <key>` and `Content-Type: application/json`, timeout 15, raise on missing key / GraphQL errors. Modeled on `fetch_repliers`.

`linear_resolve_triage_context()` (cached in `_REPORT_TRIAGE_CACHE`): resolve team by key GAL; pick the state whose `type == "triage"` (fall back name Triage); collect label ids by lowercased name for bug/improvement/feature/needs-triage. Query:
```graphql
query ResolveTeam($key: String!) {
  teams(filter: { key: { eq: $key } }) {
    nodes { id key states { nodes { id name type } } labels { nodes { id name } } }
  }
}
```

`linear_open_triage_titles()`: returns `[{"identifier","title"}]` of open Triage issues (first 50), `[]` on failure.
```graphql
query OpenTriage($key: String!) {
  issues(filter: { team: { key: { eq: $key } }, state: { type: { eq: "triage" } } }, first: 50) {
    nodes { identifier title }
  }
}
```

`linear_create_issue(title, description, team_id, state_id, label_ids)`:
```graphql
mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier url } }
}
```
`input = {teamId, title, description, stateId, labelIds?}` (omit labelIds when empty). Returns `{identifier, url, id}`.

`linear_upload_image(data, mimetype, filename)`:
1. `fileUpload(contentType, filename, size)` mutation returns `uploadFile { uploadUrl assetUrl headers { key value } }`.
2. PUT raw bytes to `uploadUrl` with `Content-Type: <mimetype>` plus every returned header pair.
3. Return `assetUrl` (embedded in the description markdown as `![tester screenshot](<assetUrl>)`). Return None on failure; caller notes "Image upload failed".

Description markdown (server-side): tester report verbatim, optional image embed, optional possible-duplicate note, a Captured context block (reporter, listing, view/source, filters, viewport, deploy token, user agent from the request header, server timestamp), and a footer line. Strip em/en dashes defensively from outbound title and description: `text.replace("—", ", ").replace("–", "-")`.

Handler `handle_report_issue_post(body, user_agent)`:
1. Validate; 503 if not LINEAR_API_KEY.
2. resolve triage context; 502 linear_error on failure.
3. open_titles (best-effort []).
4. ai = anthropic_triage_firstpass(description, open_titles) (best-effort None).
5. title/labels: AI present -> ai title + type label id; AI absent -> "Tester report: " + first line (70 chars) + needs-triage label id.
6. upload image if present (best-effort).
7. build description, linear_create_issue (the one hard error path -> 502).
8. return 200 body.
Catch outbound failures with (urllib.error.URLError, TimeoutError, ValueError, KeyError, RuntimeError), mapbox_drive style.

## D. Anthropic first-pass (stdlib urllib, no SDK)

Model `claude-haiku-4-5-20251001`. `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`. Body: model, max_tokens 512, system "You triage bug reports ... Respond with JSON only.", one user message embedding the tester report and the open Triage titles (one per line or "none"), asking for JSON with keys title (imperative, <70 chars), type_label (Bug/Improvement/Feature), duplicate_of (identifier or null).

`anthropic_triage_firstpass(description, open_issues) -> dict | None`: returns None when unconfigured or on any failure. Parse the first text content block as JSON, guard title non-empty, label in the enum, duplicate_of matches `[A-Z]+-\d+` AND is one of the fetched open identifiers (model must not invent). Return `{title[:70], type_label, duplicate_of}`.

Fallback when None: file with derived title "Tester report: " + first line, apply needs-triage label, append "AI triage was unavailable for this report." to the description.

## E. Frontend

Button: a new `icon-btn` in the topbar right group, left of the settings gear:
`<button class="icon-btn" id="reportIssueBtn" title="Report an issue" hidden>&#9873;</button>`
Starts hidden; `loadConfig()` unhides when `report_enabled`. Topbar is visible in every view.

Modal: clone the `bulkNoteModal` markup (overlay + `.app-modal` + head/body/status): a textarea `#reportText`, `<input type="file" id="reportImage" accept="image/*">` (no `capture` attr, so iOS offers camera roll), `#reportStatus`, `#reportSend`.

Client logic: open/close wiring; image downscale via offscreen canvas to max 1600px long edge, JPEG quality 0.8, strip the data: prefix; gather context from `state` (activePerson, people name lookup, openMapItem mls/address, activeView, source, filterParams().toString(), map center/zoom/bearing, deploy token parsed from the app.js script src `?v=`, navigator.userAgent); POST with authHeaders(); confirmation: disable Send + "Sending...", on success show "Thanks, filed as GAL-NN." and auto-close after ~2.5s, on error show detail and re-enable. Empty description: inline status, no request.

## F. Test plan (test_server.py)

New class `ReportIssueTests(ServerTestCase)`. Seams are module attributes on `server`, patched in setUp and restored in tearDown (like APP_AUTH_TOKEN): `linear_resolve_triage_context`, `linear_open_triage_titles`, `linear_upload_image`, `linear_create_issue`, `anthropic_triage_firstpass`, plus `LINEAR_API_KEY`/`ANTHROPIC_API_KEY` and reset `_REPORT_TRIAGE_CACHE`. Because the handler calls these as `server.<name>(...)` (module-level lookup), attribute patching works with the live threaded server.

Cases: unauthorized 401; missing/blank description 400; unconfigured 503 + assert `/api/config` has report_enabled false and neither key value leaks; happy path 200 (AI title, correct label id, state id, description contains tester text/person/listing/filters/deploy token); AI-failure fallback (ai_triage false, "Tester report: " title, needs-triage label, "AI triage was unavailable"); image included (decoded bytes match stub args, asset url in description); image-upload failure degrades (200 + "Image upload failed"); bad base64 400 and oversized 413 (patch cap down); duplicate note (description contains GAL-31); and no-network-when-unkeyed unit tests mirroring test_mapbox_drive_returns_none_without_token.

## G. Ordered implementation checklist

1. server.py: env globals, linear_graphql, _REPORT_TRIAGE_CACHE, linear_resolve_triage_context, linear_open_triage_titles, linear_upload_image, linear_create_issue, anthropic_triage_firstpass, handle_report_issue_post, the /api/report-issue branch in do_POST, and report_enabled in /api/config. Em-dash free.
2. test_server.py: ReportIssueTests. Full suite stays green.
3. static/index.html: topbar #reportIssueBtn and the report modal markup.
4. static/app.js: REPORT_ENABLED from config, button unhide, modal open/close, canvas downscale, context gather, fetch, confirmation.
5. Manual local test with real keys (Mark provisions the two .env keys, restart local process).
6. bash scripts/deploy.sh (mandatory; the LaunchAgent does not hot-reload; the new route 404s live until reload).
7. Post-deploy: curl the route to confirm it is live (400 on trivial body), then one real phone-filed report.
8. Linear: In Review, reassign to Mark, testing comment, note the two .env keys Mark must provision.

## Risks to double-check during implementation

1. Exact Linear fileUpload response header names: verify with one real call before trusting the PUT.
2. Team GAL must have Bug/Improvement/Feature/needs-triage labels, else labels are silently skipped by design.
3. No em dashes anywhere including AI output (prompt says so; server strips defensively).
4. The resolver cache must never run at import/startup so the server boots keyless.
5. Quote all shell paths; the repo path contains spaces.
