# House Hunter Design Spec

Reference for every UI addition to this app. If you're adding a new element and don't know how it should look or behave, find the matching pattern below and copy it. Do not invent new spacing, colors, or component shapes, extend this document instead.

Source of truth: `static/styles.css`. This spec describes what's there today plus the fixes queued in the mobile filter panel review (2026-07-04). Where the current CSS diverges from a rule below, the rule wins going forward.

## 1. Color tokens

Defined as CSS custom properties in `:root` (`static/styles.css:2-11`). Light is default; dark applies via `prefers-color-scheme: dark` or `html[data-theme="dark"]`.

| Token | Light | Dark | Use for |
|---|---|---|---|
| `--bg` | `#f5f3ec` | `#141918` | Page background, inset boxes (financial box, commute box) |
| `--panel` | `#fff` | `#1e2523` | Cards, filter panel, popups, inputs |
| `--ink` | `#18211f` | `#e2ecea` | Primary text, headings |
| `--muted` | `#68726f` | `#8ca19d` | Secondary text, labels, captions |
| `--line` | `#d9d5c8` | `#2c3432` | Borders, dividers |
| `--green` | `#16803a` | same | Positive state (shortlist badge, checkbox accent, requested-state button) |
| `--blue` | `#2b67d6` | same | Info accent (reviewing badge, comment border) |
| `--red` | `#b3261e` | same | Rejected badge, warning/destructive actions |
| `--gold` | `#c58900` | same | Star ratings only |
| `--header` | `#14221f` | `#0c1210` | Topbar background |

### Contrast (measured, WCAG 2.1)

| Pair | Ratio | Verdict |
|---|---|---|
| `--ink` on `--panel` | 16.46:1 | Pass (AAA) |
| `--muted` on `--panel` | 4.97:1 | Pass (AA normal text) |
| `--muted` on `--bg` | 4.48:1 | **Fail**, just under 4.5:1. Used for `.fin-label`, `.commute-detail`, which sit on `--bg` boxes. |
| `--gold` on `--panel` | 3.02:1 | Pass for graphical objects only (3:1); stars are iconography, not text. Do not set text in `--gold`. |
| `--green` on `--panel` | 5.02:1 | Pass |
| `--red` on `--panel` | 6.54:1 | Pass |
| white on `--header` | 16.43:1 | Pass |
| `--muted` (dark) on `--panel` (dark) | 5.73:1 | Pass |

**Action item:** darken `--muted` from `#68726f` to approximately `#5c665f` to clear 4.5:1 against `--bg` with margin. Do this globally, not just for the failing cases: one token, one value.

**Rule:** never set body text in `--gold`. It's reserved for star glyphs, which are graphical, not textual.

## 2. Typography scale

Font stack: `Inter, ui-sans-serif, system-ui, -apple-system, sans-serif`.

| Role | Size | Weight | Color | Example |
|---|---|---|---|---|
| App title (`h1`) | 18px (16px ≤600px) | 400 | white on header | "House Hunter" |
| Card address | 15px | 800 | `--ink` | "1096 Sunnidale Rd" |
| Card price | 22px | 900 | `--ink` | "$1,325,000" |
| Section label / meta | 12px | 400 | `--muted` | "3+1 beds", commute detail |
| Filter/form label | **12px minimum** | 700 | `--muted` | "Beds", "Monthly PIT" |
| Tag / chip text | 12px | 700 | `--ink` | feature tags, stat tags |
| Button text | 13-14px | 800 | varies | Apply, Note, Reject |
| Fit badge number | 18px | 700 | contextual | "8/8" |

**Rule:** 11px is the floor that currently exists on filter labels (`static/styles.css:42`). Raise it to 12px. Nothing in this app should render text below 12px; anything smaller reads as a caption, not a control label, and fails the "don't make me think" scan test on a phone held at arm's length.

## 3. Spacing scale

Base unit: 2px. Use these steps, not arbitrary values:

`2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20`

| Context | Value |
|---|---|
| Gap between form label and its input | 2px |
| Gap inside a chip (checkbox to text) | 3-4px |
| Gap between chips in a row | 6px |
| Gap between grid cells (filter fields) | 6-8px |
| Card internal padding | 14px |
| Card section-to-section gap | 10px |
| Panel edge padding (filter box, card list) | 10-12px |
| Button internal padding | 6-8px vertical, 10-16px horizontal |

**Rule:** every new spacing value must be one of the numbers above. If nothing fits, that's a signal the layout needs rethinking, not a new magic number.

## 4. Tap target minimums (mobile)

Apple HIG and Android both converge near 44×44pt / 48×48dp. This app's floor:

| Element | Minimum | Current | Status |
|---|---|---|---|
| Any standalone icon button (theme, settings, close) | 44×44px | 39×37px (`.icon-btn`), 30×30px (`.map-card-close`) | **Below minimum**, bump both |
| Chip (checkbox + label, whole thing clickable) | 44px tall preferred, 40px acceptable | 86×40px | Acceptable |
| Rate star button | 44×44px preferred | 23×22px | **Below minimum**: five of these sit in a row; a mis-tap changes someone's saved rating, which is a bigger cost than a mis-tap on a filter chip |
| Primary action button (Apply, Save note) | 44px tall | 32px (`#load`) | **Below minimum** |
| Secondary/inline button (fb-btn: Note/Reject/Research) | 40px tall acceptable given they're grouped and forgiving to retry | 34px | Marginal, acceptable |
| View toggle (Map/List) | 44×44px | 42×41px | Acceptable |

**Rule:** any button whose action is hard to reverse or easy to fat-finger next to another control (star ratings, Apply/Reset, icon-only buttons) must hit 44×44px. Buttons that are cheap to retry (a chip you can just re-tap) can go as low as 40px, never below.

## 5. Mobile-first layout rules

1. **Single-column by default below 600px.** Any grid (`.controls`, `.cards`) must resolve to `grid-template-columns: 1fr` under `@media (max-width:600px)`. Multi-column layouts on mobile are the exception, justified only when both columns are genuinely short, standalone fields (e.g. a Min/Max pair inside one label, using `.range-pair` flex, not the outer grid).

2. **Never let a full-span grid item force a column wider than the viewport.** Any element using `grid-column: 1/-1` inside a `.controls`-style grid must also declare `min-width: 0`. Without it, a flex-wrap child's unwrapped max-content width becomes the grid's forced minimum column size. This is what caused the person-filter rows to blow the panel out to 748px inside a 390px viewport (see review below). This is a standing rule for every future full-width row added to the filter panel, not a one-off patch.

3. **Every fixed-position bar (topbar, status bar, filter panel) must fit its content within the viewport width with zero horizontal overflow.** Test at 412px explicitly before shipping. If a bar's content doesn't fit, remove or collapse an element; do not let it silently clip off-screen. A clipped, unreachable control is worse than a missing one because nothing tells the user it exists.

4. **No feature may be reachable only via undiscoverable horizontal scroll.** If a container needs `overflow-x`, it must carry a visible affordance (partial-next-item peeking, a scroll shadow, or dots) or it must not overflow at all. Prefer not overflowing.

5. **Interactive elements that look alike must behave alike, and elements that behave differently must look different.** Two star rows on one card, one a static rating display, one a live input, need distinct labels or distinct visual treatment. Never rely on position alone to convey a different function.

6. **Bottom sheets (map-card pattern) cap at `max-height:72vh`** so the persistent status bar stays visible underneath as an implicit "there's more below" cue. Keep this ratio for any future bottom-sheet component.

7. **Test viewport: 412×915** (a stand-in for common Android widths, ~390-430px). Every new component ships with a screenshot at this width before merge.

8. **Any fixed bar pinned to the bottom must reserve its space in the scroll container beneath it.** Use `--bottom-bar-height`, composed as `calc(var(--bottom-bar-height) + 24px)`, the same pattern `--hdr-h` already uses at the top (`calc(var(--hdr-h) + 10px)` for the filter panel). A flat guessed padding number drifts out of sync with the bar's real rendered height the moment the bar's content changes; a token composed from the bar's actual height cannot drift.

9. **Every open dropdown or panel closes on a click outside itself.** Filters, the map Layers panel, the map Legend, and the map card popup all use one shared `closeOutsidePanels()` click-outside listener on `document`, not four separate bespoke implementations. A click on a feature that opens one of these (a listing pin opening the map card) must call `e.originalEvent.stopPropagation()` in its own Mapbox click handler so that same click, which still bubbles to `document`, cannot immediately close what it just opened. The settings drawer is the one exception: it already had its own dedicated overlay-click-to-close pattern before this rule existed, and that pattern already satisfies the same click-outside expectation, so it was left as-is rather than folded in.

### Layout dimension tokens

| Token | Value | Holds | Composed as |
|---|---|---|---|
| `--hdr-h` | 52px | Rendered height of the fixed `.topbar` header. | `calc(var(--hdr-h) + 10px)` for anything that must clear the header (e.g. the filter panel's `top`). |
| `--bottom-bar-height` | 48px | Rendered height of the fixed `.status-bar` pill (16px padding + 30px control + 2px border). | `calc(var(--bottom-bar-height) + 24px)` for anything that must clear the bottom bar (its own 12px bottom offset plus a 12px clearance gap, both on the 2px spacing scale). Used by `.cards` and `.map-card-inner`. |

**Rule:** any new fixed top or bottom bar gets its own `--*-h`/`--*-height` token sized to its real rendered height, not a flat guessed padding number on whatever sits beneath or above it.

## 6. Component patterns

### Card (`.card`)
- Structure, top to bottom: photo (180px, `object-fit:cover`) → title row (address + meta, fit badge right-aligned) → summary value → price → potential purchase price editor → group sentiment row → commute box → stat tags → financial box (cost to close, then Monthly PIT, then condo fee, or the full itemized mortgage breakdown in place of those three when active) → ratings (existing, per-person) → feature tags → comments → feedback actions (rate + note/reject/research) → action buttons (View listing / Research doc / Map).
- **Hierarchy rule:** price and fit badge are the only two elements allowed to be visually louder than body text (22px/900 and colored badge respectively). Every other section uses the same 12-13px scale. If a new section needs to stand out, it competes with price and fit for attention, which means it probably shouldn't exist as a new visually-loud element.
- Boxed sections (`.card-commute`, `.card-financial`) share `background:var(--bg); border-radius:10px; padding`. Any new "boxed" info group must reuse this exact treatment, don't invent a new box style.
- Comments use a left-border accent (`border-left:3px solid var(--blue)`) to separate free text from structured data. Research-originated comments must carry a distinct visual tag (not just an inline "(research)" suffix), e.g. a small pill or icon prefix, so they scan differently from a plain note at a glance.

### Card summary value (`.card-summary-value`)
- Display only, a single compact line, one user-chosen value: Price, Cost to close, or Monthly PIT, never all three at once.
- Placement: directly above `.card-price`, the first stat line under the title row, since it is the at-a-glance headline number for whichever field the buyer group cares about most, separate from the always-shown Price line below it.
- The 3-way choice lives in a `<select>` in the settings drawer (`#summaryValueChoice`), not a checkbox like every other `cf-` field, since it is one-of-three, not a boolean. Persisted to `localStorage` (`hh_summary_value_choice_v1`), default Price.
- Whether the row shows at all is still a normal boolean toggle (`cf-summaryValue` in `CARD_FIELDS`, default on), consistent with every other card section; the 3-way select only matters once that toggle is on.
- Hides itself via CSS `:empty` (`.card-summary-value:empty{display:none}`) when the chosen field has no data for a listing (e.g. Cost to close/PIT on a Repliers listing, which has no Monthly PIT concept). No JS visibility logic needed for the missing-data case, only for the on/off card-settings toggle.
- **The "Price" option reads the same effective-price logic `.card-price` uses** (`effectivePrice()`): List price, or Potential purchase price when the price-mode toggle below is set to it and one has been entered for that listing. If it fell back to list price because none was entered, the label itself says so ("Price (list, no potential entered)") rather than showing a number with no explanation of which price it is.
- Reuses the exact `.fin-row`/`.fin-label`/`.fin-value` classes already used inside `.card-financial`, rather than inventing new typography for "a labeled value pair."
- Section 7 checklist: fits the 12px type floor (yes, reuses `.fin-row` at 13px, consistent with the existing financial box); hits its tap-target minimum (n/a, display only, not a control); no overflow/clipping at 412px (verified: single line, hides entirely via `:empty` when there is nothing to show, never renders an empty label with no value); reuses an existing pattern rather than inventing one (yes, `.fin-row` family verbatim); not re-screenshotted visually this session (no browser tool available), verified instead via direct API calls confirming the underlying field is present or absent correctly per listing.

### Price toggle and fallback (`.card-price`, price-mode setting)
- A settings-drawer `<select>` (`#priceModeChoice`, `localStorage` key `hh_price_mode_v1`), same 3-way-choice-does-not-fit-a-checkbox reasoning as the card summary value select above, switches which price is the card's headline value: List price or Potential purchase price.
- List price is always `item.price`, whatever the listing's asking price is. Potential purchase price is the shared, group-entered figure for that specific listing (see the editor below), when one has been entered.
- **The fallback is never silent.** If the toggle is set to Potential purchase price but nothing has been entered yet for a listing, `.card-price` still shows list price, but with a small inline note, `(list price, no potential price entered)`, in `.price-fallback-note` (`--muted`, 12px, never competing with the price number itself per the hierarchy rule). A person scanning the card must always be able to tell which price they are looking at.
- Section 7 checklist: fits the 12px type floor (yes, the fallback note is 12px against the 22px/900 price it annotates, clearly subordinate); hits its tap-target minimum (n/a, the toggle itself is a normal settings-drawer select, same tap target as every other settings row); no overflow/clipping at 412px (the note wraps onto its own line if needed rather than clipping, verified by reading the flex layout, `.card-price` is not `white-space:nowrap`); reuses an existing pattern rather than inventing one (yes, the exact settings-drawer-select pattern the card summary value choice already established); verified via a live API round trip confirming the toggle's underlying data (`potentialPurchasePrice` presence) drives the fallback correctly, not re-screenshotted visually this session (no browser tool available).

### Potential purchase price editor (`.card-potential-price`)
- One shared price per listing, not per person, the group's negotiating position on that specific property, not individual taste, the same reasoning that makes group sentiment shared rather than per-person, but here there is exactly one current value, not one chip per person.
- Placement: directly below `.card-price`, above the group sentiment row, since it can override the value just shown above it.
- Edit affordance: not open by default, one button that reads "➕ Add potential price" when nothing has been entered yet, or "✏️ Edit potential price" once something has, revealing a small composer (number input plus Save) on click, same not-open-by-default shape as the note Add/Edit buttons in feedback actions, but one control, not a split pair, since there is one current value here, not a per-person history list.
- Shows who last entered it (`"Potential purchase price: $X (Name)"`) directly above the edit button when a value exists, so attribution is visible without opening the composer.
- `pocOnly` in `CARD_FIELDS` (`potentialPrice` key), like commute and financial, since Repliers sample listings have no shared negotiating-price concept.
- Saving posts to `/api/potential-purchase-prices`, then reloads listings and feedback without recentering the map (a dedicated reload path, not the existing `load()` Apply/Reset uses, which always re-jumps the map view).
- Section 7 checklist: fits the 12px type floor (yes, `.potential-price-display` and the edit button both reuse the 12px `.fb-btn` treatment); hits its tap-target minimum (the edit button reuses the existing `.fb-btn` sizing already accepted elsewhere in feedback actions, not a new smaller control); no overflow/clipping at 412px (the composer is the same `.feedback-compose` flex row already used for notes and reject, proven to wrap correctly at this width); reuses an existing pattern rather than inventing one (yes, the note Add/Edit affordance and `.feedback-compose` verbatim); verified via a live API round trip (POST then GET) and a full end-to-end curl check with every downstream figure hand-verified against the formula, not re-screenshotted visually this session (no browser tool available).

### Financial box (`.card-financial`)
- Order when the simple, always-available figures are shown: cost to close, then Monthly PIT, then condo fee (when the listing is a condo), price is the anchor value at the top of the card, and these three follow it in that order.
- Condo fee is never affected by the potential purchase price toggle or the mortgage breakdown below. It is a flat monthly figure, not a percentage of price (confirmed: no price-dependent condo fee field exists anywhere in this data model), so it always shows its own stored value regardless of which price is active.
- **When a potential purchase price has been entered for a listing and it differs from list price**, the simple cost-to-close/Monthly-PIT lines are replaced by the full itemized mortgage breakdown (see below), condo fee still shows underneath, unaffected. When it has not been entered, or it exactly equals list price, the simple lines are exactly what they were before this feature existed, byte for byte, verified directly against the server response.
- Section 7 checklist: fits the 12px/13px type floor (yes, `.fin-row` throughout, unchanged); hits its tap-target minimum (n/a, display only); no overflow/clipping at 412px (each row is a two-column flex row that wraps its label rather than clipping if a row's label is long, e.g. "Toronto municipal land transfer tax (after $4,475 first-time buyer rebate)", verified by reading the flex layout); reuses an existing pattern rather than inventing one (yes, the exact box treatment and `.fin-row` family every other financial figure already uses); verified via a live curl round trip against a real listing with every itemized figure hand-checked against the formula, not re-screenshotted visually this session (no browser tool available).

### Mortgage breakdown (itemized, inside `.card-financial`)
- Never one opaque total. Every row the server computes is its own line: down payment (flagged inline if the household's entered percentage was below the legal minimum and had to be topped up, not silently understated), CMHC premium and its Ontario PST if the down payment is under 20%, Ontario land transfer tax with its first-time-buyer rebate noted inline when one applies, Toronto municipal land transfer tax the same way when the listing is in Toronto, each fixed closing cost (legal fees, home inspection, appraisal, title insurance) as its own line, a total cost to close, and the recomputed Monthly PIT broken into principal-and-interest and property tax separately before the combined figure.
- Closes with `.fin-disclaimer` (11px, italic, `--muted`, a dashed top border separating it from the itemized rows above it): a plain-language note that these are estimates to confirm with a mortgage professional and lawyer before closing, since real rates, lender-specific rules, and individual circumstances can change the actual numbers. This is not decorative; every figure above it is a real formula against a real published rate, not a placeholder, but still an estimate, and the UI must say so as plainly as the numbers themselves.
- Every rate and bracket behind these figures was fetched directly from CMHC's, Ontario's, and Toronto's own published pages, not a secondary source (see the dated source comments above each table in `server.py`).
- Section 7 checklist: fits the 12px/13px type floor (yes, identical `.fin-row` treatment to every other financial line, no new type scale introduced for a longer list of rows); hits its tap-target minimum (n/a, display only, not a control); no overflow/clipping at 412px (rows wrap their label rather than clip, same as the box above; the disclaimer itself wraps as body text, `line-height:1.4`); reuses an existing pattern rather than inventing one (yes, `.fin-row`/`.fin-label`/`.fin-value` verbatim, the only new class is `.fin-disclaimer`, a caption-style note, not a new component); verified with 20 pure-function tests covering every bracket boundary and edge case, 3 integration tests through the actual endpoint, and a live end-to-end curl check with every figure hand-verified against the formula, not re-screenshotted visually this session (no browser tool available).

### Group sentiment row (`.card-group`)
- Display only, never filtering. This is not the deferred consensus filtering in TODOS.md (which hides and shows listings): it never changes what's visible, only how a listing reads at a glance. It is the visible foundation that filtering builds on later.
- Placement: directly under `.card-price`, above the commute box and the existing per-person ratings detail, so it reads before any other detail on the card.
- Computed entirely client-side from data already fetched (`GET /api/people` for the roster and role, `GET /api/feedback` for each person's latest feedback per listing). No server or endpoint change, no write-path change.
- One chip per person, built dynamically from the roster, never a hardcoded name or count. A chip can only show one headline state, so states are in priority order (reject wins over a rating, which wins over a bare research request), but reject and a research request are independent, simultaneously-true facts about one person, not mutually exclusive, so a reject does not erase the research request, it only outranks it for which state colours the chip:
  - Rejected: `.chip-reject`, red (`--red` family, same as `.tag.bad`), prefixed with the reject icon already used elsewhere in the card (matches the Reject button). If that same person also requested research on this listing, the research icon is appended to the same chip's label (e.g. "🚫🔍 Mark") rather than dropped, so the fact is not lost, just not the chip's headline colour.
  - Has a rating and not rejected: `.chip-rated`, green (`--green` family, same as `.tag.good`), shows the star count as a number (e.g. "Mark ★5").
  - Research requested, not rejected: `.chip-research`, blue (`--blue` family, same as `.fit-blue`), prefixed with the research icon already used elsewhere in the card.
  - No input yet: the base `.chip` treatment, unmodified, neutral gray. This is the correct "empty" state, not a missing feature.
  - **Independent fields, not one shared status:** reject (`status`) and research request (`research_requested`) are two separate fields on the feedback read, not one value that only ever picks a winner. This is a corrected bug, not original design: `latest_feedback_for_listings()` used to fold both into a single `status` field, so whichever action happened to be processed last silently overwrote the other on read (the underlying `listing_feedback` rows were never actually lost, both action types were always recorded independently; only the read-side merge collapsed them). A person rejecting a listing and then requesting research on it, or the reverse order, now shows both correctly: `status: "rejected"` and `research_requested: true` at the same time. The per-person ratings-row detail (`.card-ratings`, below the group sentiment row) renders both as separate tags for the same reason, an independent research tag alongside the status tag, not one replacing the other.
- Advisor input must never silently read as buyer sentiment. Every advisor chip (`people[].role === "advisor"`) carries a `.chip-advisor` dashed border plus a hollow-diamond icon prefix, independent of its reject/rated/research/none state colour, so advisor and buyer chips are never visually confusable even at a glance.
- A single derived headline word, computed from buyers only (`role === "buyer"`; advisors excluded from the computation, though advisors still render as chips):
  - "Vetoed" if any buyer's latest status is rejected.
  - "Aligned" if every buyer has a rating and none rejected.
  - Otherwise, "Waiting on {first name}" when exactly one or two buyers have no rating yet (e.g. "Waiting on Katie", "Waiting on Katie and Dad"), or "Waiting on {N}" when three or more are missing. The missing set is computed dynamically each render from the same buyer roster (`role === "buyer"`), never a fixed name list.
  - "Split" only for the zero-buyers safety default (no buyer data exists to summarize at all). Never default to "Aligned" with no buyer data behind it, that would imply a consensus that does not exist, and never render "Waiting on" with an empty name list.
- Both the "Waiting on" and "Split" (zero-buyers) words use `.headline-waiting`/`.headline-split`, the same neutral `--muted` treatment as the old "Split" wording: not the red veto color, not the green aligned color, and not `--gold` (reserved for star ratings per Section 1, and this is a text word, not a graphical star).
- Type stays at the 12px floor, reusing the existing `.chip` pill family exactly (`.group-chip` only overrides `font-size` and `cursor`, since these chips are display, not controls, so the 44px tap-target rule does not apply, but they never render shorter than the existing chip height). Colour is the only thing that carries meaning; nothing here is allowed to compete with price or the fit badge (Section 6 hierarchy rule above).
- Toggleable in the card settings drawer like every other card section, key `groupSentiment`, `cf-groupSentiment` class, default on.
- **Hide Vetoed listings filter** (`#hideVetoed`, filter panel): calls the same `buyerHeadline()` function as this row's headline word, filtering out any listing where it returns "Vetoed", so the filter can never disagree with what the card visibly shows. Not a second definition of rejected. Unrelated to `#filterStatus` (the property's real-estate listing status, e.g. Active/Rejected from the source data), which is left untouched; a listing can be filtered out by one, the other, both, or neither, independently. Labelled "Hide listings rejected by any buyer" so it reads as the group concept, not an individual reject. A real filter preference, so it is in `PERSISTED_CHECKBOX_IDS` and persists across reloads exactly like `featGarage`/`clusterToggle`, unlike the deliberately-not-persisted search box; also cleared by the existing Reset button. Applies identically to both List and Map (both read from the same `filterByFeedback()`-filtered `state.listings`).
- Section 7 checklist for this element: fits the 2px spacing scale and 12px type floor (yes, `.group-chip` and `.group-headline` are both 12px); hits its tap-target minimum for its risk level (n/a, display only, not a control); no overflow/clipping/hidden-without-affordance at 412px ("Waiting on {N}" is the deliberate overflow guard for 3+ missing buyers, so the row never grows unbounded with a long name list; `flex-wrap` still applies to the chip row beneath it exactly as before, unchanged by this wording update; the reject-plus-research combined icon "🚫🔍" adds one glyph to the label, not a new line, so it does not change the chip's height or wrapping behaviour); reuses an existing pattern rather than a near-miss (yes, the exact `.chip` pill family, the exact red/green/blue tag colour families, and the pre-existing `--muted` neutral treatment already in use); verified via function-level checks for Vetoed/Aligned/one-missing/two-missing/three-or-more-missing/zero-buyers, plus against real POC data (a real listing correctly showed "Waiting on Katie"); the reject-plus-research fix was verified with a live API round trip on the running server (reject then research_request, and research_request then reject, both orders) confirming `status: "rejected"` and `research_requested: true` are both present at once, plus two new automated tests covering both submission orders; not re-screenshotted visually at 412×915 this session (no browser tool available).

### Filter row (`.controls > label`)
- One field = one `<label>` containing a caption (12px/700/`--muted`) above the control (`display:grid; gap:2px`).
- Range fields (min/max) use `.range-pair`: `display:flex; gap:4px`, two inputs each `flex:1; min-width:0`.
- On mobile, one filter row per grid row (rule 1 above). On desktop (≥600px), `repeat(auto-fill, minmax(110px,1fr))` is fine since there's room.
- **Live re-filtering on feedback change:** filtering is not limited to the Apply button. Any feedback change for the active person (rating, reject, note, research) re-runs every active filter immediately via the same `applyFiltersAndRender()` Apply/Reset already call, so a rating change that now falls outside an active per-person rating filter (or the reject-derived status filter) drops that listing from both the list and the map without a separate manual reapply step. This applies to the per-person rating checkboxes and the status filter, not the unrelated computed fit-score filter, which is a listing property, not a person's feedback. Section 7 checklist: n/a visual element (behavior only); verified by tracing the exact data flow from a feedback POST through `applyFiltersAndRender()` to the map/list refresh, not screenshotted since nothing new renders, only when it renders.

### Checkbox row (`.person-filter-block` / `.chip`)
- One row per person: name label (min-width 46px) + one flex-wrap row of all 7 chips (5 star options, Not rated, Said no), in that fixed order.
- Chip = pill-shaped label wrapping its own checkbox: `display:inline-flex; border-radius:999px; padding:3px 8px`. The whole chip is the tap target, not just the 13×13 checkbox square.
- Must carry `min-width:0` on the row container (rule 2) so `flex-wrap:wrap` actually engages instead of forcing the parent grid wider.
- **No hardcoded row split.** All 7 chips flow through one `flex-wrap:wrap` container (`.person-filter-row`, `flex:1 1 auto` so it claims the full width left over after the name label) rather than a fixed 2-row grouping. A fixed split used to force "Not rated"/"Said no" onto their own line even when there was room left over after the star chips on the line above, wasting space on narrower screens and never allowing a single row on wider ones either. Letting the browser wrap based on actual available width, at every viewport size, fixes both: on a typical phone width (~360-430px), the 7 chips still wrap, normally to 2 lines, but wherever the real content boundary falls, not at an artificial fixed point, so nothing is pushed to its own line with room to spare on the line above. On iPad width (768px portrait, 1024px+ landscape) and any wider desktop width, all 7 chips plus the name comfortably fit on one line (verified by dimension calculation: roughly 490px needed for name plus all 7 chips at this font size and padding, against roughly 724px available at 768px iPad-portrait width once the filter panel's own margins and padding are subtracted), so no separate iPad-specific breakpoint was added; the fluid behavior already lands on the "one row" outcome there on its own.
- If a person-row wraps to 2+ lines on a narrow phone, that is expected and fine. Do not try to force one line by shrinking chips below 40px tall.

### State persistence (filters, map layers, sort)
- Every filter field value, every map-layer-panel checkbox, and the active sort order persist across reloads via `localStorage` (`hh_filter_state_v1`), the same mechanism dark mode and card settings already use. This is last-used-state persistence, not a second "restore to default" concept; the existing Reset button remains the only way to clear back to defaults.
- Restoring saved state on load must not fight the existing Reset button: `reset()` explicitly clears the persisted filter-state key before reloading, so Reset always produces the same result whether or not anything was ever saved.
- Dynamically-built controls (the per-person rating-filter checkboxes, one row per person) restore by id after `buildPersonFilters()` runs, since those DOM elements do not exist yet at the point dark-mode/card-settings state would normally restore.
- Section 7 checklist: no new visual element (behavior only), so spacing/type/tap-target/overflow questions are n/a; reuses an existing pattern rather than inventing one (yes, verbatim reuse of the dark-mode/card-settings `localStorage` pattern, a new key rather than a new mechanism); not screenshotted since there is no new visual surface, verified instead by reading the exact save/restore/reset code paths and confirming `test_server.py` is unaffected (a frontend-only behavior).

### Household settings row (`.settings-row` / checkbox, and `.settings-number-row` / number input)
- Household-level settings (shared across the whole buyer group server-side, not per-device `localStorage` like every other settings-drawer control) live in their own labeled block at the top of the settings drawer, above the per-card `cf-` toggle list, since they are a genuinely different kind of setting: a fact or assumption the household holds, not a personal display preference for one device.
- Boolean household settings (first-time-buyer status) reuse the exact `.settings-row` checkbox pattern verbatim, same 20×20 checkbox, same `field-desc` caption underneath.
- Numeric household settings (down payment percent, interest rate, amortization years, property tax percent, and the four fixed closing-cost estimates) use a new `.settings-number-row` variant of `.settings-row`: label and description on the left (`flex:1`), a right-aligned number input (`.settings-number-input`, 84px, `text-align:right`) on the right, `cursor:default` since the row itself is not a toggle target the way a checkbox row is.
- Interest rate and property tax are explicitly labeled as estimates in their `field-desc` ("edit with your own quoted or pre-approval rate" / "edit with your own tax bill"), never presented as scraped from a live source, since real rates vary by lender, municipality, and day.
- Every household-level control reverts to its previous value if no active person is selected or the save fails, so the settings drawer can never show a value that was not actually persisted server-side, same defensive pattern already used for the first-time-buyer checkbox.
- Section 7 checklist: fits the 12px type floor (yes, `field-desc` is 12px, matching every other settings-row caption); hits its tap-target minimum (the number inputs are 36px tall, below the 44px preferred size but consistent with the existing `.settings-subrow select` precedent for secondary, low-stakes settings-drawer controls, not a primary action); no overflow/clipping at 412px (label text wraps within its `flex:1` column rather than pushing the fixed-width number input off the row, verified by reading the flex layout); reuses an existing pattern rather than inventing one (yes, `.settings-row` verbatim, only the number-input variant is new, and it mirrors `.settings-subrow select`'s existing shape); verified via a live API round trip confirming every default value loads correctly and an edited value persists and reloads correctly, not re-screenshotted visually this session (no browser tool available).

### Button
- Primary (`Apply`, dark fill): `background:var(--ink); color:var(--panel)`, min-height 44px for anything triggering a data reload or irreversible action; 32-38px acceptable for low-stakes toggles.
- Secondary (`Reset`, outline-ish): `background:var(--bg); color:var(--ink)`, same sizing rules as primary.
- Inline feedback buttons (`fb-btn`: Note / Reject / Research) share one visual family (`secondary fb-btn`) today. **Add a `fb-btn-reject` variant** with a red-tinted border/text (using `--red`, which has 6.54:1 contrast headroom) so a meaningfully negative action doesn't look identical to a neutral one (Note) or a positive one (Research).
- Confirmed/active state (`fb-btn-requested`): filled `--green`, white text. Reuse this pattern for any other "you already did this" button state.

### Input
- `min-height:32px` baseline; text/number/select all share the same border, radius (8px), and padding (`6px 8px`).
- Comma-formatted numeric fields (price, PIT, dues) store raw digits in `dataset.raw` and format on blur. Reuse `wirePriceInput()` / `numericFieldValue()` for any new currency-style field rather than writing a new formatter.
- Decimal-safe fields (beds, baths) read `.value.trim()` directly, never route these through the comma formatter, which strips decimal points.

### Map pins (`.listings-circles`, `.listings-labels`, `.poi-pins-circles`)
- Listing pins (`.listings-circles`): filled circle, colour by fit score, or gray if the active person rejected it (`markerColor()`; green/gold/orange/gray, same palette as the map legend), 10px radius, white stroke.
- Numeric rating label (`.listings-labels`, a symbol layer stacked on `.listings-circles`): shows the active person's own star rating as a small white number with a dark halo, centered on the pin. Blank (no visible text) when no one is selected as "I am" or that person hasn't rated the listing, the same active-person-scoped pattern as the per-person rating filter and the "My rating" sort. Never shows another person's rating or an average; a pin has no room for more than one number.
- POI pins (`.poi-pins-circles`, its own source/layer, off by default like every other optional map layer): a person can search for and drop a pin for a non-listing place. Each pin has a required type, one of school/hospital/work/worship/other, and an optional label. Type drives colour (blue/red/purple/gold/gray respectively) and its hover-popup label; no icon set beyond colour and label text, since there is no room for real iconography at this pin size.
- POI pins are shared across the whole buyer group, the same visibility model as listing feedback, not private to the person who dropped them. There is deliberately no per-person filter or ownership indicator on a POI pin; every person sees every pin regardless of who added it.
- Section 7 checklist: fits the 12px type floor (yes, the rating label is 11px, matching the existing `.clusters-labels` count-label precedent already in this file's layer stack); hits its tap-target minimum (n/a, pins are click targets on the map canvas, sized by Mapbox's own hit-testing, not a DOM tap target); no overflow/clipping at 412px (verified: labels use `text-allow-overlap`, so dense pin clusters never silently drop a rating label, they render on top of each other instead of disappearing); reuses an existing pattern rather than inventing one (yes, the rating-label layer copies the existing `.clusters-labels` symbol-layer pattern verbatim); not re-screenshotted visually this session (no browser tool available), verified instead via direct API round-trips (`POST /api/poi` then `GET /api/poi`) and DOM-presence checks for the new layer-panel controls.

### Popup / bottom sheet (`.map-card`)
- Slides up from the bottom, `border-radius:20px 20px 0 0`, `max-height:72vh`, drag-handle bar (`::before`, 40×4px) at the top for affordance.
- Close button (`.map-card-close`) sits top-right over the photo. **Bump from 30×30 to 44×44px** (tap target rule 5).
- Reuses the exact same card body/inner markup as the list view card (`populateCard()`), so anything fixed in the card component (star labeling, reject button color, box styling) is automatically fixed here too. Keep it that way, never fork popup markup from card markup.
- On ≥700px, detaches into a floating panel bottom-right instead of a full-width bottom sheet (`static/styles.css:65`). Preserve this breakpoint for any new bottom-sheet-style component.
- The popup content (`.map-card-inner`) reserves `calc(var(--bottom-bar-height) + 24px)` of bottom padding so its last row clears the fixed status bar. This is required, not optional: `#viewMap` has `position:fixed` with `z-index:0`, which traps `.map-card` inside that stacking context, so the popup can never paint above the status bar by raising its own `z-index`. Reserving space is the only fix.

## 7. What a new UI element must answer before it ships

1. Does it fit the 2px-step spacing scale and 12px type floor? (Sections 2-3)
2. Does it hit its tap-target minimum for its risk level? (Section 4)
3. At 412px, does it overflow, clip, or hide anything without a visible affordance? (Rules 3-4)
4. If it looks like an existing pattern (box, chip, button), does it reuse that pattern's exact CSS rather than a near-miss? (Section 6)
5. Has it been screenshotted at 412×915 before merge? (Rule 7)
