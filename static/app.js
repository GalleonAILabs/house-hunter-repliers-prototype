// ─── Dark mode ────────────────────────────────────────────────────────────────
const THEME_KEY = 'hh_theme';
const themes = ['auto', 'light', 'dark'];
const themeEmoji = { auto: '🌓', light: '☀️', dark: '🌙' };

function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'auto';
  document.documentElement.dataset.theme = saved;
  const btn = $('themeBtn');
  if (btn) btn.title = 'Theme: ' + saved;
  if (btn) btn.textContent = themeEmoji[saved];
}

function cycleTheme() {
  const current = document.documentElement.dataset.theme || 'auto';
  const next = themes[(themes.indexOf(current) + 1) % themes.length];
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  const btn = $('themeBtn');
  if (btn) { btn.title = 'Theme: ' + next; btn.textContent = themeEmoji[next]; }
}

// ─── Map clustering (Appearance preference) ─────────────────────────────────────
// Stored in localStorage alongside the theme (an appearance preference per
// device, same place theme lives). Applies to Sample Data (the Repliers feed)
// only: POC is a local static file with no server-side clustering to delegate
// to (batch2 T19 confirmed the clustering is Repliers-vendor-specific), so POC
// always shows individual pins. Granularity maps coarse/medium/fine to a
// clusterPrecision offset rather than exposing the raw 1-29 number.
const MAP_CLUSTER_KEY = 'hh_map_clustering';
const MAP_CLUSTER_GRAN_KEY = 'hh_map_cluster_gran';
const CLUSTER_GRANULARITIES = [
  { value: 'coarse', label: 'Coarse', offset: -2 },
  { value: 'medium', label: 'Medium', offset: 1 },
  { value: 'fine',   label: 'Fine',   offset: 4 },
];
function mapClusteringOn() { return localStorage.getItem(MAP_CLUSTER_KEY) === 'on'; }
function setMapClustering(on) { localStorage.setItem(MAP_CLUSTER_KEY, on ? 'on' : 'off'); }
function mapClusterGranularity() {
  const g = localStorage.getItem(MAP_CLUSTER_GRAN_KEY);
  return CLUSTER_GRANULARITIES.some(o => o.value === g) ? g : 'medium';
}
function setMapClusterGranularity(g) { localStorage.setItem(MAP_CLUSTER_GRAN_KEY, g); }
// Clustering is only meaningful for the Repliers Sample Data source.
function clusteringActive() { return currentSource() === 'repliers' && mapClusteringOn(); }
function clusterPrecisionForZoom() {
  const z = state.map ? state.map.getZoom() : 9;
  const offset = (CLUSTER_GRANULARITIES.find(o => o.value === mapClusterGranularity()) || {}).offset || 0;
  return Math.max(1, Math.min(29, Math.round(z) + offset));
}


// T18: a single, user-chosen headline value (Price / Cost to close / PIT),
// distinct from the always-detailed "Monthly PIT + closing" block below.
// One choice, one compact line -- the choice itself lives in localStorage,
// not in CARD_FIELDS, since it's a single select, not a per-field toggle.
const SUMMARY_VALUE_KEY = 'hh_summary_value_choice_v1';
const SUMMARY_VALUE_OPTIONS = [
  { value: 'price',   label: 'Price' },
  { value: 'closing', label: 'Cost to close' },
  { value: 'pit',     label: 'Monthly PIT' },
];
function loadSummaryValueChoice() {
  const saved = localStorage.getItem(SUMMARY_VALUE_KEY);
  return SUMMARY_VALUE_OPTIONS.some(o => o.value === saved) ? saved : 'price';
}
function saveSummaryValueChoice(value) { localStorage.setItem(SUMMARY_VALUE_KEY, value); }
function summaryValueFor(item) {
  const choice = loadSummaryValueChoice();
  if (choice === 'closing') {
    const val = effectiveDueNum(item);
    return val != null ? { label: 'Cost to close', value: money(val) } : null;
  }
  if (choice === 'pit') {
    const val = effectivePitNum(item);
    return val != null ? { label: 'Monthly PIT', value: money(val) } : null;
  }
  const effective = effectivePrice(item);
  if (effective.value == null) return null;
  return { label: effective.isFallback ? 'Price (list, no potential entered)' : 'Price', value: money(effective.value) };
}

// Which price headlines the card: List price (item.price, always what it
// is) or Potential purchase price (the shared, group-entered figure for
// this listing, when one exists). Falls back to list price whenever no
// potential price has been entered for a listing, regardless of the
// toggle, and that fallback is surfaced visibly (isFallback), never
// silently. This also drives every downstream figure that currently
// reads list price: the summaryValueFor() "Price" option above, and the
// mortgageBreakdown attached server-side is itself keyed off this same
// potential price, so nothing here needs to redo that math client-side.
const PRICE_MODE_KEY = 'hh_price_mode_v1';
const PRICE_MODE_OPTIONS = [
  { value: 'list', label: 'List price' },
  { value: 'potential', label: 'Potential purchase price' },
];
function loadPriceMode() {
  const saved = localStorage.getItem(PRICE_MODE_KEY);
  return saved === 'potential' ? 'potential' : 'list';
}
function savePriceMode(value) { localStorage.setItem(PRICE_MODE_KEY, value); }
// Itemized rows for the mortgage breakdown, not one opaque total, so
// every input into the estimate is visible and checkable. This is the
// normal way every listing's Financial section works now (see
// enrich_with_mortgage_breakdown in server.py): the potential purchase
// price is the base when one is entered, list price otherwise, not a
// special case for an override. Split into `totals` (always shown on
// the card) and `itemized` (the components behind those totals,
// collapsed by default behind a <details> disclosure) so the card
// stays scannable without hiding the numbers that led to each total.
// Split the itemized rows at the real cash-flow boundary: everything in
// closingItems is one-time cash due at closing, everything in monthlyItems is
// recurring monthly. The financial section renders a labelled dashed divider
// between the two (see populateCard). Display grouping only; the mortgage math
// is unchanged.
function mortgageBreakdownRows(breakdown) {
  const closingItems = [];
  const dp = breakdown.downPayment;
  const dpLabel = dp.toppedUp
    ? `Down payment (topped up to the required minimum, ${dp.enteredPct}% entered was too low for this price)`
    : `Down payment (${dp.enteredPct}%)`;
  closingItems.push([dpLabel, money(dp.amount)]);

  if (breakdown.cmhc.applies) {
    closingItems.push([`CMHC premium (${breakdown.cmhc.premiumRatePct}% of insured loan)`, money(breakdown.cmhc.premium)]);
    closingItems.push(['CMHC premium Ontario PST (8%)', money(breakdown.cmhc.pst)]);
  }

  const ont = breakdown.ontarioLtt;
  closingItems.push([
    ont.rebate > 0 ? `Ontario land transfer tax (after $${num(ont.rebate)} first-time buyer rebate)` : 'Ontario land transfer tax',
    money(ont.afterRebate),
  ]);

  if (breakdown.torontoLtt.applies) {
    const tor = breakdown.torontoLtt;
    closingItems.push([
      tor.rebate > 0 ? `Toronto municipal land transfer tax (after $${num(tor.rebate)} first-time buyer rebate)` : 'Toronto municipal land transfer tax',
      money(tor.afterRebate),
    ]);
  }

  closingItems.push(['Legal fees (estimate)', money(breakdown.fixedCosts.legalFees)]);
  closingItems.push(['Home inspection (estimate)', money(breakdown.fixedCosts.homeInspection)]);
  closingItems.push(['Appraisal (estimate)', money(breakdown.fixedCosts.appraisal)]);
  closingItems.push(['Title insurance (estimate)', money(breakdown.fixedCosts.titleInsurance)]);

  const monthlyItems = [
    ['Monthly principal and interest', money(breakdown.monthlyPrincipalInterest)],
    ['Monthly property tax (estimate)', money(breakdown.monthlyPropertyTax)],
  ];

  const totals = [
    ['Total cost to close (estimate)', money(breakdown.costToClose)],
    ['Monthly PIT (estimate)', money(breakdown.monthlyPit)],
  ];
  return { closingItems, monthlyItems, totals };
}

function effectivePrice(item) {
  const mode = loadPriceMode();
  const potential = item.potentialPurchasePrice;
  if (mode === 'potential' && potential != null) {
    return { value: potential.price, isFallback: false, mode };
  }
  return { value: item.price, isFallback: mode === 'potential', mode };
}

// Same figure the Financial section on the card actually renders: the
// computed mortgage breakdown, keyed off the potential purchase price
// when one is entered, list price otherwise (see
// enrich_with_mortgage_breakdown in server.py), independent of the
// list/potential headline toggle (that toggle only switches the card's
// headline price, not this breakdown -- see docs/design-spec.md). Never
// falls back to the original flat pre-entered pitNum/dueNum figures --
// those are no longer shown anywhere on the card. Returns null only for
// the rare listing with no valid price to compute against at all.
function effectivePitNum(item) {
  return item.mortgageBreakdown ? item.mortgageBreakdown.monthlyPit : null;
}
function effectiveDueNum(item) {
  return item.mortgageBreakdown ? item.mortgageBreakdown.costToClose : null;
}

// The card renders top-to-bottom in the family's review workflow, and the
// settings drawer mirrors it. CARD_GROUPS (order + heading) and CARD_FIELDS
// (order + group) are the SINGLE SOURCE OF TRUTH for both the card's section
// order and the settings toggle order. assembleCardGroups() rebuilds each
// card's DOM from these arrays, so reorganizing the card in future means
// reordering these arrays and nothing else -- the template's div order is a
// flat bag and is NOT authoritative. See DECISIONS.md (card workflow grouping).
const CARD_GROUPS = [
  { key: 'identify',  label: 'Identify & review' },
  { key: 'facts',     label: 'Property facts' },
  { key: 'opinions',  label: 'Opinions & input' },
  { key: 'financial', label: 'Financial' },
  { key: 'actions',   label: 'Actions' },
];
const CARD_FIELDS = [
  // 1. Identify & review. The photo, address, beds summary and fit BADGE are
  // the always-on card header above these; summaryValue is the one pinnable
  // headline number (Price / Cost to close / PIT) used for identification.
  { key: 'summaryValue', group: 'identify', label: 'Card summary value', desc: 'One headline number: Price, Cost to close, or PIT', defaultOn: true },
  // 2. Property facts. The things you evaluate a property against.
  { key: 'stats',     group: 'facts', label: 'Beds / baths / sqft / lot', desc: 'Key property stats', defaultOn: true },
  { key: 'features',  group: 'facts', label: 'Features', desc: 'Loft, home office, shop, etc.', defaultOn: true, pocOnly: true },
  { key: 'fit',       group: 'facts', label: 'Fit score tags', desc: 'What the property fails on', defaultOn: true },
  { key: 'commute',   group: 'facts', label: 'GO commute', desc: 'Station, drive time, total to Union', defaultOn: true, pocOnly: true },
  { key: 'highway',   group: 'facts', label: 'Highway distance', desc: 'Straight-line distance to the nearest 400-series highway', defaultOn: true, pocOnly: true },
  { key: 'placeAttachments', group: 'facts', label: 'Attached places', desc: 'Places attached to this property, with distance and drive time', defaultOn: true, pocOnly: true },
  // 3. Opinions & input. Where the group's sentiment and your feedback live.
  { key: 'groupSentiment', group: 'opinions', label: 'Group sentiment', desc: 'Who has rated, said no, or requested research, at a glance', defaultOn: true },
  { key: 'ratings',   group: 'opinions', label: 'Ratings', desc: 'Per-person star ratings', defaultOn: true },
  { key: 'comments',  group: 'opinions', label: 'Latest comments', desc: 'Most recent note per person', defaultOn: false },
  { key: 'feedbackActions', group: 'opinions', label: 'Rate / note / reject controls', desc: 'Record your feedback as the selected actor', defaultOn: true },
  // 4. Financial. The deep-dive stage after a property survives review.
  { key: 'price',     group: 'financial', label: 'Price', desc: 'Asking price', defaultOn: true },
  { key: 'potentialPrice', group: 'financial', label: 'Potential purchase price', desc: 'Shared, editable price the group is actually considering offering', defaultOn: true, pocOnly: true },
  { key: 'financial', group: 'financial', label: 'Monthly PIT + closing', desc: 'Monthly payment and due at closing', defaultOn: true, pocOnly: true },
  // Utility footer, not a review stage: the navigation buttons.
  { key: 'actions',   group: 'actions', label: 'Action buttons', desc: 'View listing, research doc, map', defaultOn: true },
];
const SETTINGS_KEY = 'hh_card_fields_v1';

const TIER_LABELS = { top: 'Top pick', mid: 'Mid', bottom: 'Bottom' };

function lotDimsLabel(item) {
  const round1 = n => (Number(n) % 1 === 0 ? Number(n) : Math.round(Number(n) * 10) / 10);
  return `${round1(item.frontageNum)} x ${round1(item.depthNum)} ft`;
}

// ─── Actor identity (D3/D11 auth, "I am" selector) ─────────────────────────────
// Shared-secret deterrent, not real security, visible in browser JS by
// design; see tasks/plan.md D3/D11 for the accepted tradeoff. Fetched from
// GET /api/config on startup (that one endpoint is deliberately unprotected
// so the frontend can bootstrap it) rather than hardcoded, so app.js and
// .env can't drift out of sync.
let APP_TOKEN = null;
let MAPBOX_TOKEN = null;
const WHO_KEY = 'hh_who_am_i';
const authHeaders = () => ({ 'X-App-Token': APP_TOKEN });

async function loadConfig() {
  const res = await fetch('/api/config');
  const data = await res.json();
  APP_TOKEN = data.auth_token;
  MAPBOX_TOKEN = data.mapbox_token;
}

// ─── State ────────────────────────────────────────────────────────────────────
const state = { map: null, mapReady: false, rawListings: [], listings: [], activeView: 'map', people: [], activePerson: null, feedback: {}, openMapItem: null, source: 'poc', sourceCount: 0, clusters: [], poi: [], householdSettings: {}, personThresholds: {}, personThresholdsError: false, placeAttachments: {}, clusterPopupOpen: false };
let cardSettings = loadSettings();

// ─── Utilities ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money = v => v == null ? '' : Number(v).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
const num = (v, suffix = '') => (v == null || v === '') ? '' : `${Number(v).toLocaleString()}${suffix}`;
const stars = n => n ? '★'.repeat(Math.min(5, +n)) + '☆'.repeat(Math.max(0, 5 - +n)) : '';
const currentSource = () => $('source')?.value || 'poc';

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return Object.fromEntries(CARD_FIELDS.map(f => [f.key, f.key in saved ? saved[f.key] : f.defaultOn]));
  } catch { return Object.fromEntries(CARD_FIELDS.map(f => [f.key, f.defaultOn])); }
}
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(cardSettings)); }

function fieldVisible(key) {
  if (!cardSettings[key]) return false;
  const def = CARD_FIELDS.find(f => f.key === key);
  if (def?.pocOnly && currentSource() !== 'poc') return false;
  return true;
}

// ─── Settings panel ───────────────────────────────────────────────────────────
// The card-section toggles are grouped under the same four workflow headings
// (plus Actions), in the same CARD_GROUPS / CARD_FIELDS order as the card, so
// the settings drawer visually echoes the card and the two cannot drift.
function buildSettingsPanel() {
  const container = $('settingsFields');
  container.innerHTML = '';
  CARD_GROUPS.forEach(g => {
    const fields = CARD_FIELDS.filter(f => f.group === g.key && (!f.pocOnly || currentSource() === 'poc'));
    if (!fields.length) return; // e.g. a group whose only fields are POC-only, on Sample Data
    const heading = document.createElement('div');
    heading.className = 'settings-group-heading';
    heading.textContent = g.label;
    container.appendChild(heading);
    fields.forEach(f => {
      const label = document.createElement('label');
      label.className = 'settings-row';
      const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: cardSettings[f.key] !== false });
      cb.dataset.key = f.key;
      cb.addEventListener('change', () => { cardSettings[f.key] = cb.checked; saveSettings(); applyCardVisibility(); });
      const text = document.createElement('div');
      text.innerHTML = `<div>${esc(f.label)}</div><div class="field-desc">${esc(f.desc)}</div>`;
      label.append(cb, text);
      container.appendChild(label);
      if (f.key === 'summaryValue') {
        const choiceRow = document.createElement('div');
        choiceRow.className = 'settings-row settings-subrow';
        const select = document.createElement('select');
        select.id = 'summaryValueChoice';
        select.innerHTML = SUMMARY_VALUE_OPTIONS.map(o => `<option value="${o.value}">${esc(o.label)}</option>`).join('');
        select.value = loadSummaryValueChoice();
        select.addEventListener('change', () => { saveSummaryValueChoice(select.value); applyCardVisibility(); renderCards(state.listings); });
        choiceRow.appendChild(select);
        container.appendChild(choiceRow);
      }
      if (f.key === 'price') {
        const choiceRow = document.createElement('div');
        choiceRow.className = 'settings-row settings-subrow';
        const select = document.createElement('select');
        select.id = 'priceModeChoice';
        select.innerHTML = PRICE_MODE_OPTIONS.map(o => `<option value="${o.value}">${esc(o.label)}</option>`).join('');
        select.value = loadPriceMode();
        select.addEventListener('change', () => { savePriceMode(select.value); renderCards(state.listings); });
        choiceRow.appendChild(select);
        container.appendChild(choiceRow);
      }
    });
  });
}

// Rebuild a freshly-cloned card body into the workflow groups, in
// CARD_GROUPS / CARD_FIELDS order. Each section (.cf-<key>) is moved out of the
// flat template into its group wrapper (.card-grp), so this, not the template
// markup, decides section order. The always-on header (.card-top) stays first.
function assembleCardGroups(node) {
  const body = node.querySelector('.card-body');
  if (!body || body.querySelector('.card-grp')) return; // fresh clone only
  CARD_GROUPS.forEach(g => {
    const wrap = document.createElement('div');
    wrap.className = 'card-grp card-grp-' + g.key;
    CARD_FIELDS.filter(f => f.group === g.key).forEach(f => {
      const sec = body.querySelector('.cf-' + f.key);
      if (sec) wrap.appendChild(sec);
    });
    body.appendChild(wrap);
  });
}

function applyCardVisibility() {
  CARD_FIELDS.forEach(f => {
    const show = fieldVisible(f.key);
    document.querySelectorAll('.cf-' + f.key).forEach(el => el.style.display = show ? '' : 'none');
  });
  // Collapse a group wrapper that has no visible section, so no stray group
  // divider or gap shows. Content-based (inline display + actual content), not
  // computed style, so it stays correct even when the card is in a hidden view
  // (list cards while the map view is active compute display:none wholesale).
  document.querySelectorAll('.card-grp').forEach(wrap => {
    const anyVisible = [...wrap.children].some(c =>
      c.style.display !== 'none' && (c.children.length > 0 || c.textContent.trim().length > 0));
    wrap.style.display = anyVisible ? '' : 'none';
  });
}

// Settings main list -> sub-page drill-down. Generic by design: a new
// section needs one .settings-nav-row (data-target/data-title) in
// #settingsPageMain plus one #settingsPage-<target> block, nothing here
// changes. Always reopens to the main list, not the last-viewed page.
function showSettingsMain() {
  document.querySelectorAll('.settings-page').forEach(p => { p.hidden = p.id !== 'settingsPageMain'; });
  $('settingsTitle').textContent = 'Settings';
  $('settingsBack').hidden = true;
}
function showSettingsPage(target, title) {
  document.querySelectorAll('.settings-page').forEach(p => { p.hidden = p.id !== `settingsPage-${target}`; });
  $('settingsTitle').textContent = title;
  $('settingsBack').hidden = false;
}
function openSettings() { buildSettingsPanel(); buildThresholdSettings(); showSettingsMain(); $('settingsDrawer').hidden = false; $('settingsOverlay').hidden = false; }
function closeSettings() { $('settingsDrawer').hidden = true; $('settingsOverlay').hidden = true; }

// ─── People / "I am" actor selector ────────────────────────────────────────────
async function loadPeople() {
  try {
    const res = await fetch('/api/people', { headers: authHeaders() });
    if (!res.ok) throw new Error('failed to load people');
    const data = await res.json();
    state.people = data.people || [];
  } catch (err) {
    console.error(err);
    state.people = [];
  }
  buildWhoAmI();
  buildPersonFilters();
}

function buildWhoAmI() {
  const sel = $('whoAmI');
  if (!sel) return;
  const saved = Number(localStorage.getItem(WHO_KEY)) || null;
  sel.innerHTML = '<option value="">I am…</option>' +
    state.people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const validSaved = saved && state.people.some(p => p.id === saved);
  state.activePerson = validSaved ? saved : null;
  sel.value = state.activePerson || '';
  updateLegendHint();
}

function setActivePerson(id) {
  state.activePerson = id || null;
  if (state.activePerson) localStorage.setItem(WHO_KEY, String(state.activePerson));
  else localStorage.removeItem(WHO_KEY);
  updateLegendHint();
  applyFiltersAndRender();
  if (state.openMapItem) showMapCard(state.openMapItem);
}

function updateLegendHint() {
  const hint = $('legendHint');
  if (hint) hint.hidden = !!state.activePerson;
}

// ─── Per-person rating/consensus filters (dynamic, one row per person) ────────
// Checkboxes, OR'd within a person: check 3★+4★+5★ to replicate an old
// "3+ stars" filter. No boxes checked = that person's filter is ignored.
const PERSON_FILTER_OPTIONS = [
  { value: '1', label: '1★', title: '1 star' },
  { value: '2', label: '2★', title: '2 stars' },
  { value: '3', label: '3★', title: '3 stars' },
  { value: '4', label: '4★', title: '4 stars' },
  { value: '5', label: '5★', title: '5 stars' },
  { value: 'not_rated', label: 'Not rated', title: 'Not rated yet' },
  { value: 'said_no', label: 'Said no', title: 'Said no' },
];
// One flat, order-preserving list, not fixed rows. A hardcoded row split
// used to force "Not rated"/"Said no" onto their own line even when there
// was room left over after the 5 star chips, wasting space on mobile and
// never letting all 7 sit on one line on wider screens either. Flowing all
// seven through a single flex-wrap row lets the browser wrap based on the
// actual available width at any viewport size, mobile through desktop,
// instead of a hand-picked breakpoint.
const PERSON_FILTER_ORDER = ['1', '2', '3', '4', '5', 'not_rated', 'said_no'];

function personFilterCbId(personId, value) { return `personFilter_${personId}_${value}`; }

function personFilterChip(personId, value) {
  const o = PERSON_FILTER_OPTIONS.find(x => x.value === value);
  return `
    <label class="chip" title="${esc(o.title)}">
      <input type="checkbox" id="${personFilterCbId(personId, o.value)}" data-person-id="${personId}" data-value="${o.value}" />
      ${esc(o.label)}
    </label>
  `;
}

function buildPersonFilters() {
  const container = $('personFilters');
  if (!container) return;
  container.innerHTML = state.people.map(p => `
    <div class="person-filter-block">
      <div class="person-filter-name">${esc(p.name)}</div>
      <div class="person-filter-row">
        ${PERSON_FILTER_ORDER.map(v => personFilterChip(p.id, v)).join('')}
      </div>
    </div>
  `).join('');
  const savedPersonFilters = loadSavedFilterState()._personFilters || [];
  container.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.checked = savedPersonFilters.includes(cb.id);
    cb.addEventListener('change', applyFiltersAndRender);
  });
}

function checkedValuesFor(personId) {
  return PERSON_FILTER_OPTIONS
    .map(o => o.value)
    .filter(v => $(personFilterCbId(personId, v))?.checked);
}

function personFeedbackFor(listingId, personId) {
  if (!personId) return null;
  const list = state.feedback[listingId] || [];
  return list.find(f => f.person_id === personId) || null;
}

function matchesPersonCheckValue(listingId, personId, value) {
  const f = personFeedbackFor(listingId, personId);
  const rating = f?.rating ?? null;
  const saidNo = f?.status === 'rejected';
  switch (value) {
    case 'not_rated': return rating == null && !saidNo;
    case '1':         return rating === 1;
    case '2':         return rating === 2;
    case '3':         return rating === 3;
    case '4':         return rating === 4;
    case '5':         return rating === 5;
    case 'said_no':   return saidNo;
    default:          return false;
  }
}

function matchesPersonFilter(listingId, personId, checkedValues) {
  if (!checkedValues.length) return true; // nothing checked = ignored
  return checkedValues.some(v => matchesPersonCheckValue(listingId, personId, v));
}

// Highway distance is a plain Min/Max range filter on the precomputed
// straight-line highwayKm (see matchesRangeDirect call in filterByFeedback),
// independent of the household highway minimum in settings (which still drives
// the card badge). Set Min = the household minimum to keep only listings that
// are far enough; blank means no constraint like every other range filter.

// One-time migration of the old "Far enough from highways" checkbox: if it was
// persisted-on, seed the new Highway distance Min field with the household
// highway_km value (the old checkbox kept listings with highwayKm >= that
// value, which is exactly Min = household_km). Otherwise leave both blank.
// Runs after household settings load so householdHighwayKm() is available.
function migrateHighwayFilterCheckbox() {
  const saved = loadSavedFilterState();
  const minEl = $('minHwyKm');
  if (saved.filterHwyWithinLimit && minEl && !minEl.value) {
    const km = householdHighwayKm();
    if (km != null) minEl.value = km;
  }
  // saveFilterState rewrites the persisted object from the current fields and
  // no longer includes filterHwyWithinLimit, so the obsolete key is dropped.
  if ('filterHwyWithinLimit' in saved) {
    saveFilterState();
    applyFiltersAndRender();
  }
}

// Attached-place drive-time range filter (minutes). A listing passes if at
// least one of its place attachments has a cached street-routed drive time
// within [min, max]. Inherently acts on the ATTACHED SUBSET: when either field
// has a value, listings with no attachments (or none with a computed drive
// time in range) are excluded, since the filter can only evaluate listings
// that have one. Both blank => inactive, everything passes.
function matchesAttachDriveFilter(item) {
  const minRaw = ($('minAttachDrive')?.value || '').trim();
  const maxRaw = ($('maxAttachDrive')?.value || '').trim();
  if (!minRaw && !maxRaw) return true; // inactive
  const atts = state.placeAttachments[item.mls] || [];
  return atts.some(a => {
    if (a.drive_minutes == null) return false; // routing unavailable, can't evaluate
    if (minRaw && a.drive_minutes < Number(minRaw)) return false;
    if (maxRaw && a.drive_minutes > Number(maxRaw)) return false;
    return true;
  });
}

function matchesStatusFilter(listingId, value) {
  if (!value || !state.activePerson) return true; // no-op without an active actor
  const f = personFeedbackFor(listingId, state.activePerson);
  const saidNo = f?.status === 'rejected';
  if (value === 'active') return !saidNo;
  if (value === 'rejected') return saidNo;
  return true;
}

// ─── Keyword search (live, client-side, no Apply needed) ─────────────────────
// T12: match each whitespace-separated word independently (AND across
// words), not the whole typed phrase as one exact substring. The haystack
// is separate fields joined with a single space, so a query typed the
// natural way (e.g. "mill st essa" for "18 Mill St, Essa") previously
// failed outright because the real string has a comma the query does not:
// "18 mill st, essa" does not contain the literal substring "mill st essa".
function matchesKeyword(item, keyword) {
  if (!keyword) return true;
  const words = keyword.split(/\s+/).filter(Boolean);
  const feedbackList = state.feedback[item.mls] || [];
  const hay = [
    item.address, item.city, item.state, item.propertyType, item.style,
    item.brokerage, item.goStation, item.features,
    ...feedbackList.map(f => f.note), ...feedbackList.map(f => f.research_note),
  ].filter(Boolean).join(' ').toLowerCase();
  return words.every(word => hay.includes(word));
}

// ─── Numeric range helpers (PIT / due-at-closing, client-side only, POC-only fields) ──
function matchesRange(value, minId, maxId) {
  const min = numericFieldValue(minId);
  const max = numericFieldValue(maxId);
  if (!min && !max) return true;
  if (value == null) return false; // an active min/max can't match an unknown value
  if (min && value < Number(min)) return false;
  if (max && value > Number(max)) return false;
  return true;
}

// Same as matchesRange() but reads the raw input value directly instead of
// through numericFieldValue()'s digit-stripping. sqft/acres/commute can be
// decimals (e.g. 0.567 acres), which numericFieldValue would corrupt.
function matchesRangeDirect(value, minId, maxId) {
  const minRaw = ($(minId)?.value || '').trim();
  const maxRaw = ($(maxId)?.value || '').trim();
  if (!minRaw && !maxRaw) return true;
  if (value == null) return false;
  if (minRaw && value < Number(minRaw)) return false;
  if (maxRaw && value > Number(maxRaw)) return false;
  return true;
}

// Keyword-in-features checkboxes: text match only, not a confirmed feature.
function matchesFeatureKeywords(item) {
  const text = (item.features || '').toLowerCase();
  if ($('featGarage')?.checked && !text.includes('garage')) return false;
  if ($('featPool')?.checked && !text.includes('pool')) return false;
  if ($('featBasement')?.checked && !text.includes('basement')) return false;
  return true;
}

// Same "any buyer rejected" definition as the card's group-sentiment
// headline (buyerHeadline), reused directly so this filter can never
// disagree with what the card already labels Vetoed. Unrelated to
// filterStatus, which reflects the property's real-estate listing
// status, not buyer feedback.
function isVetoed(item) {
  const feedbackByPerson = new Map((state.feedback[item.mls] || []).map(f => [f.person_id, f]));
  const buyers = state.people.filter(p => p.role === 'buyer');
  return buyerHeadline(buyers, feedbackByPerson).word === 'Vetoed';
}

function filterByFeedback(listings) {
  const statusVal = $('filterStatus')?.value || '';
  const keyword = ($('q')?.value || '').trim().toLowerCase();
  const personFilters = state.people.map(p => ({ id: p.id, values: checkedValuesFor(p.id) }));
  return listings.filter(item => {
    if (!matchesStatusFilter(item.mls, statusVal)) return false;
    if ($('hideVetoed')?.checked && isVetoed(item)) return false;
    if (!matchesKeyword(item, keyword)) return false;
    if (!matchesRange(effectivePitNum(item), 'minPit', 'maxPit')) return false;
    if (!matchesRange(effectiveDueNum(item), 'minDue', 'maxDue')) return false;
    if (!matchesRangeDirect(item.sqft, 'minSqft', 'maxSqft')) return false;
    if (!matchesRangeDirect(item.acres, 'minAcres', 'maxAcres')) return false;
    if (!matchesRangeDirect(item.goMin, '', 'maxCommute')) return false;
    if (!matchesRangeDirect(item.highwayKm, 'minHwyKm', 'maxHwyKm')) return false;
    if (!matchesAttachDriveFilter(item)) return false;
    if (!matchesFeatureKeywords(item)) return false;
    return personFilters.every(pf => matchesPersonFilter(item.mls, pf.id, pf.values));
  });
}

function applyFiltersAndRender() {
  state.listings = filterByFeedback(state.rawListings);
  refreshMap(state.listings);
  renderCards(state.listings);
  const summaryText = state.source === 'poc'
    ? `${state.listings.length} of ${state.sourceCount} POC listings`
    : `${state.listings.length} shown · ${Number(state.sourceCount).toLocaleString()} Sample Data available`;
  if ($('summary'))     $('summary').textContent = summaryText;
  if ($('summaryList')) $('summaryList').textContent = summaryText;
}

// ─── Feedback: batch reads (D6/D2) and writes ──────────────────────────────────
async function fetchFeedback(listingIds) {
  const ids = [...new Set(listingIds.filter(Boolean))];
  if (!ids.length) return {};
  try {
    const res = await fetch('/api/feedback?listing_ids=' + encodeURIComponent(ids.join(',')), { headers: authHeaders() });
    if (!res.ok) return {};
    const data = await res.json();
    return data.feedback || {};
  } catch (err) {
    console.error(err);
    return {};
  }
}

async function fetchPlaceAttachments(listingIds) {
  const ids = [...new Set(listingIds.filter(Boolean))];
  if (!ids.length) return {};
  try {
    const res = await fetch('/api/place-attachments?listing_ids=' + encodeURIComponent(ids.join(',')), { headers: authHeaders() });
    if (!res.ok) return {};
    const data = await res.json();
    return data.place_attachments || {};
  } catch (err) {
    console.error(err);
    return {};
  }
}

async function postFeedback(payload) {
  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || 'Save failed');
  return data;
}

// Refetches listings and feedback without recentering the map, unlike
// load(), which is also used by Apply/Reset and always re-jumps the map
// to the source's default view. A potential purchase price edit must not
// reset whatever the user was already looking at on the map.
async function reloadListingsPreservingMapView() {
  const source = currentSource();
  const res = await fetch((source === 'poc' ? '/api/poc-listings' : '/api/listings') + '?' + filterParams());
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || data.error || 'Reload failed');
  state.rawListings = data.listings;
  state.sourceCount = data.sourceCount;
  state.clusters = data.clusters || [];
  const listingIds = state.rawListings.map(x => x.mls);
  state.feedback = await fetchFeedback(listingIds);
  state.placeAttachments = await fetchPlaceAttachments(listingIds);
  applyFiltersAndRender();
}

// One shared price per listing, not per person (see DECISIONS.md), so
// this is not attached to a specific actor's feedback the way rating/
// note/reject are. Same not-open-by-default, small-edit-control-reveals-
// an-input affordance as the note Add/Edit buttons, but a single Add-or-
// Edit control, not a split pair, since there is one current value here,
// not a history list.
// Shared by Save and Clear below: reloads listings so every card (and
// the currently-open map card, if it's this listing) reflects the
// fresh potentialPurchasePrice/mortgageBreakdown state.
async function reloadAfterPotentialPriceChange(item) {
  const openMlsBeforeReload = state.openMapItem?.mls;
  await reloadListingsPreservingMapView();
  // Only re-show if the map card that was open is the one just edited,
  // by mls, since reload replaces every item with a fresh object; a
  // different open card must be left alone, not replaced.
  if (openMlsBeforeReload === item.mls) {
    const refreshed = findListing(item.mls);
    if (refreshed) showMapCard(refreshed);
  }
}

function buildPotentialPriceEditor(node, item) {
  const container = node.querySelector('.card-potential-price');
  if (!container) return;
  container.innerHTML = '';
  if (!item.poc) return; // pocOnly field; Repliers listings have no shared negotiating price concept

  const entry = item.potentialPurchasePrice || null;

  // The entered estimate itself (value + attribution) now shows in the price
  // block above as the "Estimate:" line, so this section is just the
  // Add / Edit / Clear affordance, no duplicate display line.
  const btnRow = document.createElement('div');
  btnRow.className = 'feedback-btn-row';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'secondary fb-btn';
  editBtn.textContent = entry ? '✏️ Edit potential price' : '➕ Add potential price';
  btnRow.append(editBtn);

  const box = document.createElement('div');
  box.className = 'feedback-compose';
  box.hidden = true;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '1000';
  input.placeholder = 'Potential purchase price';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  const statusEl = document.createElement('div');
  statusEl.className = 'feedback-status';

  saveBtn.addEventListener('click', async () => {
    if (!state.activePerson) { showFeedbackStatus(statusEl, 'Select who you are first.', true); return; }
    const price = Number(input.value);
    if (!price || price <= 0) { showFeedbackStatus(statusEl, 'Enter a positive number.', true); return; }
    try {
      const res = await fetch('/api/potential-purchase-prices', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: state.activePerson, listing_id: item.mls, price }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || 'Save failed');
      await reloadAfterPotentialPriceChange(item);
    } catch (err) {
      showFeedbackStatus(statusEl, err.message, true);
    }
  });
  box.append(input, saveBtn, statusEl);

  editBtn.addEventListener('click', () => {
    if (box.hidden) { input.value = entry ? entry.price : ''; box.hidden = false; }
    else { box.hidden = true; }
  });

  // Clear reverts the listing fully to the never-entered state: no
  // attribution, breakdown recomputed off list price (see server's
  // DELETE handler, which removes the row rather than writing zero or
  // an empty string -- zero is never a valid potential price). Only
  // offered once something has actually been entered.
  if (entry) {
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'secondary fb-btn fb-btn-reject';
    clearBtn.textContent = '🗑️ Clear';
    clearBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/potential-purchase-prices', {
          method: 'DELETE',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ listing_id: item.mls }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || data.error || 'Clear failed');
        await reloadAfterPotentialPriceChange(item);
      } catch (err) {
        showFeedbackStatus(statusEl, err.message, true);
      }
    });
    btnRow.append(clearBtn);
  }

  container.append(btnRow, box);
}

function showFeedbackStatus(el, text, isError) {
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? 'var(--red)' : 'var(--muted)';
}

async function submitFeedback(item, actionType, extra, statusEl) {
  if (!state.activePerson) { showFeedbackStatus(statusEl, 'Select who you are first.', true); return; }
  try {
    await postFeedback({ person_id: state.activePerson, listing_id: item.mls, action_type: actionType, ...extra });
    const fresh = await fetchFeedback([item.mls]);
    Object.assign(state.feedback, fresh);
    // T16: re-run the active filters (not just re-render the same list) so a
    // rating/reject change that now falls outside an active person-rating
    // or status filter drops the listing from both list and map right away,
    // with no separate "Apply" click needed.
    applyFiltersAndRender();
    if (state.openMapItem === item) {
      if (state.listings.includes(item)) showMapCard(item);
      else closeMapCard();
    }
  } catch (err) {
    showFeedbackStatus(statusEl, err.message, true);
  }
}

function buildFeedbackActions(node, item) {
  const container = node.querySelector('.card-feedback-actions');
  if (!container) return;
  container.innerHTML = '';

  if (!state.activePerson) {
    const prompt = document.createElement('div');
    prompt.className = 'feedback-prompt';
    prompt.textContent = 'Select who you are (top right) to rate, note, reject, or request research.';
    container.appendChild(prompt);
    return;
  }

  const feedbackList = state.feedback[item.mls] || [];
  const mine = feedbackList.find(f => f.person_id === state.activePerson) || {};
  const statusEl = document.createElement('div');
  statusEl.className = 'feedback-status';

  const starsLabel = document.createElement('div');
  starsLabel.className = 'rate-stars-label';
  starsLabel.textContent = 'Your rating';

  const starsRow = document.createElement('div');
  starsRow.className = 'rate-stars';
  for (let i = 1; i <= 5; i++) {
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'rate-star';
    star.textContent = mine.rating >= i ? '★' : '☆';
    star.title = `Rate ${i}`;
    star.addEventListener('click', () => submitFeedback(item, 'rating', { rating: i }, statusEl));
    starsRow.appendChild(star);
  }

  // T11: Add and Edit are distinct actions, not one toggle that always
  // reopens the previous note. Add always starts a blank composer; Edit
  // (only shown once a note exists) pre-fills with the current latest
  // note. Both call the same submitFeedback('note', ...) -- the write
  // path is already append-only, so "edit" appends a new row that becomes
  // the new latest rather than updating in place, which is enough to make
  // the two actions behave distinctly from the user's point of view.
  const noteAddBtn = document.createElement('button');
  noteAddBtn.type = 'button';
  noteAddBtn.className = 'secondary fb-btn';
  noteAddBtn.textContent = '📝 Add note';

  const noteEditBtn = document.createElement('button');
  noteEditBtn.type = 'button';
  noteEditBtn.className = 'secondary fb-btn';
  noteEditBtn.textContent = '✏️ Edit note';
  noteEditBtn.hidden = !mine.note;

  const noteBox = document.createElement('div');
  noteBox.className = 'feedback-compose';
  noteBox.hidden = true;
  const noteInput = document.createElement('textarea');
  noteInput.placeholder = 'Add a note…';
  const noteSave = document.createElement('button');
  noteSave.type = 'button';
  noteSave.textContent = 'Save note';
  noteSave.addEventListener('click', () => {
    const note = noteInput.value.trim();
    if (!note) return;
    submitFeedback(item, 'note', { note }, statusEl);
  });
  noteBox.append(noteInput, noteSave);

  function toggleComposer(prefill) {
    if (noteBox.hidden) { noteInput.value = prefill; noteBox.hidden = false; }
    else { noteBox.hidden = true; }
  }
  noteAddBtn.addEventListener('click', () => toggleComposer(''));
  noteEditBtn.addEventListener('click', () => toggleComposer(mine.note || ''));

  const rejectToggle = document.createElement('button');
  rejectToggle.type = 'button';
  rejectToggle.className = 'secondary fb-btn fb-btn-reject';
  rejectToggle.textContent = '🚫 Reject';
  const rejectBox = document.createElement('div');
  rejectBox.className = 'feedback-compose';
  rejectBox.hidden = true;
  const rejectInput = document.createElement('input');
  rejectInput.placeholder = 'Reason (optional)';
  rejectInput.value = mine.status === 'rejected' ? (mine.reason || '') : '';
  const rejectConfirm = document.createElement('button');
  rejectConfirm.type = 'button';
  rejectConfirm.textContent = 'Confirm reject';
  rejectConfirm.addEventListener('click', () => {
    submitFeedback(item, 'reject', { reason: rejectInput.value.trim() || null }, statusEl);
  });
  rejectBox.append(rejectInput, rejectConfirm);
  rejectToggle.addEventListener('click', () => { rejectBox.hidden = !rejectBox.hidden; });

  const researchBtn = document.createElement('button');
  researchBtn.type = 'button';
  researchBtn.className = 'secondary fb-btn';
  const alreadyRequested = !!mine.research_requested;
  if (alreadyRequested) researchBtn.classList.add('fb-btn-requested');
  researchBtn.textContent = alreadyRequested ? '✅ Requested' : '🔍 Research';
  researchBtn.addEventListener('click', () => {
    // Placeholder until the real research agent is wired in. The note
    // captures the actual question so it's not lost once that lands.
    const question = prompt('What should the research agent look into for this property?');
    if (!question || !question.trim()) return;
    submitFeedback(item, 'research_request', { note: question.trim() }, statusEl);
  });

  const btnRow = document.createElement('div');
  btnRow.className = 'feedback-btn-row';
  btnRow.append(noteAddBtn, noteEditBtn, rejectToggle, researchBtn);

  container.append(starsLabel, starsRow, btnRow, noteBox, rejectBox, statusEl);
}

// ─── View toggle ──────────────────────────────────────────────────────────────
function switchView(view) {
  state.activeView = view;
  $('viewMap').hidden = view !== 'map';
  $('viewList').hidden = view !== 'list';
  $('btnMap').classList.toggle('active', view === 'map');
  $('btnList').classList.toggle('active', view === 'list');
  if (view === 'map') requestAnimationFrame(() => state.map?.resize());
}

// ─── Map (Mapbox GL JS) ────────────────────────────────────────────────────────
const MAP_LAYER_IDS = ['listings-circles', 'clusters-circles', 'clusters-labels', 'go-stations-existing-circles', 'go-stations-planned-circles', 'go-lines-layer', 'hwy413-line', 'poi-pins-circles'];

function findListing(mls) {
  return state.listings.find(x => x.mls === mls) || null;
}

function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

function lngLatBoundsOf(pairs) {
  // pairs: array of [lng, lat]
  if (!pairs.length) return null;
  let west = pairs[0][0], east = pairs[0][0], south = pairs[0][1], north = pairs[0][1];
  pairs.forEach(([lng, lat]) => {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  });
  return [[west, south], [east, north]];
}

function initMap() {
  mapboxgl.accessToken = MAPBOX_TOKEN;
  state.map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-79.5, 44.0],
    zoom: 9,
  });
  state.map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

  state.map.on('load', () => {
    setupMapSources();
    state.mapReady = true;
    // Layer checkboxes may already be checked from restored state (T10) --
    // apply their visibility now that the layers actually exist.
    applyPersistedLayerVisibility();
    // Data may have already loaded while the map style was still loading.
    if (state.rawListings.length) applyFiltersAndRender();
  });

  // Background click (i.e. not on a pin/cluster/layer feature) is handled
  // by the global click-outside-to-dismiss listener below, same as any
  // other click outside an open panel. Feature clicks that open something
  // (a pin, a cluster) stop propagation so that same click does not also
  // trigger the outside-click close on what it just opened.

  window.addEventListener('resize', () => state.map?.resize());
}

function setupMapSources() {
  const map = state.map;

  map.addSource('listings', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'listings-circles',
    type: 'circle',
    source: 'listings',
    paint: {
      'circle-radius': 10,
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.92,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
    },
  });
  // T17: the active person's own star rating, shown on their pin. Empty
  // string renders nothing, so unrated listings and "no one selected yet"
  // both stay a plain color-only pin.
  map.addLayer({
    id: 'listings-labels',
    type: 'symbol',
    source: 'listings',
    layout: {
      'text-field': ['get', 'ratingLabel'],
      'text-size': 11,
      'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': '#fff',
      'text-halo-color': 'rgba(0,0,0,0.45)',
      'text-halo-width': 1,
    },
  });
  map.on('click', 'listings-circles', e => {
    // Stops this click from also reaching the global click-outside-to-
    // dismiss listener, which would otherwise immediately close whatever
    // this same click just opened.
    e.originalEvent?.stopPropagation();
    closeOutsideDetailsPanels(document.body);
    // Gather every listing pin stacked within a few pixels of the click, so
    // multiple listings at close coordinates (some POC pins overlap) open the
    // chooser popup instead of silently showing only the topmost pin.
    const r = 14;
    const near = state.map.queryRenderedFeatures(
      [[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]],
      { layers: ['listings-circles'] });
    const seen = new Set();
    const items = [];
    [e.features[0], ...near].forEach(f => {
      const mls = f.properties.mls;
      if (mls && !seen.has(mls)) { seen.add(mls); const it = findListing(mls); if (it) items.push(it); }
    });
    if (items.length === 1) showMapCard(items[0]);
    else if (items.length > 1) openListingChooser(items);
  });
  map.on('mouseenter', 'listings-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'listings-circles', () => { map.getCanvas().style.cursor = ''; });

  map.addSource('clusters', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'clusters-circles',
    type: 'circle',
    source: 'clusters',
    paint: {
      'circle-radius': ['get', 'radius'],
      'circle-color': '#2b67d6',
      'circle-opacity': 0.75,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
    },
  });
  map.addLayer({
    id: 'clusters-labels',
    type: 'symbol',
    source: 'clusters',
    layout: {
      'text-field': ['get', 'count'],
      'text-size': 12,
      'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
    },
    paint: { 'text-color': '#18211f' },
  });
  map.on('click', 'clusters-circles', e => {
    e.originalEvent?.stopPropagation();
    closeOutsideDetailsPanels(document.body);
    const p = e.features[0].properties;
    const c = state.clusters[Number(p.clusterIdx)];
    if (c) handleClusterClick(c, p);
  });
  map.on('mouseenter', 'clusters-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'clusters-circles', () => { map.getCanvas().style.cursor = ''; });

  // Recompute clusters for the new viewport (and precision) after any pan/zoom,
  // so bubbles split as the user zooms in. Debounced; a no-op unless clustering
  // is active (Sample Data + toggle on).
  map.on('moveend', () => { if (clusteringActive()) scheduleClusterRefetch(); });

  // GO Stations + GO Lines + Highway 413 -- off by default (layer toggle panel).
  // Stations and lines are DELIBERATELY separate sources/files (go-stations.geojson
  // is Point-only, go-lines.geojson is LineString-only) -- a single mixed source
  // previously caused GTFS route-shape vertices to render as station-like pins.
  map.addSource('go-stations', { type: 'geojson', data: '/layers/go-stations.geojson' });
  map.addLayer({
    id: 'go-stations-existing-circles',
    type: 'circle',
    source: 'go-stations',
    filter: ['==', ['get', 'status'], 'Existing'],
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 6,
      'circle-color': ['get', 'statusColor'],
      'circle-stroke-width': 1,
      'circle-stroke-color': '#fff',
    },
  });
  map.addLayer({
    id: 'go-stations-planned-circles',
    type: 'circle',
    source: 'go-stations',
    filter: ['!=', ['get', 'status'], 'Existing'],
    layout: { visibility: 'none' },
    paint: {
      // Hollow ring, not a filled dot -- visually distinct from confirmed
      // (existing) stations at a glance.
      'circle-radius': 6,
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#e8b400',
    },
  });
  let goStationPopup = null;
  const GO_STATION_LAYERS = ['go-stations-existing-circles', 'go-stations-planned-circles'];
  GO_STATION_LAYERS.forEach(layerId => {
    map.on('mouseenter', layerId, e => {
      map.getCanvas().style.cursor = 'pointer';
      const p = e.features[0].properties;
      goStationPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'go-station-tooltip', offset: 10 })
        .setLngLat(e.features[0].geometry.coordinates)
        .setHTML(`<strong>${esc(p.name)}</strong>${p.status !== 'Existing' ? ' (planned)' : ''}<br>${esc(p.lines || '')}`)
        .addTo(map);
    });
    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = '';
      goStationPopup?.remove();
      goStationPopup = null;
    });
  });

  map.addSource('go-lines', { type: 'geojson', data: '/layers/go-lines.geojson' });
  map.addLayer({
    id: 'go-lines-layer',
    type: 'line',
    source: 'go-lines',
    layout: { visibility: 'none' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 3 },
  });

  map.addSource('hwy413', { type: 'geojson', data: '/layers/highway-413.geojson' });
  map.addLayer({
    id: 'hwy413-line',
    type: 'line',
    source: 'hwy413',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#b3261e', 'line-opacity': 0.55, 'line-width': 4 },
  });

  // T14: POI pins. Own source (server data, not a static file), off by
  // default like every other optional layer above.
  map.addSource('poi-pins', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'poi-pins-circles',
    type: 'circle',
    source: 'poi-pins',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 7,
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
    },
  });
  let poiPopup = null;
  map.on('mouseenter', 'poi-pins-circles', e => {
    map.getCanvas().style.cursor = 'pointer';
    const p = e.features[0].properties;
    const typeLabel = (POI_TYPE_META[p.type] || POI_TYPE_META.other).label;
    poiPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'go-station-tooltip', offset: 10 })
      .setLngLat(e.features[0].geometry.coordinates)
      .setHTML(`<strong>${esc(p.label || typeLabel)}</strong><br>${esc(typeLabel)}${p.created_by_name ? ' &middot; added by ' + esc(p.created_by_name) : ''}`)
      .addTo(map);
  });
  map.on('mouseleave', 'poi-pins-circles', () => {
    map.getCanvas().style.cursor = '';
    poiPopup?.remove();
    poiPopup = null;
  });
  refreshPoiLayer();
}

// ─── POI pins (T14) ─────────────────────────────────────────────────────────
// Visual/map-only for now, not wired into any commute or distance
// calculation. Shared across the whole buyer group the same way listing
// feedback is shared -- created_by just records who added it.
const POI_TYPE_META = {
  school: { label: 'School', color: '#2b67d6' },
  hospital: { label: 'Hospital', color: '#b3261e' },
  work: { label: 'Workplace', color: '#8e44ad' },
  worship: { label: 'Place of worship', color: '#e8b400' },
  other: { label: 'Other', color: '#68726f' },
};

function refreshPoiLayer() {
  if (!state.mapReady) return;
  const fc = {
    type: 'FeatureCollection',
    features: state.poi.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        type: p.type,
        label: p.label || '',
        color: (POI_TYPE_META[p.type] || POI_TYPE_META.other).color,
        created_by_name: p.created_by_name,
      },
    })),
  };
  state.map.getSource('poi-pins').setData(fc);
}

async function loadPoi() {
  try {
    const res = await fetch('/api/poi', { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      state.poi = data.poi || [];
    }
  } catch (err) {
    console.error(err);
  }
  refreshPoiLayer();
}

// Household-level settings: one shared value per key across the whole
// buyer group, not per person, unlike everything else that's "I am"
// scoped. Not used in any calculation yet.
// Maps each mortgage-assumption settings-drawer input to its
// household_settings key, so load/save can loop over one list instead of
// repeating the same fetch/parse logic eight times.
const HOUSEHOLD_NUMBER_SETTINGS = [
  { id: 'downPaymentPctSetting', key: 'down_payment_pct' },
  { id: 'interestRatePctSetting', key: 'interest_rate_pct' },
  { id: 'amortizationYearsSetting', key: 'amortization_years' },
  { id: 'propertyTaxPctSetting', key: 'property_tax_pct' },
  { id: 'legalFeesFlatSetting', key: 'legal_fees_flat' },
  { id: 'homeInspectionFlatSetting', key: 'home_inspection_flat' },
  { id: 'appraisalFlatSetting', key: 'appraisal_flat' },
  { id: 'titleInsuranceFlatSetting', key: 'title_insurance_flat' },
];

async function loadHouseholdSettings() {
  try {
    const res = await fetch('/api/household-settings', { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      state.householdSettings = data.settings || {};
    }
  } catch (err) {
    console.error(err);
  }
  const cb = $('firstTimeBuyerToggle');
  if (cb) cb.checked = state.householdSettings.first_time_buyer === 'true';
  HOUSEHOLD_NUMBER_SETTINGS.forEach(({ id, key }) => {
    const input = $(id);
    if (input && state.householdSettings[key] != null) input.value = state.householdSettings[key];
  });
}

function bindHouseholdToggle(id, key) {
  const cb = $(id);
  if (!cb) return;
  cb.addEventListener('change', async () => {
    if (!state.activePerson) {
      cb.checked = !cb.checked;
      alert('Select who you are (top right) first.');
      return;
    }
    const value = String(cb.checked);
    try {
      const res = await fetch('/api/household-settings', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: state.activePerson, key, value }),
      });
      if (!res.ok) throw new Error('save failed');
      state.householdSettings[key] = value;
    } catch (err) {
      console.error(err);
      cb.checked = !cb.checked;
      alert('Could not save the setting. Try again.');
    }
  });
}

function bindHouseholdNumberInput(id, key) {
  const input = $(id);
  if (!input) return;
  input.addEventListener('change', async () => {
    const previous = state.householdSettings[key];
    if (!state.activePerson) {
      input.value = previous;
      alert('Select who you are (top right) first.');
      return;
    }
    const raw = input.value.trim();
    if (raw === '' || Number.isNaN(Number(raw))) {
      input.value = previous;
      return;
    }
    try {
      const res = await fetch('/api/household-settings', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: state.activePerson, key, value: raw }),
      });
      if (!res.ok) throw new Error('save failed');
      state.householdSettings[key] = raw;
    } catch (err) {
      console.error(err);
      input.value = previous;
      alert('Could not save the setting. Try again.');
    }
  });
}

// ─── Per-person location thresholds ────────────────────────────────────────────
// Per person in structure (one row per person), but stored server-side and
// shared with the whole group, exactly like household settings: if Katie
// changes her drive time on her phone it shows on everyone's device. Never
// localStorage, never scoped to the active "I am" person's device. The
// destination references a GO station or an existing POI pin (one source of
// truth for places), never a free-typed address. Computing actual travel
// times against these destinations is deferred (see DECISIONS.md T13); for
// now these fields are stored so that computation can plug in later, and the
// highway_km limit is the only one wired into display/filtering this round.
const TRAVEL_MODE_OPTIONS = [
  { value: 'drive', label: 'Drive' },
  { value: 'transit', label: 'Transit' },
  { value: 'walk', label: 'Walk' },
  { value: 'bike', label: 'Bike' },
];

async function loadPersonThresholds() {
  try {
    const res = await fetch('/api/person-thresholds', { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      state.personThresholds = data.person_thresholds || {};
      state.personThresholdsError = false;
    } else {
      // A non-OK response (e.g. a stale server with no /api/person-thresholds
      // route yet) must not fail silently: the roster would render with blank
      // inputs, indistinguishable from "everyone genuinely unset". Flag it so
      // buildThresholdSettings can show a visible error instead.
      console.error('person-thresholds fetch failed:', res.status);
      state.personThresholdsError = true;
    }
  } catch (err) {
    console.error(err);
    state.personThresholdsError = true;
  }
  buildThresholdSettings();
  // Thresholds feed the highway-distance card badge and the per-person
  // highway filter. They load asynchronously, after the first render, so a
  // reload with the highway filter checkbox persisted-on (and a person
  // selected) would otherwise leave the filter no-op'd until the next user
  // interaction. Re-run filters/render now that the thresholds exist.
  applyFiltersAndRender();
}

function thresholdFor(personId) {
  return state.personThresholds[String(personId)] || null;
}

// The highway distance minimum is a HOUSEHOLD position (a noise/pollution
// radius the whole group holds), not per person, so it comes from
// household_settings, not the active actor's thresholds. Used by both the
// card highway badge and the highway-distance filter. Null when unset or
// not a positive number.
function householdHighwayKm() {
  const v = state.householdSettings ? state.householdSettings.highway_km : null;
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  children.forEach(c => node.append(c));
  return node;
}

function buildThresholdSettings() {
  const container = $('thresholdSettingsList');
  if (!container) return;
  container.innerHTML = '';

  // Visible error state, never a silently-blank section: if the thresholds
  // fetch failed, saved values (including the seeded defaults) are missing,
  // so the inputs below would misleadingly read as "all unset". Say so, with
  // a Retry.
  if (state.personThresholdsError) {
    const banner = el('div', { className: 'threshold-error' });
    banner.append(el('span', { textContent: 'Could not load saved thresholds, so the values below may be missing or incomplete. Your changes may not save until this loads.' }));
    const retry = el('button', { type: 'button', className: 'secondary', textContent: 'Retry' });
    retry.addEventListener('click', () => loadPersonThresholds());
    banner.append(retry);
    container.append(banner);
  }

  // Highway distance is a household position (rendered once, at the top).
  buildHouseholdHighwaySection(container);

  // Travel time is a buyer preference; realtors are never shown here (and the
  // server refuses to store thresholds for them). The server's GET already
  // returns buyers only, but filter here too so the roster is correct
  // regardless of what the endpoint returns.
  const buyers = state.people.filter(p => p.role === 'buyer');
  if (!buyers.length) {
    container.appendChild(el('p', { className: 'field-desc', textContent: 'No buyers loaded yet.' }));
    return;
  }
  container.append(el('div', { className: 'threshold-section-label', textContent: 'Per-buyer travel time' }));

  buyers.forEach(person => {
    const t = thresholdFor(person.id) || {};

    const block = el('div', { className: 'threshold-person-block' });
    const nameRow = el('div', { className: 'threshold-person-name' });
    nameRow.append(el('span', { textContent: person.name }));
    block.append(nameRow);

    // --- Travel time group ---
    const travelGroup = el('div', { className: 'threshold-group' });
    travelGroup.append(el('div', { className: 'threshold-group-label', textContent: 'Max travel time' }));

    const minsInput = el('input', { type: 'number', min: '0', step: '1', placeholder: 'min',
      className: 'threshold-input threshold-input-mins', value: t.travel_minutes ?? '' });
    const modeSel = el('select', { className: 'threshold-select threshold-select-mode' });
    modeSel.innerHTML = TRAVEL_MODE_OPTIONS.map(o => `<option value="${o.value}">${esc(o.label)}</option>`).join('');
    modeSel.value = t.travel_mode || 'drive';

    const destSel = el('select', { className: 'threshold-select threshold-select-destkind' });
    destSel.innerHTML =
      `<option value="go_station">to nearest GO station</option>` +
      `<option value="poi">to a place</option>`;
    destSel.value = t.travel_dest_kind || 'go_station';

    // POI picker, shown only when the destination is a pinned place. Its
    // options are the shared POI pins (one source of truth for places), so
    // a destination is always a real pin, never free-typed text.
    const poiSel = el('select', { className: 'threshold-select threshold-select-poi' });
    const poiOpts = state.poi.length
      ? state.poi.map(p => `<option value="${p.id}">${esc(p.label || (POI_TYPE_META[p.type] || POI_TYPE_META.other).label)}</option>`).join('')
      : `<option value="">No places pinned yet, add one on the map</option>`;
    poiSel.innerHTML = poiOpts;
    if (t.travel_dest_ref != null) poiSel.value = String(t.travel_dest_ref);
    poiSel.style.display = destSel.value === 'poi' ? '' : 'none';
    destSel.addEventListener('change', () => { poiSel.style.display = destSel.value === 'poi' ? '' : 'none'; });

    const totalInput = el('input', { type: 'number', min: '0', step: '1', placeholder: 'total',
      className: 'threshold-input threshold-input-total', value: t.travel_total_minutes ?? '' });

    const travelRow = el('div', { className: 'threshold-row' });
    travelRow.append(minsInput, el('span', { className: 'threshold-unit', textContent: 'min' }),
      modeSel, destSel, poiSel);
    const totalRow = el('div', { className: 'threshold-row' });
    totalRow.append(el('span', { className: 'threshold-unit', textContent: 'within a total of' }),
      totalInput, el('span', { className: 'threshold-unit', textContent: 'min (optional)' }));
    travelGroup.append(travelRow, totalRow);
    block.append(travelGroup);

    // Attribution: who last edited this person's thresholds (null for the
    // untouched migration default).
    if (t.updated_by_name) {
      block.append(el('div', { className: 'threshold-attribution',
        textContent: `Last changed by ${t.updated_by_name}` }));
    }

    const save = () => saveThreshold(person.id, { minsInput, modeSel, destSel, poiSel, totalInput });
    [minsInput, modeSel, destSel, poiSel, totalInput].forEach(input =>
      input.addEventListener('change', save));

    container.append(block);
  });
}

// Household highway minimum: a shared, whole-group position, so it renders
// once at the top of the thresholds page (not per buyer) and saves to
// household_settings. Applies to the card badge and the highway filter for
// everyone regardless of who is active.
function buildHouseholdHighwaySection(container) {
  const block = el('div', { className: 'threshold-household-block' });
  block.append(el('div', { className: 'threshold-person-name', textContent: 'Whole household' }));
  const group = el('div', { className: 'threshold-group' });
  group.append(el('div', { className: 'threshold-group-label',
    textContent: 'Minimum distance to a highway (straight-line)' }));
  const kmInput = el('input', { type: 'number', min: '0', step: '0.5', placeholder: 'km',
    className: 'threshold-input threshold-input-km',
    value: (state.householdSettings && state.householdSettings.highway_km != null)
      ? state.householdSettings.highway_km : '' });
  const row = el('div', { className: 'threshold-row' });
  row.append(kmInput, el('span', { className: 'threshold-unit', textContent: 'km' }));
  group.append(row);
  block.append(group);
  block.append(el('div', { className: 'field-desc',
    textContent: 'A household position, shared by everyone. Listings closer than this to a 400-series highway are flagged as too close, and the "Far enough from highways" filter uses it.' }));
  kmInput.addEventListener('change', () => saveHouseholdHighwayKm(kmInput));
  container.append(block);
}

async function saveHouseholdHighwayKm(input) {
  if (!state.activePerson) {
    alert('Select who you are (top right) first, so we can record who made the change.');
    input.value = state.householdSettings?.highway_km ?? '';
    return;
  }
  const val = posNumOrNull(input.value);
  if (val == null) { input.value = state.householdSettings?.highway_km ?? ''; return; }
  const value = String(val);
  try {
    const res = await fetch('/api/household-settings', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_id: state.activePerson, key: 'highway_km', value }),
    });
    if (!res.ok) throw new Error('save failed');
    state.householdSettings.highway_km = value;
    applyFiltersAndRender(); // card badge + highway filter reflect the new minimum
  } catch (err) {
    console.error(err);
    alert('Could not save the highway minimum. Try again.');
    input.value = state.householdSettings?.highway_km ?? '';
  }
}

function posNumOrNull(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function saveThreshold(personId, fields) {
  if (!state.activePerson) {
    alert('Select who you are (top right) first, so we can record who made the change.');
    buildThresholdSettings(); // revert UI to stored state
    return;
  }
  // The mode/destination selects always carry a value (they default to
  // drive / nearest GO station), so only persist them when there is an
  // actual per-leg travel threshold. Otherwise editing another field would
  // stamp drive/go_station onto an otherwise-unset row, violating the
  // "NULL means not set" model. No travel_minutes => the whole travel
  // threshold is unset => null the mode, destination, and total too.
  const travelMinutes = posNumOrNull(fields.minsInput.value);
  const travelSet = travelMinutes != null;
  const destKind = fields.destSel.value;
  const payload = {
    person_id: personId,
    actor_id: state.activePerson,
    travel_minutes: travelMinutes,
    travel_total_minutes: travelSet ? posNumOrNull(fields.totalInput.value) : null,
    travel_mode: travelSet ? (fields.modeSel.value || null) : null,
    travel_dest_kind: travelSet ? destKind : null,
    travel_dest_ref: travelSet && destKind === 'poi' && fields.poiSel.value ? fields.poiSel.value : null,
  };
  try {
    const res = await fetch('/api/person-thresholds', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || 'Save failed');
    if (data.threshold) state.personThresholds[String(personId)] = data.threshold;
    buildThresholdSettings();       // refresh attribution line
    applyFiltersAndRender();        // highway indicator/filter may now differ
  } catch (err) {
    console.error(err);
    alert('Could not save the threshold. Try again.');
    buildThresholdSettings();
  }
}

// Search-then-drop, using Mapbox's Geocoding API (same token as the map
// tiles, see DECISIONS.md T14 for why this is a new external call and why
// it was judged low-risk enough to add directly rather than stopping to ask).
async function addPoiPin() {
  if (!state.activePerson) { alert('Select who you are (top right) first.'); return; }
  const query = (prompt('Search for a place (school, hospital, workplace, place of worship, etc.):') || '').trim();
  if (!query) return;

  let feature = null;
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`
      + `?access_token=${encodeURIComponent(MAPBOX_TOKEN)}&proximity=-79.5,44.0&limit=1`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      feature = (data.features || [])[0] || null;
    }
  } catch (err) {
    console.error(err);
  }
  if (!feature) { alert(`No place found for "${query}". Try a different search.`); return; }

  const typeChoices = Object.keys(POI_TYPE_META).join(', ');
  const typedType = (prompt(`Type (${typeChoices}):`, 'other') || 'other').trim().toLowerCase();
  const type = POI_TYPE_META[typedType] ? typedType : 'other';
  const label = (prompt('Label (optional):', feature.place_name) || feature.place_name || '').trim();
  const [lng, lat] = feature.center;

  try {
    const res = await fetch('/api/poi', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_id: state.activePerson, type, label, lat, lng }),
    });
    if (!res.ok) throw new Error('save failed');
    await loadPoi();
  } catch (err) {
    console.error(err);
    alert('Could not save the place. Try again.');
  }
}

// ─── Per-property place attachments ───────────────────────────────────────────
// Progressive, like notes and the potential price: existing attachments and an
// "Attach a place" button always show; the composer is hidden until clicked. A
// place is always a POI pin (one source of truth): attach an existing pin, or
// enter a new address that gets geocoded into a pin. Shared across the group
// with who-added attribution. Straight-line distance shows immediately;
// street-routed drive time is computed on attach and cached server-side, with a
// recompute affordance. Deliberately NOT gated on any star rating in code.
async function geocodePlace(query) {
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`
      + `?access_token=${encodeURIComponent(MAPBOX_TOKEN)}&proximity=-79.5,44.0&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const f = (data.features || [])[0];
    return f ? { lng: f.center[0], lat: f.center[1], label: f.place_name } : null;
  } catch (err) { console.error(err); return null; }
}

function buildPlaceAttachments(node, item) {
  const container = node.querySelector('.card-place-attachments');
  if (!container) return;
  container.innerHTML = '';
  if (!item.poc) return; // pocOnly: attachments measure from a listing's coordinates

  container.append(el('div', { className: 'attach-heading', textContent: 'Attached places' }));

  (state.placeAttachments[item.mls] || []).forEach(a => {
    const typeLabel = (POI_TYPE_META[a.poi_type] || POI_TYPE_META.other).label;
    const straight = a.straight_km != null ? `${num(a.straight_km)} km straight-line` : '';
    const drive = a.drive_minutes != null
      ? `${num(a.drive_minutes)} min drive` + (a.drive_km != null ? ` (${num(a.drive_km)} km)` : '')
      : 'drive time unavailable';
    const row = el('div', { className: 'attach-row' });
    row.append(el('div', { className: 'attach-info' },
      el('span', { className: 'attach-name', textContent: a.poi_label || typeLabel }),
      el('span', { className: 'attach-detail', textContent: [straight, drive].filter(Boolean).join(' · ') }),
      el('span', { className: 'attach-by', textContent: `added by ${a.created_by_name}` })));
    const recomputeBtn = el('button', { type: 'button', className: 'secondary fb-btn', textContent: '↻', title: 'Recompute drive time' });
    recomputeBtn.addEventListener('click', () => recomputeAttachment(item, a.id));
    const removeBtn = el('button', { type: 'button', className: 'secondary fb-btn fb-btn-reject', textContent: '✕', title: 'Remove this place' });
    removeBtn.addEventListener('click', () => removeAttachment(item, a.id));
    row.append(el('div', { className: 'attach-btns' }, recomputeBtn, removeBtn));
    container.append(row);
  });

  const addBtn = el('button', { type: 'button', className: 'secondary fb-btn', textContent: '➕ Attach a place' });
  const composer = el('div', { className: 'feedback-compose attach-compose' });
  composer.hidden = true;

  const modeSel = el('select', { className: 'attach-select' });
  modeSel.innerHTML = `<option value="existing">Choose a pinned place</option><option value="new">New address</option>`;
  const poiSel = el('select', { className: 'attach-select' });
  const refreshPoiOptions = () => {
    poiSel.innerHTML = state.poi.length
      ? state.poi.map(p => `<option value="${p.id}">${esc(p.label || (POI_TYPE_META[p.type] || POI_TYPE_META.other).label)}</option>`).join('')
      : `<option value="">No places pinned yet</option>`;
  };
  refreshPoiOptions();

  const addrInput = el('input', { type: 'text', placeholder: 'Address or place name' });
  const typeSel = el('select', { className: 'attach-select' });
  typeSel.innerHTML = Object.entries(POI_TYPE_META).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  typeSel.value = 'work';
  const newWrap = el('div', { className: 'attach-new-wrap' }, addrInput, typeSel);

  const applyMode = () => {
    const isNew = modeSel.value === 'new';
    poiSel.style.display = isNew ? 'none' : '';
    newWrap.style.display = isNew ? '' : 'none';
  };
  modeSel.addEventListener('change', applyMode);
  applyMode();

  const statusEl = el('div', { className: 'feedback-status' });
  const confirmBtn = el('button', { type: 'button', textContent: 'Attach' });
  confirmBtn.addEventListener('click', () => attachPlace(item, { modeSel, poiSel, addrInput, typeSel, statusEl, confirmBtn }));

  composer.append(modeSel, poiSel, newWrap, confirmBtn, statusEl);
  addBtn.addEventListener('click', () => { if (composer.hidden) { refreshPoiOptions(); composer.hidden = false; } else { composer.hidden = true; } });
  container.append(addBtn, composer);
}

async function attachPlace(item, ui) {
  if (!state.activePerson) { showFeedbackStatus(ui.statusEl, 'Select who you are first.', true); return; }
  ui.confirmBtn.disabled = true;
  try {
    let body;
    if (ui.modeSel.value === 'new') {
      const query = ui.addrInput.value.trim();
      if (!query) { showFeedbackStatus(ui.statusEl, 'Enter an address.', true); return; }
      showFeedbackStatus(ui.statusEl, 'Looking up address…', false);
      const place = await geocodePlace(query);
      if (!place) { showFeedbackStatus(ui.statusEl, 'No place found for that address.', true); return; }
      body = { listing_id: item.mls, person_id: state.activePerson,
               new_place: { type: ui.typeSel.value, label: place.label, lat: place.lat, lng: place.lng } };
    } else {
      const poiId = Number(ui.poiSel.value);
      if (!poiId) { showFeedbackStatus(ui.statusEl, 'Pin a place on the map first, or use New address.', true); return; }
      body = { listing_id: item.mls, person_id: state.activePerson, poi_id: poiId };
    }
    showFeedbackStatus(ui.statusEl, 'Attaching and computing drive time…', false);
    const res = await fetch('/api/place-attachments', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || 'Attach failed');
    await reloadAfterAttachmentChange(item);
  } catch (err) {
    showFeedbackStatus(ui.statusEl, err.message, true);
  } finally {
    ui.confirmBtn.disabled = false;
  }
}

async function removeAttachment(item, id) {
  try {
    const res = await fetch('/api/place-attachments', {
      method: 'DELETE', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error('remove failed');
    await reloadAfterAttachmentChange(item);
  } catch (err) { console.error(err); alert('Could not remove the place. Try again.'); }
}

async function recomputeAttachment(item, id) {
  try {
    const res = await fetch('/api/place-attachments/recompute', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error('recompute failed');
    await reloadAfterAttachmentChange(item);
  } catch (err) { console.error(err); alert('Could not recompute the drive time. Try again.'); }
}

// Refetch attachments (and POI, since a new address adds a pin) for the loaded
// listings, then re-render, keeping the map view and re-showing the open card.
async function reloadAfterAttachmentChange(item) {
  const openMlsBeforeReload = state.openMapItem?.mls;
  state.placeAttachments = await fetchPlaceAttachments(state.rawListings.map(x => x.mls));
  await loadPoi();
  applyFiltersAndRender();
  if (openMlsBeforeReload) {
    const refreshed = findListing(openMlsBeforeReload);
    if (refreshed) showMapCard(refreshed);
  }
}

// Rejected status must come from the ACTIVE actor's live feedback
// (listing_feedback), not item.status -- for POC listings that field is a
// static historical snapshot (pre-multi-actor) and can say "Rejected" for a
// listing the active actor never rejected.
function markerColor(item) {
  const f = personFeedbackFor(item.mls, state.activePerson);
  if (f?.status === 'rejected') return '#aaa';
  const total = item.fit?.total || 8;
  const ratio = (item.fit?.met ?? 0) / total;
  if (ratio >= 0.75) return '#16803a'; // green -- strong fit
  if (ratio >= 0.5) return '#e8b400';  // yellow -- good fit
  return '#e8720c';                    // orange -- possible fit
}

function clusterRadius(count) {
  return Math.min(40, 12 + Math.log2(count + 1) * 5);
}

// ─── Dynamic clustering (Repliers, viewport-scoped) ─────────────────────────────
// The viewport rectangle (or the drawn areas, if any) as the Repliers `map`
// polygon so clusters are computed for what's in view; recomputed with a
// zoom-driven precision on every pan/zoom, so bubbles split as you zoom in.
function viewportPolygonParam() {
  if (!state.map) return null;
  const b = state.map.getBounds();
  const w = b.getWest(), s = b.getSouth(), e = b.getEast(), n = b.getNorth();
  return JSON.stringify([[[w, s], [w, n], [e, n], [e, s], [w, s]]]);
}

let _clusterTimer = null;
function scheduleClusterRefetch() {
  clearTimeout(_clusterTimer);
  _clusterTimer = setTimeout(() => { refetchClustersForViewport(); }, 300);
}
async function refetchClustersForViewport() {
  if (!clusteringActive() || !state.mapReady) return;
  const p = new URLSearchParams();
  p.set('cluster', 'true');
  p.set('clusterPrecision', String(clusterPrecisionForZoom()));
  // Cluster within the drawn areas when a draw-area filter is active (Part 2),
  // else within the current viewport.
  const poly = (typeof drawnPolygonsParam === 'function' && drawnPolygonsParam()) || viewportPolygonParam();
  if (poly) p.set('map', poly);
  try {
    const res = await fetch('/api/listings?' + p);
    const data = await res.json();
    if (!res.ok) return;
    state.clusters = data.clusters || [];
    if (clusteringActive()) renderClusterLayer();
  } catch (err) { console.error(err); }
}

function renderClusterLayer() {
  if (!state.mapReady) return;
  const fc = emptyFC();
  state.clusters.forEach((c, idx) => {
    if (c.lat == null || c.lng == null) return;
    const b = c.bounds;
    fc.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
      properties: {
        count: c.count, radius: clusterRadius(c.count), clusterIdx: idx,
        swLng: b ? b.top_left.longitude : null, swLat: b ? b.bottom_right.latitude : null,
        neLng: b ? b.bottom_right.longitude : null, neLat: b ? b.top_left.latitude : null,
      },
    });
  });
  state.map.getSource('clusters').setData(fc);
}

// Above this count, a cluster zooms to split rather than listing its members
// (avoids a popup with thousands of entries). Small "won't-split" clusters
// (a few homes on one street) are well under this and open the chooser.
const CLUSTER_POPUP_MAX = 50;
async function handleClusterClick(c, p) {
  if (c.count > CLUSTER_POPUP_MAX) {
    if (p.swLng != null) state.map.fitBounds([[p.swLng, p.swLat], [p.neLng, p.neLat]], { padding: 30, maxZoom: 17 });
    return;
  }
  // Inline listings come free for clusters at/under clusterListingsThreshold;
  // above that, fetch this cluster's listings within its bounds (one request).
  let listings = c.listings || [];
  if (listings.length < c.count) listings = await fetchListingsInBounds(c.bounds, c.count);
  if (c.count === 1 && listings[0]) { showMapCard(listings[0]); return; }
  if (listings.length) openListingChooser(listings);
  else if (p.swLng != null) state.map.fitBounds([[p.swLng, p.swLat], [p.neLng, p.neLat]], { padding: 30, maxZoom: 17 });
}

async function fetchListingsInBounds(bounds, count) {
  if (!bounds) return [];
  const w = bounds.top_left.longitude, e = bounds.bottom_right.longitude;
  const s = bounds.bottom_right.latitude, n = bounds.top_left.latitude;
  const poly = JSON.stringify([[[w, s], [w, n], [e, n], [e, s], [w, s]]]);
  const p = new URLSearchParams();
  p.set('map', poly);
  p.set('resultsPerPage', String(Math.min(count || 50, 100)));
  try {
    const res = await fetch('/api/listings?' + p);
    const data = await res.json();
    return res.ok ? (data.listings || []) : [];
  } catch (err) { console.error(err); return []; }
}

// ─── Cluster / stacked-pin chooser popup (realtor.ca-style mini-card list) ──────
// A scrollable list of mini-cards for the listings under a cluster or a stack
// of overlapping pins. Each mini-card shows thumbnail, price, address, a
// beds/baths/sqft line, and the group sentiment chips (the at-a-glance
// element); tapping opens the full property card. Closes on click-outside.
async function openListingChooser(listings) {
  closeMapCard();
  try { Object.assign(state.feedback, await fetchFeedback(listings.map(l => l.mls))); } catch (err) { console.error(err); }
  const inner = $('clusterPopupInner');
  inner.innerHTML = '';
  listings.forEach(item => inner.appendChild(buildMiniCard(item)));
  const cnt = $('clusterPopupCount');
  if (cnt) cnt.textContent = `${listings.length} listings here`;
  $('clusterPopup').hidden = false;
  state.clusterPopupOpen = true;
}
function closeClusterPopup() { const p = $('clusterPopup'); if (p) { p.hidden = true; } state.clusterPopupOpen = false; }
function buildMiniCard(item) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'mini-card';
  const thumb = item.image
    ? `<img class="mini-thumb" src="${esc(item.image)}" alt="" loading="lazy" />`
    : `<div class="mini-thumb mini-thumb-empty">🏠</div>`;
  const stat = [item.beds && item.beds + ' bd', item.baths != null && num(item.baths) + ' ba', item.sqft && num(item.sqft) + ' sqft'].filter(Boolean).join(' · ');
  const feedbackList = state.feedback[item.mls] || [];
  const byPerson = new Map(feedbackList.map(f => [f.person_id, f]));
  const chips = state.people.length ? state.people.map(p => groupSentimentChip(p, byPerson.get(p.id) || null)).join('') : '';
  card.innerHTML = thumb
    + '<div class="mini-body">'
    + `<div class="mini-price">${esc(money(item.price) || 'Price n/a')}</div>`
    + `<div class="mini-addr">${esc(item.address || '')}</div>`
    + (stat ? `<div class="mini-stat">${esc(stat)}</div>` : '')
    + (chips ? `<div class="mini-chips">${chips}</div>` : '')
    + '</div>';
  // stopPropagation so this tap does not also reach the global click-outside
  // listener, which would otherwise immediately close the card it just opened.
  card.addEventListener('click', e => { e.stopPropagation(); closeClusterPopup(); showMapCard(item); });
  return card;
}

function refreshMap(list) {
  if (!state.mapReady) return;
  closeMapCard();
  closeClusterPopup();
  if (clusteringActive()) {
    // Viewport-driven server clusters: no flat pins, no auto-fit (that would
    // fight the user's zoom). Render current clusters, then refetch this view.
    state.map.getSource('listings').setData(emptyFC());
    renderClusterLayer();
    refetchClustersForViewport();
    requestAnimationFrame(() => state.map?.resize());
    return;
  }
  // Individual pins (POC always; Sample Data when clustering is off).
  state.map.getSource('clusters').setData(emptyFC());
  const listingsFC = emptyFC();
  const bounds = [];
  list.forEach(item => {
    if (item.lat == null || item.lng == null) return;
    const myRating = personFeedbackFor(item.mls, state.activePerson)?.rating;
    listingsFC.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
      properties: { mls: item.mls, color: markerColor(item), ratingLabel: myRating != null ? String(myRating) : '' },
    });
    bounds.push([item.lng, item.lat]);
  });
  state.map.getSource('listings').setData(listingsFC);
  const b = lngLatBoundsOf(bounds);
  if (b) state.map.fitBounds(b, { padding: 40, maxZoom: 15 });
  requestAnimationFrame(() => state.map?.resize());
}

// ─── Map card popup ───────────────────────────────────────────────────────────
function showMapCard(item) {
  closeClusterPopup();
  const inner = $('mapCardInner');
  inner.innerHTML = '';
  const tpl = $('cardTemplate');
  const node = tpl.content.cloneNode(true);
  populateCard(node, item);
  // In map card, "show on map" button not useful, remove it
  node.querySelector('.show-map')?.remove();
  inner.appendChild(node);
  applyCardVisibility();
  $('mapCard').hidden = false;
  state.openMapItem = item;
  // Zoom to pin (guarded: the card also opens from the list/chooser where the
  // map may not be initialised, e.g. if WebGL is unavailable).
  if (state.map && item.lng != null && item.lat != null) {
    state.map.easeTo({ center: [item.lng, item.lat], zoom: Math.max(state.map.getZoom(), 12) });
  }
}

function closeMapCard() { $('mapCard').hidden = true; state.openMapItem = null; }

// ─── Click-outside-to-dismiss ──────────────────────────────────────────────────
// One consistent rule for every open dropdown/panel: Filters, the map Layers
// panel, the map Legend, and the map card popup all close on a click outside
// themselves, standard click-outside behaviour, applied the same way to all
// four instead of each having its own bespoke dismiss logic. A click on a
// feature that opens one of these (a listing pin opening the map card, for
// example) calls e.originalEvent.stopPropagation() in its own handler so that
// same click is never seen here and cannot immediately close what it just
// opened. The settings drawer is intentionally not included here: it already
// has its own dedicated overlay-click-to-close pattern.
function closeOutsideDetailsPanels(clickTarget) {
  [$('filterbox'), $('mapLayersPanel'), $('mapLegend')].forEach(el => {
    if (el && el.open && !el.contains(clickTarget)) el.open = false;
  });
}

function closeOutsidePanels(clickTarget) {
  closeOutsideDetailsPanels(clickTarget);
  const mapCard = $('mapCard');
  if (mapCard && !mapCard.hidden && !mapCard.contains(clickTarget)) closeMapCard();
  const clusterPopup = $('clusterPopup');
  if (clusterPopup && !clusterPopup.hidden && !clusterPopup.contains(clickTarget)) closeClusterPopup();
}

// ─── Card builder ─────────────────────────────────────────────────────────────
function tag(text, cls = '') { return `<span class="tag ${cls}">${esc(text)}</span>`; }

// Group sentiment row (display only, not filtering). Read-only summary of
// where the buyer group stands, built entirely from data already fetched
// (state.people from GET /api/people, state.feedback from GET /api/feedback).
// Role-driven, not name-driven -- works for 1, 2, or N people. This is NOT
// the deferred consensus filtering in TODOS.md (which hides/shows listings);
// this never changes what's visible, only how it reads at a glance.
function groupSentimentChip(person, f) {
  let stateClass = 'chip-none';
  let label = esc(person.name);
  if (f?.status === 'rejected') {
    stateClass = 'chip-reject';
    // Reject wins the chip's single headline state (a chip can only show
    // one thing), but a research request on the same listing is a real,
    // independent fact, not mutually exclusive with reject. Append the
    // research icon so it stays visible on the chip itself instead of
    // silently dropping out just because reject is the louder state.
    label = f.research_requested ? `🚫🔍 ${esc(person.name)}` : `🚫 ${esc(person.name)}`;
  } else if (f?.rating != null) {
    stateClass = 'chip-rated';
    label = `${esc(person.name)} ★${f.rating}`;
  } else if (f?.research_requested) {
    stateClass = 'chip-research';
    label = `🔍 ${esc(person.name)}`;
  }
  // Realtor input must never silently read as buyer sentiment (design-spec
  // Section 6) -- a dashed border plus a hollow-diamond prefix mark every
  // realtor chip, on top of the same reject/rated/research/none states.
  const realtor = person.role === 'realtor';
  const mark = realtor ? '<span class="chip-realtor-mark">◇</span>' : '';
  return `<span class="chip group-chip ${stateClass}${realtor ? ' chip-realtor' : ''}" title="${esc(person.name)} (${esc(person.role)})">${mark}${label}</span>`;
}

function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || name;
}

// Buyer-only headline. Advisors show as chips above but never move this word.
// `buyers` is the dynamic list of people with role === 'buyer'; `feedbackByPerson`
// maps person id to their feedback for this listing, same map groupSentimentChip uses.
function buyerHeadline(buyers, feedbackByPerson) {
  const buyerFeedback = buyers.map(p => feedbackByPerson.get(p.id) || null);
  if (buyerFeedback.some(f => f?.status === 'rejected')) return { word: 'Vetoed', cls: 'headline-vetoed' };
  if (buyers.length && buyerFeedback.every(f => f?.rating != null)) return { word: 'Aligned', cls: 'headline-aligned' };
  // Zero-buyers safety default: no buyer data exists to summarize, so never
  // imply a consensus (or a "waiting on" list) that doesn't exist.
  if (!buyers.length) return { word: 'Split', cls: 'headline-split' };
  const missing = buyers.filter(p => (feedbackByPerson.get(p.id) || null)?.rating == null);
  const word = missing.length <= 2
    ? 'Waiting on ' + missing.map(p => firstName(p.name)).join(' and ')
    : 'Waiting on ' + missing.length;
  return { word, cls: 'headline-waiting' };
}

function populateCard(node, item) {
  const poc = item.poc || null;

  // Order the card's sections into the workflow groups before filling them.
  assembleCardGroups(node);

  // Photo
  const img = node.querySelector('.photo');
  img.src = item.image || '';
  img.alt = item.address;
  if (!item.image) node.querySelector('.card-photo-wrap').style.display = 'none';

  // Status badge: POC's raw "status" is a static historical snapshot from
  // before the multi-actor model (can say "Rejected" for a listing the
  // active actor never rejected), so POC badges use the actor's live
  // feedback instead. Repliers listings have no such history; their status
  // is real MLS status and shown as-is.
  const badge = node.querySelector('.card-status-badge');
  if (poc) {
    const mine = personFeedbackFor(item.mls, state.activePerson);
    if (mine?.status === 'rejected') {
      badge.textContent = 'Rejected';
      badge.className = 'card-status-badge badge-rejected';
    }
  } else {
    const st = (item.status || '').toLowerCase();
    if (st && st !== 'new' && st !== 'poc') {
      badge.textContent = item.status;
      badge.className = 'card-status-badge ' +
        (/reject/i.test(st) ? 'badge-rejected' : /short/i.test(st) ? 'badge-shortlist' : 'badge-reviewing');
    }
  }

  // Address + meta
  node.querySelector('.address').textContent = item.address;
  node.querySelector('.meta').textContent = [item.beds && item.beds + ' beds', item.propertyType !== 'House Hunter POC' && item.propertyType].filter(Boolean).join(' · ');

  // Tier badge: subtle, text-only; hidden automatically via :empty when unknown
  node.querySelector('.tier-badge').textContent = TIER_LABELS[(item.tier || '').toLowerCase()] || '';

  // Fit badge
  const fit = item.fit;
  const fb = node.querySelector('.fit-badge');
  fb.innerHTML = `<strong>${esc(fit.label)}</strong><span>fit</span>`;
  fb.className = 'fit-badge ' + (fit.met >= 7 ? 'fit-green' : fit.met >= 5 ? 'fit-blue' : fit.met >= 4 ? 'fit-amber' : 'fit-red');

  // Summary value (T18), single user-chosen headline number, hidden when
  // the chosen field has no data for this listing (e.g. Repliers listings
  // have no Cost to close / PIT).
  const summaryEl = node.querySelector('.card-summary-value');
  const summary = summaryValueFor(item);
  summaryEl.innerHTML = summary
    ? `<span class="fin-label">${esc(summary.label)}</span><span class="fin-value">${esc(summary.value)}</span>`
    : '';

  // Price: the list price, plus the entered estimate (potential purchase
  // price) on its own line below it once one exists. Two lines, same size,
  // List Price first, Estimate second, with the estimate's attribution. When
  // no estimate is entered, only the List Price line shows; the Add potential
  // price affordance lives just below in buildPotentialPriceEditor.
  {
    const priceEl = node.querySelector('.card-price');
    const lines = [];
    if (item.price != null) {
      lines.push(`<div class="price-line"><span class="price-line-label">List Price:</span> <span class="price-line-amt">${esc(money(item.price))}</span></div>`);
    }
    const potential = item.potentialPurchasePrice;
    if (potential != null) {
      lines.push(`<div class="price-line"><span class="price-line-label">Estimate:</span> <span class="price-line-amt">${esc(money(potential.price))}</span> <span class="price-line-by">(${esc(potential.updatedByName)})</span></div>`);
    }
    priceEl.innerHTML = lines.join('');
  }

  // Potential purchase price editor: shared across the group, not per
  // person, edit affordance directly below the price it can override.
  buildPotentialPriceEditor(node, item);

  // Group sentiment row (display only, see groupSentimentChip/buyerHeadline)
  {
    const groupEl = node.querySelector('.card-group');
    if (groupEl) {
      if (!state.people.length) {
        groupEl.style.display = 'none';
      } else {
        groupEl.style.display = '';
        const feedbackList = state.feedback[item.mls] || [];
        const feedbackByPerson = new Map(feedbackList.map(f => [f.person_id, f]));
        const chips = state.people.map(p => groupSentimentChip(p, feedbackByPerson.get(p.id) || null));
        const buyers = state.people.filter(p => p.role === 'buyer');
        const headline = buyerHeadline(buyers, feedbackByPerson);
        groupEl.innerHTML = `<span class="group-headline ${headline.cls}">${esc(headline.word)}</span>` + chips.join('');
      }
    }
  }

  // Commute
  if (poc) {
    const goStation = item.goStation || item.brokerage || '';
    const parts = [
      item.goMin && num(item.goMin) + ' min drive',
      poc.goTrain && num(poc.goTrain) + ' min train',
      poc.goTotal && num(poc.goTotal) + ' min to Union',
    ].filter(Boolean);
    node.querySelector('.card-commute').innerHTML =
      `<span class="commute-station">${esc(goStation)}</span>` +
      (parts.length ? `<span class="commute-detail">${esc(parts.join(' · '))}</span>` : '');
  }

  // Highway distance (straight-line to the nearest 400-series highway).
  // The household's threshold is a MINIMUM acceptable distance (a noise/
  // pollution radius): closer to a highway is bad, farther is good. So a
  // listing closer than the minimum is a negative (red, "too close"), and
  // one at or beyond it is a positive (green, "clears"). It is a household
  // position, so the badge shows for everyone regardless of who is active;
  // with no household minimum set, it just states the distance.
  {
    const hwyEl = node.querySelector('.card-highway');
    if (hwyEl) {
      if (poc && item.highwayKm != null) {
        const limit = householdHighwayKm();
        let badge = '';
        if (limit != null) {
          const tooClose = item.highwayKm < limit;
          badge = `<span class="hwy-badge ${tooClose ? 'hwy-bad' : 'hwy-good'}">`
            + (tooClose
                ? `✕ closer than the ${num(limit)} km minimum`
                : `✓ clears the ${num(limit)} km minimum`)
            + `</span>`;
        }
        hwyEl.style.display = '';
        hwyEl.innerHTML =
          `<span class="hwy-label">${esc(num(item.highwayKm))} km to ${esc(item.nearestHighway || 'highway')}</span>`
          + `<span class="hwy-sub">straight-line, noise/pollution radius</span>`
          + badge;
      } else {
        hwyEl.style.display = 'none';
      }
    }
  }

  // Stats
  const statTags = [
    item.beds && tag(String(item.beds) + ' beds'),
    item.baths && tag(num(item.baths) + ' baths'),
    item.sqft && tag(num(item.sqft) + ' sqft'),
    item.acres && tag(num(item.acres, ' ac')),
    poc && item.frontageNum && item.depthNum && tag(lotDimsLabel(item)),
    !poc && item.dom && tag(num(item.dom) + ' DOM'),
    !poc && item.imageCount && tag(num(item.imageCount) + ' photos'),
  ].filter(Boolean);
  node.querySelector('.card-stats').innerHTML = statTags.join('');

  // Financial: the computed cost-to-close/Monthly PIT breakdown is the
  // default for every listing now, keyed off the potential purchase
  // price when one is entered, list price otherwise (see
  // enrich_with_mortgage_breakdown in server.py). The original flat
  // pre-entered pitNum/dueClosing figures are never shown here; they
  // stay in the underlying record only as a reference. Condo fee is
  // never part of the breakdown, it is a flat figure, not price-
  // dependent (confirmed: no percentage-of-price condo fee field exists
  // anywhere in this data), so it always shows its own stored value
  // regardless of which price is active.
  if (poc) {
    const financialEl = node.querySelector('.card-financial');
    const finRow = ([label, value, cls]) => `<div class="fin-row${cls ? ' ' + cls : ''}"><span class="fin-label">${esc(label)}</span><span class="fin-value">${esc(value)}</span></div>`;
    // Condo fees: surfaced when the listing has them. Maintenance fees: no such
    // field exists in the POC data or schema (only condoFeeNum, from Repliers
    // HOAFee or a future POC column), so that line is omitted, not invented.
    const condoFee = item.isCondo && item.condoFeeNum ? item.condoFeeNum : null;
    if (item.mortgageBreakdown) {
      const bd = item.mortgageBreakdown;
      const { closingItems, monthlyItems, totals } = mortgageBreakdownRows(bd);

      // Summary block (always visible): the two totals, then any recurring fee
      // lines, then a computed Total monthly. Total monthly (PIT + the fees
      // that exist) only shows when there is at least one fee beyond PIT,
      // otherwise it would just repeat the PIT figure.
      const summary = [...totals];
      if (condoFee != null) summary.push(['Condo fees', money(condoFee) + '/mo']);
      if (condoFee != null) summary.push(['Total monthly', money(bd.monthlyPit + condoFee) + '/mo', 'fin-row-total']);

      // Itemized breakdown (collapsed), split at the closing/monthly boundary
      // with a labelled dashed divider.
      const details = '<details class="fin-details"><summary>Itemized breakdown</summary>'
        + '<div class="fin-subhead">One-time at closing</div>'
        + closingItems.map(finRow).join('')
        + '<div class="fin-subhead fin-subhead-monthly">Monthly</div>'
        + monthlyItems.map(finRow).join('')
        + '</details>';

      financialEl.innerHTML = summary.map(finRow).join('') + details
        + '<div class="fin-disclaimer">Estimates only. Confirm real figures with a mortgage professional and lawyer before closing, since rates, lender rules, and individual circumstances can change the actual numbers.</div>';
    } else {
      // No valid price to compute against at all (no potential price entered
      // and no list price either). Nothing computed to show; a condo fee, if
      // any, still stands on its own.
      financialEl.innerHTML = condoFee != null ? finRow(['Condo fees', money(condoFee) + '/mo']) : '';
    }
  }

  // Ratings: dynamic per person (D9), replaces hardcoded Mark/Katie
  {
    const feedbackList = state.feedback[item.mls] || [];
    const rows = feedbackList
      .filter(f => f.rating != null || f.status || f.research_requested)
      .map(f => {
        // status and research_requested are independent facts (a person can
        // reject a listing and still want research on it), so both render
        // as their own tag rather than one hiding the other.
        const statusTag = f.status ? ` <span class="tag${f.status === 'rejected' ? ' bad' : ''}">${esc(f.status)}</span>` : '';
        const researchTag = f.research_requested ? ` <span class="tag">🔍 research requested</span>` : '';
        return `<div class="rating-row"><span class="rating-who">${esc(f.person_name)}</span><span class="rating-stars">${stars(f.rating)}</span>${statusTag}${researchTag}</div>`;
      });
    const el = node.querySelector('.card-ratings');
    if (rows.length) el.innerHTML = rows.join('');
    else el.style.display = 'none';
  }

  // Fit fails
  node.querySelector('.card-fit-tags').innerHTML = (fit.failedLabels || []).slice(0, 4).map(x => tag('× ' + x, 'bad')).join('');

  // Features
  if (poc && item.features) {
    node.querySelector('.card-features').innerHTML = item.features.split(',').map(f => tag(f.trim())).join('');
  }

  // Comments: dynamic per person (D9), replaces hardcoded Mark/Katie/Anees
  // T11: full note history per person (newest first), each dated by its own
  // created_at, not just the single latest note collapsed into one line.
  {
    const feedbackList = state.feedback[item.mls] || [];
    const rows = [
      ...feedbackList.flatMap(f => (f.note_history || []).map(h =>
        `<div class="comment-line"><span class="comment-who">${esc(f.person_name)}</span><span class="comment-date">${esc((h.created_at || '').slice(0, 10))}</span>${esc(h.note)}</div>`)),
      ...feedbackList.filter(f => f.research_note).map(f =>
        `<div class="comment-line"><span class="comment-who">${esc(f.person_name)} (research)</span>${esc(f.research_note)}</div>`),
    ];
    const el = node.querySelector('.card-comments');
    if (rows.length) el.innerHTML = rows.join('');
    else el.style.display = 'none';
  }

  // Per-property place attachments (shared, progressive add, cached drive time)
  buildPlaceAttachments(node, item);

  // Feedback actions (D7/D12): shared control set for List cards and Map popups
  buildFeedbackActions(node, item);

  // Actions
  const linkBtn = node.querySelector('.card-link-btn');
  const docBtn  = node.querySelector('.card-doc-btn');
  if (poc?.link) linkBtn.href = poc.link; else linkBtn.style.display = 'none';
  if (poc?.doc) {
    docBtn.href = poc.doc;
    docBtn.textContent = 'Research doc';
  } else {
    // Repliers listings have no research doc yet, fall back to a Drive search.
    docBtn.href = 'https://drive.google.com/drive/search?q=' + encodeURIComponent(item.address || '');
    docBtn.textContent = 'Search Drive';
  }

  // Show on map (list view only, switches to map view and shows card)
  const showMapBtn = node.querySelector('.show-map');
  if (showMapBtn) {
    showMapBtn.addEventListener('click', () => {
      switchView('map');
      if (item.lat != null && item.lng != null) {
        state.map.jumpTo({ center: [item.lng, item.lat], zoom: 13 });
        setTimeout(() => showMapCard(item), 100);
      }
    });
  }
}

function renderCards(list) {
  const cards = $('cards');
  cards.innerHTML = '';
  const tpl = $('cardTemplate');
  sortListings(list).forEach(item => {
    const node = tpl.content.cloneNode(true);
    populateCard(node, item);
    cards.appendChild(node);
  });
  applyCardVisibility();
}

// ─── Sort ─────────────────────────────────────────────────────────────────────
function currentSort() {
  // Both sort selects stay in sync; use whichever is active
  return ($('sort')?.value || $('sortList')?.value || 'fit-desc');
}

function syncSort(value) {
  if ($('sort')) $('sort').value = value;
  if ($('sortList')) $('sortList').value = value;
}

function sortListings(list) {
  const mode = currentSort();
  const s = [...list];
  const cmp = (a, b, g, dir = 1) => { const av = g(a), bv = g(b); if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1; return (av - bv) * dir; };
  // beds falls back to the always-numeric bedsNum first: POC's own "beds"
  // can be a composite display string like "3+1" (see passes_local_filters
  // in server.py for the same fallback, server-side). Repliers listings
  // have no bedsNum key at all, so ?? correctly falls through to their
  // already-numeric beds.
  const bedsVal = x => x.bedsNum ?? x.beds;
  if (mode === 'fit-desc')      s.sort((a,b) => cmp(a,b, x => x.fit.met, -1));
  if (mode === 'fit-asc')       s.sort((a,b) => cmp(a,b, x => x.fit.met, 1));
  if (mode === 'price-asc')     s.sort((a,b) => cmp(a,b, x => x.price, 1));
  if (mode === 'price-desc')    s.sort((a,b) => cmp(a,b, x => x.price, -1));
  if (mode === 'beds-desc')     s.sort((a,b) => cmp(a,b, bedsVal, -1));
  if (mode === 'beds-asc')      s.sort((a,b) => cmp(a,b, bedsVal, 1));
  if (mode === 'baths-desc')    s.sort((a,b) => cmp(a,b, x => x.baths, -1));
  if (mode === 'baths-asc')     s.sort((a,b) => cmp(a,b, x => x.baths, 1));
  if (mode === 'sqft-desc')     s.sort((a,b) => cmp(a,b, x => x.sqft, -1));
  if (mode === 'sqft-asc')      s.sort((a,b) => cmp(a,b, x => x.sqft, 1));
  if (mode === 'lot-desc')      s.sort((a,b) => cmp(a,b, x => x.acres, -1));
  if (mode === 'lot-asc')       s.sort((a,b) => cmp(a,b, x => x.acres, 1));
  if (mode === 'go-asc')        s.sort((a,b) => cmp(a,b, x => x.poc?.goTotal ?? x.dom, 1));
  if (mode === 'go-desc')       s.sort((a,b) => cmp(a,b, x => x.poc?.goTotal ?? x.dom, -1));
  // Monthly PIT / Due at closing sort by the same computed-breakdown
  // figure the card and the filter panel already use (effectivePitNum/
  // effectiveDueNum), never the original flat pitNum/dueNum, so sorting
  // can't disagree with what's filtered or displayed.
  if (mode === 'pit-asc')       s.sort((a,b) => cmp(a,b, effectivePitNum, 1));
  if (mode === 'pit-desc')      s.sort((a,b) => cmp(a,b, effectivePitNum, -1));
  if (mode === 'due-asc')       s.sort((a,b) => cmp(a,b, effectiveDueNum, 1));
  if (mode === 'due-desc')      s.sort((a,b) => cmp(a,b, effectiveDueNum, -1));
  if (mode === 'myrating-desc') s.sort((a,b) => cmp(a,b, x => personFeedbackFor(x.mls, state.activePerson)?.rating ?? null, -1));
  return s;
}

// ─── Price inputs: comma-formatted display, raw digits for filtering ──────────
function formatThousands(digits) {
  return digits ? Number(digits).toLocaleString('en-US') : '';
}

function wirePriceInput(id) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('blur', () => {
    const digits = el.value.replace(/[^\d]/g, '');
    el.dataset.raw = digits;
    el.value = formatThousands(digits);
  });
  el.addEventListener('focus', () => {
    if (el.dataset.raw) el.value = el.dataset.raw;
  });
}

function numericFieldValue(id) {
  const el = $(id);
  if (!el) return '';
  return el.dataset.raw || el.value.replace(/[^\d]/g, '');
}

// ─── Load ─────────────────────────────────────────────────────────────────────
function filterParams() {
  const p = new URLSearchParams();
  // Note: minBaths/maxBaths can be decimal (step=0.5), read directly, not
  // through numericFieldValue() which strips non-digits for whole-dollar
  // comma-formatted fields and would corrupt "2.5" into "25".
  ['minBeds','maxBeds','minBaths','maxBaths','minFit','resultsPerPage'].forEach(id => {
    const v = $(id)?.value.trim();
    if (v) p.set(id, v);
  });
  ['minPrice','maxPrice'].forEach(id => {
    const v = numericFieldValue(id);
    if (v) p.set(id, v);
  });
  // Clustering is no longer a filter-panel toggle; it is an Appearance
  // preference applied viewport-side (see refetchClustersForViewport), so the
  // main list load does not carry cluster params.
  return p;
}

async function load() {
  const source = currentSource();
  $('summary').textContent = source === 'poc' ? 'Loading your POC data…' : 'Loading Sample Data…';
  $('sourcePill').textContent = source === 'poc' ? 'POC' : 'Sample Data';
  const res = await fetch((source === 'poc' ? '/api/poc-listings' : '/api/listings') + '?' + filterParams());
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || data.error || 'Load failed');
  state.rawListings = data.listings;
  state.source = source;
  state.sourceCount = data.sourceCount;
  state.clusters = data.clusters || [];
  const listingIds = state.rawListings.map(x => x.mls);
  state.feedback = await fetchFeedback(listingIds);
  state.placeAttachments = await fetchPlaceAttachments(listingIds);
  if (source === 'poc') state.map?.jumpTo({ center: [-79.5, 44.0], zoom: 9 });
  else state.map?.jumpTo({ center: [-87.6298, 41.8781], zoom: 10 });
  applyFiltersAndRender();
}

function reset() {
  ['q','minPrice','maxPrice','minBeds','maxBeds','minBaths','maxBaths','minSqft','maxSqft','minAcres','maxAcres','maxCommute','minHwyKm','maxHwyKm','minAttachDrive','maxAttachDrive','minPit','maxPit','minDue','maxDue','minFit','filterStatus']
    .forEach(id => { const el=$(id); if(el) { el.value=''; delete el.dataset.raw; } });
  $('resultsPerPage').value = '60';
  ['featGarage','featPool','featBasement','hideVetoed'].forEach(id => { const el = $(id); if (el) el.checked = false; });
  state.people.forEach(p => {
    PERSON_FILTER_OPTIONS.forEach(o => { const cb = $(personFilterCbId(p.id, o.value)); if (cb) cb.checked = false; });
  });
  // Reset stays the only reset concept (T10) -- also clears the persisted
  // last-used-state copy so a reload right after Reset doesn't bring it back.
  localStorage.removeItem(FILTER_STATE_KEY);
  load().catch(showError);
}
function showError(err) { console.error(err); $('summary').textContent = 'Error: ' + err.message; }

// ─── Filter/layer/sort state persistence (T10) ─────────────────────────────────
// Last-used-state persistence, same mechanism as THEME_KEY/SETTINGS_KEY --
// not a second "restore to default" concept. The existing Reset button
// stays the only way to clear filters back to their defaults; it also
// clears this saved state so a reload after Reset doesn't resurrect it.
const FILTER_STATE_KEY = 'hh_filter_state_v1';
// 'q' (the search box) is deliberately excluded from persistence. A typed
// search term that returns zero results (e.g. a non-listing address typed
// here instead of into "Add place") used to silently survive across
// reloads with no visible explanation, making the whole app look broken
// (0 of 105 listings) until someone opened Filters and noticed leftover
// text in the search box. Every other field here is a real, reusable
// preference; a one-off search term is not, so it always starts empty.
const PERSISTED_FIELD_IDS = [
  'minPrice', 'maxPrice', 'minBeds', 'maxBeds', 'minBaths', 'maxBaths',
  'minSqft', 'maxSqft', 'minAcres', 'maxAcres', 'maxCommute', 'minHwyKm', 'maxHwyKm',
  'minAttachDrive', 'maxAttachDrive',
  'minPit', 'maxPit', 'minDue', 'maxDue', 'minFit', 'filterStatus',
  'resultsPerPage', 'source', 'sort',
];
const PERSISTED_CHECKBOX_IDS = [
  'featGarage', 'featPool', 'featBasement', 'hideVetoed',
  'layerGoStations', 'layerGoStationsPlanned', 'layerGoLines', 'layerHwy413', 'layerPoiPins',
];

function saveFilterState() {
  const saved = {};
  PERSISTED_FIELD_IDS.forEach(id => { const el = $(id); if (el) saved[id] = el.value; });
  PERSISTED_CHECKBOX_IDS.forEach(id => { const el = $(id); if (el) saved[id] = el.checked; });
  saved._personFilters = Array.from(document.querySelectorAll('#personFilters input[type=checkbox]:checked')).map(cb => cb.id);
  localStorage.setItem(FILTER_STATE_KEY, JSON.stringify(saved));
}

function loadSavedFilterState() {
  try { return JSON.parse(localStorage.getItem(FILTER_STATE_KEY) || '{}'); } catch { return {}; }
}

// Restores plain field/select values and static checkboxes. Person-filter
// checkboxes are built dynamically after loadPeople() resolves, so they are
// restored separately in buildPersonFilters(); map layer visibility is
// applied separately once the map finishes loading (see initMap()).
function restoreFilterState() {
  const saved = loadSavedFilterState();
  PERSISTED_FIELD_IDS.forEach(id => { const el = $(id); if (el && id in saved) el.value = saved[id]; });
  PERSISTED_CHECKBOX_IDS.forEach(id => { const el = $(id); if (el && id in saved) el.checked = saved[id]; });
  if (saved.sort) syncSort(saved.sort);
}

function applyPersistedLayerVisibility() {
  if (!state.mapReady) return;
  const layerFor = {
    layerGoStations: 'go-stations-existing-circles',
    layerGoStationsPlanned: 'go-stations-planned-circles',
    layerGoLines: 'go-lines-layer',
    layerHwy413: 'hwy413-line',
    layerPoiPins: 'poi-pins-circles',
  };
  Object.entries(layerFor).forEach(([checkboxId, layerId]) => {
    const cb = $(checkboxId);
    if (cb) state.map.setLayoutProperty(layerId, 'visibility', cb.checked ? 'visible' : 'none');
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

window.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  ['minPrice', 'maxPrice', 'minPit', 'maxPit', 'minDue', 'maxDue'].forEach(wirePriceInput);
  // Restore last-used filter/layer/sort state (T10) before the initial load
  // so filterParams()/currentSource()/currentSort() all read restored values.
  restoreFilterState();
  document.querySelector('.controls')?.addEventListener('change', saveFilterState);
  document.querySelector('.controls')?.addEventListener('input', debounce(saveFilterState, 300));
  document.querySelector('.map-layers-body')?.addEventListener('change', saveFilterState);
  $('sort')?.addEventListener('change', saveFilterState);
  loadConfig()
    .then(() => {
      // A Mapbox init failure (WebGL disabled, blocked CDN, bad token) must
      // not take down the rest of the app -- List view has nothing to do
      // with the map and should keep working regardless.
      try { initMap(); } catch (err) { console.error('Map init failed:', err); }
      loadPeople().then(() => { applyFiltersAndRender(); loadPersonThresholds(); });
      loadPoi().then(buildThresholdSettings);
      loadHouseholdSettings().then(migrateHighwayFilterCheckbox);
      return load();
    })
    .catch(showError);
  bindHouseholdToggle('firstTimeBuyerToggle', 'first_time_buyer');
  HOUSEHOLD_NUMBER_SETTINGS.forEach(({ id, key }) => bindHouseholdNumberInput(id, key));
  $('addPoiBtn')?.addEventListener('click', () => addPoiPin().catch(err => console.error(err)));
  $('layerPoiPins')?.addEventListener('change', e => {
    if (!state.mapReady) return;
    state.map.setLayoutProperty('poi-pins-circles', 'visibility', e.target.checked ? 'visible' : 'none');
  });
  $('layerGoStations')?.addEventListener('change', e => {
    if (!state.mapReady) return;
    state.map.setLayoutProperty('go-stations-existing-circles', 'visibility', e.target.checked ? 'visible' : 'none');
  });
  $('layerGoStationsPlanned')?.addEventListener('change', e => {
    if (!state.mapReady) return;
    state.map.setLayoutProperty('go-stations-planned-circles', 'visibility', e.target.checked ? 'visible' : 'none');
  });
  $('layerGoLines')?.addEventListener('change', e => {
    if (!state.mapReady) return;
    state.map.setLayoutProperty('go-lines-layer', 'visibility', e.target.checked ? 'visible' : 'none');
  });
  $('layerHwy413')?.addEventListener('change', e => {
    if (!state.mapReady) return;
    state.map.setLayoutProperty('hwy413-line', 'visibility', e.target.checked ? 'visible' : 'none');
  });
  $('whoAmI').addEventListener('change', e => setActivePerson(Number(e.target.value) || null));
  $('load').addEventListener('click', () => load().catch(showError));
  $('reset').addEventListener('click', reset);
  $('filterStatus')?.addEventListener('change', applyFiltersAndRender);
  $('q')?.addEventListener('input', debounce(applyFiltersAndRender, 150));
  $('minPit')?.addEventListener('change', applyFiltersAndRender);
  $('maxPit')?.addEventListener('change', applyFiltersAndRender);
  $('minDue')?.addEventListener('change', applyFiltersAndRender);
  $('maxDue')?.addEventListener('change', applyFiltersAndRender);
  ['minSqft','maxSqft','minAcres','maxAcres','maxCommute','minHwyKm','maxHwyKm','minAttachDrive','maxAttachDrive'].forEach(id => $(id)?.addEventListener('change', applyFiltersAndRender));
  ['featGarage','featPool','featBasement','hideVetoed'].forEach(id => $(id)?.addEventListener('change', applyFiltersAndRender));
  $('source').addEventListener('change', () => { buildSettingsPanel(); load().catch(showError); });
  // Map clustering (Appearance): toggle switches the map between count bubbles
  // and individual pins immediately; granularity re-fetches at a new precision.
  const clusterCb = $('mapClusterToggle');
  if (clusterCb) {
    clusterCb.checked = mapClusteringOn();
    clusterCb.addEventListener('change', e => { setMapClustering(e.target.checked); refreshMap(state.listings); });
  }
  const granSel = $('mapClusterGranSelect');
  if (granSel) {
    granSel.value = mapClusterGranularity();
    granSel.addEventListener('change', e => { setMapClusterGranularity(e.target.value); if (clusteringActive()) refetchClustersForViewport(); });
  }
  $('clusterPopupClose')?.addEventListener('click', closeClusterPopup);
  $('sort')?.addEventListener('change', e => { syncSort(e.target.value); renderCards(state.listings); refreshMap(state.listings); });
  $('sortList')?.addEventListener('change', e => { syncSort(e.target.value); renderCards(state.listings); });
  $('btnMap').addEventListener('click', () => switchView('map'));
  $('btnList').addEventListener('click', () => switchView('list'));
  $('themeBtn').addEventListener('click', cycleTheme);
  $('settingsBtn').addEventListener('click', openSettings);
  $('settingsClose').addEventListener('click', closeSettings);
  $('settingsOverlay').addEventListener('click', closeSettings);
  $('settingsBack').addEventListener('click', showSettingsMain);
  document.querySelectorAll('.settings-nav-row').forEach(row => {
    row.addEventListener('click', () => showSettingsPage(row.dataset.target, row.dataset.title));
  });
  $('mapCardClose').addEventListener('click', closeMapCard);
  document.addEventListener('click', e => closeOutsidePanels(e.target));
  $('settingsSelectAll').addEventListener('click', () => { CARD_FIELDS.forEach(f => cardSettings[f.key] = true); saveSettings(); buildSettingsPanel(); applyCardVisibility(); });
  $('settingsSelectNone').addEventListener('click', () => { CARD_FIELDS.forEach(f => { if (f.key !== 'actions') cardSettings[f.key] = false; }); saveSettings(); buildSettingsPanel(); applyCardVisibility(); });
  $('settingsReset').addEventListener('click', () => { localStorage.removeItem(SETTINGS_KEY); cardSettings = loadSettings(); saveSettings(); buildSettingsPanel(); applyCardVisibility(); });
});
