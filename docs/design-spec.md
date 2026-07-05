# House Hunter Design Spec

Reference for every UI addition to this app. If you're adding a new element and don't know how it should look or behave, find the matching pattern below and copy it. Do not invent new spacing, colors, or component shapes — extend this document instead.

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
| `--muted` on `--bg` | 4.48:1 | **Fail** — just under 4.5:1. Used for `.fin-label`, `.commute-detail`, which sit on `--bg` boxes. |
| `--gold` on `--panel` | 3.02:1 | Pass for graphical objects only (3:1) — stars are iconography, not text. Do not set text in `--gold`. |
| `--green` on `--panel` | 5.02:1 | Pass |
| `--red` on `--panel` | 6.54:1 | Pass |
| white on `--header` | 16.43:1 | Pass |
| `--muted` (dark) on `--panel` (dark) | 5.73:1 | Pass |

**Action item:** darken `--muted` from `#68726f` to approximately `#5c665f` to clear 4.5:1 against `--bg` with margin. Do this globally, not just for the failing cases — one token, one value.

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

**Rule:** 11px is the floor that currently exists on filter labels (`static/styles.css:42`) — raise it to 12px. Nothing in this app should render text below 12px; anything smaller reads as a caption, not a control label, and fails the "don't make me think" scan test on a phone held at arm's length.

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
| Any standalone icon button (theme, settings, close) | 44×44px | 39×37px (`.icon-btn`), 30×30px (`.map-card-close`) | **Below minimum** — bump both |
| Chip (checkbox + label, whole thing clickable) | 44px tall preferred, 40px acceptable | 86×40px | Acceptable |
| Rate star button | 44×44px preferred | 23×22px | **Below minimum** — five of these sit in a row; a mis-tap changes someone's saved rating, which is a bigger cost than a mis-tap on a filter chip |
| Primary action button (Apply, Save note) | 44px tall | 32px (`#load`) | **Below minimum** |
| Secondary/inline button (fb-btn: Note/Reject/Research) | 40px tall acceptable given they're grouped and forgiving to retry | 34px | Marginal, acceptable |
| View toggle (Map/List) | 44×44px | 42×41px | Acceptable |

**Rule:** any button whose action is hard to reverse or easy to fat-finger next to another control (star ratings, Apply/Reset, icon-only buttons) must hit 44×44px. Buttons that are cheap to retry (a chip you can just re-tap) can go as low as 40px, never below.

## 5. Mobile-first layout rules

1. **Single-column by default below 600px.** Any grid (`.controls`, `.cards`) must resolve to `grid-template-columns: 1fr` under `@media (max-width:600px)`. Multi-column layouts on mobile are the exception, justified only when both columns are genuinely short, standalone fields (e.g. a Min/Max pair inside one label, using `.range-pair` flex, not the outer grid).

2. **Never let a full-span grid item force a column wider than the viewport.** Any element using `grid-column: 1/-1` inside a `.controls`-style grid must also declare `min-width: 0`. Without it, a flex-wrap child's unwrapped max-content width becomes the grid's forced minimum column size — this is what caused the person-filter rows to blow the panel out to 748px inside a 390px viewport (see review below). This is a standing rule for every future full-width row added to the filter panel, not a one-off patch.

3. **Every fixed-position bar (topbar, status bar, filter panel) must fit its content within the viewport width with zero horizontal overflow.** Test at 412px explicitly before shipping. If a bar's content doesn't fit, remove or collapse an element — do not let it silently clip off-screen. A clipped, unreachable control is worse than a missing one because nothing tells the user it exists.

4. **No feature may be reachable only via undiscoverable horizontal scroll.** If a container needs `overflow-x`, it must carry a visible affordance (partial-next-item peeking, a scroll shadow, or dots) or it must not overflow at all. Prefer not overflowing.

5. **Interactive elements that look alike must behave alike, and elements that behave differently must look different.** Two star rows on one card — one a static rating display, one a live input — need distinct labels or distinct visual treatment. Never rely on position alone to convey a different function.

6. **Bottom sheets (map-card pattern) cap at `max-height:72vh`** so the persistent status bar stays visible underneath as an implicit "there's more below" cue. Keep this ratio for any future bottom-sheet component.

7. **Test viewport: 412×915** (a stand-in for common Android widths, ~390-430px). Every new component ships with a screenshot at this width before merge.

## 6. Component patterns

### Card (`.card`)
- Structure, top to bottom: photo (180px, `object-fit:cover`) → title row (address + meta, fit badge right-aligned) → price → commute box → stat tags → financial box → ratings (existing, per-person) → feature tags → comments → feedback actions (rate + note/reject/research) → action buttons (View listing / Research doc / Map).
- **Hierarchy rule:** price and fit badge are the only two elements allowed to be visually louder than body text (22px/900 and colored badge respectively). Every other section uses the same 12-13px scale — if a new section needs to stand out, it competes with price and fit for attention, which means it probably shouldn't exist as a new visually-loud element.
- Boxed sections (`.card-commute`, `.card-financial`) share `background:var(--bg); border-radius:10px; padding`. Any new "boxed" info group must reuse this exact treatment — don't invent a new box style.
- Comments use a left-border accent (`border-left:3px solid var(--blue)`) to separate free text from structured data. Research-originated comments must carry a distinct visual tag (not just an inline "(research)" suffix) — e.g. a small pill or icon prefix — so they scan differently from a plain note at a glance.

### Filter row (`.controls > label`)
- One field = one `<label>` containing a caption (12px/700/`--muted`) above the control (`display:grid; gap:2px`).
- Range fields (min/max) use `.range-pair`: `display:flex; gap:4px`, two inputs each `flex:1; min-width:0`.
- On mobile, one filter row per grid row (rule 1 above). On desktop (≥600px), `repeat(auto-fill, minmax(110px,1fr))` is fine since there's room.

### Checkbox row (`.person-filter-block` / `.chip`)
- One row per person: name label (min-width 46px) + wrapped row of chips.
- Chip = pill-shaped label wrapping its own checkbox: `display:inline-flex; border-radius:999px; padding:3px 8px`. The whole chip is the tap target, not just the 13×13 checkbox square.
- Must carry `min-width:0` on the row container (rule 2) so `flex-wrap:wrap` actually engages instead of forcing the parent grid wider.
- If a person-row would need to wrap to 2+ lines regularly (7 options today), that's expected and fine — do not try to fit it on one line by shrinking chips below 40px tall.

### Button
- Primary (`Apply`, dark fill): `background:var(--ink); color:var(--panel)`, min-height 44px for anything triggering a data reload or irreversible action; 32-38px acceptable for low-stakes toggles.
- Secondary (`Reset`, outline-ish): `background:var(--bg); color:var(--ink)`, same sizing rules as primary.
- Inline feedback buttons (`fb-btn`: Note / Reject / Research) share one visual family (`secondary fb-btn`) today — **add a `fb-btn-reject` variant** with a red-tinted border/text (using `--red`, which has 6.54:1 contrast headroom) so a meaningfully negative action doesn't look identical to a neutral one (Note) or a positive one (Research).
- Confirmed/active state (`fb-btn-requested`): filled `--green`, white text — reuse this pattern for any other "you already did this" button state.

### Input
- `min-height:32px` baseline; text/number/select all share the same border, radius (8px), and padding (`6px 8px`).
- Comma-formatted numeric fields (price, PIT, dues) store raw digits in `dataset.raw` and format on blur — reuse `wirePriceInput()` / `numericFieldValue()` for any new currency-style field rather than writing a new formatter.
- Decimal-safe fields (beds, baths) read `.value.trim()` directly — never route these through the comma formatter, which strips decimal points.

### Popup / bottom sheet (`.map-card`)
- Slides up from the bottom, `border-radius:20px 20px 0 0`, `max-height:72vh`, drag-handle bar (`::before`, 40×4px) at the top for affordance.
- Close button (`.map-card-close`) sits top-right over the photo — **bump from 30×30 to 44×44px** (tap target rule 5).
- Reuses the exact same card body/inner markup as the list view card (`populateCard()`), so anything fixed in the card component (star labeling, reject button color, box styling) is automatically fixed here too. Keep it that way — never fork popup markup from card markup.
- On ≥700px, detaches into a floating panel bottom-right instead of a full-width bottom sheet (`static/styles.css:65`) — preserve this breakpoint for any new bottom-sheet-style component.

## 7. What a new UI element must answer before it ships

1. Does it fit the 2px-step spacing scale and 12px type floor? (Sections 2-3)
2. Does it hit its tap-target minimum for its risk level? (Section 4)
3. At 412px, does it overflow, clip, or hide anything without a visible affordance? (Rules 3-4)
4. If it looks like an existing pattern (box, chip, button), does it reuse that pattern's exact CSS rather than a near-miss? (Section 6)
5. Has it been screenshotted at 412×915 before merge? (Rule 7)
