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
// POC clustering is a separate control: whether POC price pills collapse into a
// fit-coloured count circle where they would overlap. Distinct from Sample Data
// (server) clustering above. Default ON (the long-standing behaviour); turning
// it off shows every POC pill individually, overlapping and all.
const POC_CLUSTER_KEY = 'hh_poc_clustering';
function pocClusteringOn() { return localStorage.getItem(POC_CLUSTER_KEY) !== 'off'; }
function setPocClustering(on) { localStorage.setItem(POC_CLUSTER_KEY, on ? 'on' : 'off'); }
// Basemap dimming for transit legibility: darken the basemap by N% (only while
// transit lines are shown) so coloured transit lines read clearly against it.
// Implemented as a dim fill layer under the transit overlays (see addMapLayers /
// updateBasemapDim). Persisted like other appearance settings. Default 10%.
const BASEMAP_DIM_KEY = 'hh_basemap_dim';
const BASEMAP_DIM_OPTIONS = [0, 5, 10, 15, 20, 25];
function basemapDimPct() { const v = parseInt(localStorage.getItem(BASEMAP_DIM_KEY), 10); return BASEMAP_DIM_OPTIONS.includes(v) ? v : 10; }
function setBasemapDimPct(v) { localStorage.setItem(BASEMAP_DIM_KEY, String(v)); }
function transitLinesOn() { return !!($('layerGoLines')?.checked || $('layerTtcLines')?.checked); }
function updateBasemapDim() {
  if (!state.mapReady || !state.map || !state.map.getLayer('basemap-dim-layer')) return;
  const pct = transitLinesOn() ? basemapDimPct() : 0;
  state.map.setPaintProperty('basemap-dim-layer', 'fill-opacity', pct / 100);
}
// Compass: rotate the needle to reflect the current bearing so it reads as a
// live compass; the button click (wired in the bootstrap) resets to north.
function updateCompass() {
  const btn = $('compassBtn');
  if (!btn || !state.map) return;
  const glyph = btn.querySelector('.ctrl-glyph');
  if (glyph) glyph.style.transform = `rotate(${-state.map.getBearing()}deg)`;
}
function clusterPrecisionForZoom() {
  const z = state.map ? state.map.getZoom() : 9;
  const offset = (CLUSTER_GRANULARITIES.find(o => o.value === mapClusterGranularity()) || {}).offset || 0;
  return Math.max(1, Math.min(29, Math.round(z) + offset));
}

// Compact-notation decimal places for map pills (1.1M / 1.05M / 1.049M), an
// appearance preference per device, stored beside the clustering settings.
// Applies only to compact figures (prices, cost to close); monthly figures are
// always exact dollars, so this does not touch them.
const COMPACT_DECIMALS_KEY = 'hh_pill_compact_decimals';
function pillCompactDecimals() {
  const n = parseInt(localStorage.getItem(COMPACT_DECIMALS_KEY) || '2', 10);
  return (n === 1 || n === 2 || n === 3) ? n : 2;
}
function setPillCompactDecimals(n) { localStorage.setItem(COMPACT_DECIMALS_KEY, String(n)); }

// ─── Basemap style (Streets / Satellite) ────────────────────────────────────────
// Mapbox serves both natively (no new vendor or key). Satellite mode uses the
// satellite-streets hybrid (imagery with roads + labels overlaid), not bare
// satellite, so orientation is preserved like Google's satellite view. Stored
// as an Appearance preference per device, like the clustering + decimal
// settings. Billing note (see DECISIONS.md): a map load is billed per Map
// object init regardless of style, and setStyle() at runtime mints no new load,
// so this costs nothing extra at our scale.
const MAP_STYLE_KEY = 'hh_map_style';
const MAP_STYLES = {
  streets: 'mapbox://styles/mapbox/streets-v12',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
};
function mapStyleChoice() {
  return localStorage.getItem(MAP_STYLE_KEY) === 'satellite' ? 'satellite' : 'streets';
}
function setMapStyleChoice(s) { localStorage.setItem(MAP_STYLE_KEY, s === 'satellite' ? 'satellite' : 'streets'); }

// ─── Map pill labels ────────────────────────────────────────────────────────────
// Strictly one formatting rule per metric type, never mixed on a view:
//   prices + cost to close -> compact ($1.05M, $875K, $247K), decimals per the
//     pillCompactDecimals() setting on the M unit; K is whole thousands; under
//     $1K is exact dollars.
//   monthly figures (PIT) -> exact dollars ($5,645); too small for compact
//     rounding to carry information.
function formatCompactMoney(value, decimals) {
  if (value == null || isNaN(value)) return '';
  const v = Number(value), abs = Math.abs(v);
  if (abs >= 1e6) return '$' + (v / 1e6).toFixed(decimals) + 'M';
  if (abs >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v).toLocaleString('en-US');
}
function formatExactMoney(value) {
  if (value == null || isNaN(value)) return '';
  return '$' + Math.round(Number(value)).toLocaleString('en-US');
}
// The money figure behind a pill: same metric the card headline uses
// (loadSummaryValueChoice), so pin and card can never disagree on the metric.
// Price prefers the potential purchase price when one is entered (matching the
// breakdown and the card's Estimate line everywhere else); Monthly PIT uses the
// Total monthly figure (PIT + condo fees) when the listing has condo fees,
// consistent with the card's Financial summary block.
function pillMetricValue(item) {
  const choice = loadSummaryValueChoice();
  if (choice === 'closing') return { metric: 'closing', value: effectiveDueNum(item) };
  if (choice === 'pit') {
    const pit = effectivePitNum(item);
    if (pit == null) return { metric: 'pit', value: null };
    const condoFee = item.isCondo && item.condoFeeNum ? item.condoFeeNum : 0;
    return { metric: 'pit', value: pit + condoFee };
  }
  const potential = item.potentialPurchasePrice;
  return { metric: 'price', value: potential != null ? potential.price : item.price };
}
function pillMoneyText(item) {
  const { metric, value } = pillMetricValue(item);
  if (value == null) return '';
  return metric === 'pit' ? formatExactMoney(value) : formatCompactMoney(value, pillCompactDecimals());
}
// The full pill label: the active person's rating (numeric + star) when they
// have rated this listing, then the money figure. No star when unrated.
function pillLabel(item) {
  const money = pillMoneyText(item);
  const fb = personFeedbackFor(item.mls, state.activePerson);
  const rating = fb && fb.rating != null ? fb.rating : null;
  return (rating != null ? rating + '★ ' : '') + money;
}
// Map palette: mirrored from the CSS :root map vars, which are the single
// source of truth for every colour in the app (see design-spec.md). Seeded with
// the same literals as a fallback for any call before loadMapColors() runs;
// loadMapColors() overwrites them from CSS at startup so :root stays canonical.
// Change a map colour in :root, never here.
const MAP_COLORS = {
  fitStrong: '#16803a', fitGood: '#e8b400', fitPossible: '#e8720c', fitRejected: '#8a94a6',
  poiSchool: '#2b67d6', poiHospital: '#b3261e', poiWork: '#8e44ad', poiWorship: '#e8b400', poiOther: '#68726f',
  hwy413: '#b3261e', goPlanned: '#e8b400', rejectedPin: '#aaaaaa',
  white: '#ffffff', labelInk: '#18211f', blue: '#2b67d6', dim: '#0b1622',
  drawExclude: '#d11a2a', // GAL-63: exclude zones drawn red
};
function loadMapColors() {
  try {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => (cs.getPropertyValue(n).trim() || d);
    MAP_COLORS.fitStrong = v('--fit-strong', MAP_COLORS.fitStrong);
    MAP_COLORS.fitGood = v('--fit-good', MAP_COLORS.fitGood);
    MAP_COLORS.fitPossible = v('--fit-possible', MAP_COLORS.fitPossible);
    MAP_COLORS.fitRejected = v('--fit-rejected', MAP_COLORS.fitRejected);
    MAP_COLORS.poiSchool = v('--poi-school', MAP_COLORS.poiSchool);
    MAP_COLORS.poiHospital = v('--poi-hospital', MAP_COLORS.poiHospital);
    MAP_COLORS.poiWork = v('--poi-work', MAP_COLORS.poiWork);
    MAP_COLORS.poiWorship = v('--poi-worship', MAP_COLORS.poiWorship);
    MAP_COLORS.poiOther = v('--poi-other', MAP_COLORS.poiOther);
    MAP_COLORS.hwy413 = v('--transit-hwy413', MAP_COLORS.hwy413);
    MAP_COLORS.goPlanned = v('--go-planned', MAP_COLORS.goPlanned);
    MAP_COLORS.rejectedPin = v('--pin-rejected', MAP_COLORS.rejectedPin);
    MAP_COLORS.white = v('--map-overlay-white', MAP_COLORS.white);
    MAP_COLORS.labelInk = v('--map-label-ink', MAP_COLORS.labelInk);
    MAP_COLORS.blue = v('--blue', MAP_COLORS.blue);
    MAP_COLORS.dim = v('--map-dim', MAP_COLORS.dim);
  } catch (_) { /* keep fallback literals */ }
}
// Fit palette shared by pills and cluster circles. Cluster circles take the
// highest fit among their contents (no fit information lost when pins collapse).
function fitRatioColor(ratio) {
  if (ratio >= 0.75) return MAP_COLORS.fitStrong;
  if (ratio >= 0.5) return MAP_COLORS.fitGood;
  return MAP_COLORS.fitPossible;
}
function clusterFitColor(items) {
  let best = -1;
  items.forEach(it => {
    const total = it.fit && it.fit.total ? it.fit.total : 8;
    const ratio = (it.fit && it.fit.met != null ? it.fit.met : 0) / total;
    if (ratio > best) best = ratio;
  });
  return best < 0 ? MAP_COLORS.fitRejected : fitRatioColor(best);
}
// Greedy screen-space collapse so pills never pile up: a listing joins an
// existing group when its projected pixel centre is within a pill's footprint
// of that group's anchor (PILL_COLLAPSE_W wide, _H tall). Groups of one render
// as a pill; groups of two or more collapse to a fit-coloured count circle that
// the existing chooser popup expands. Pure given `project`, so it is testable
// headless with a mock projection; on the map, project = map.project.
const PILL_COLLAPSE_W = 92; // px, an approximate pill width incl. padding
const PILL_COLLAPSE_H = 30; // px, an approximate pill height incl. margin
function collapsePillGroups(items, project, cellW, cellH) {
  const w = cellW || PILL_COLLAPSE_W, h = cellH || PILL_COLLAPSE_H;
  const groups = [];
  for (const it of items) {
    if (it.lat == null || it.lng == null) continue;
    const pt = project(it);
    if (!pt) continue;
    let g = null;
    for (const cand of groups) {
      if (Math.abs(cand.x - pt.x) < w && Math.abs(cand.y - pt.y) < h) { g = cand; break; }
    }
    if (g) { g.items.push(it); }
    else { groups.push({ x: pt.x, y: pt.y, items: [it] }); }
  }
  return groups;
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
  { key: 'discussion', group: 'opinions', label: 'Discussion', desc: 'Group comment thread with @mentions', defaultOn: true },
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
let REPORT_ENABLED = false;
const WHO_KEY = 'hh_who_am_i';
const authHeaders = () => ({ 'X-App-Token': APP_TOKEN });

async function loadConfig() {
  const res = await fetch('/api/config');
  const data = await res.json();
  APP_TOKEN = data.auth_token;
  MAPBOX_TOKEN = data.mapbox_token;
  REPORT_ENABLED = !!data.report_enabled;
}

// ─── State ────────────────────────────────────────────────────────────────────
const state = { map: null, mapReady: false, rawListings: [], listings: [], activeView: 'map', people: [], activePerson: null, feedback: {}, openMapItem: null, source: 'poc', sourceCount: 0, clusters: [], poi: [], householdSettings: {}, personThresholds: {}, personThresholdsError: false, placeAttachments: {}, clusterPopupOpen: false,
  drawMode: false, savedAreas: [], drawCurrent: [], pillListings: [], mapStyle: 'streets', drawerOn: false,
  gridSort: null, gridSelection: new Set(), lastBulk: null,
  // Buying-party column-permission model (loaded from /api/column-permissions).
  columnGroups: [], columnPermissions: {}, adminId: null, gridPrefs: {},
  // GAL-67: per-listing comment threads, the active person's inbox, unread count.
  comments: {}, inbox: [], unreadCount: 0 };
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

// ─── Mini-card field config (cluster popup + Both view) ─────────────────────────
// Which values a mini-card shows, chosen in Settings like the card sections.
// myRating and note are also the interactive controls (editable stars + inline
// note), so hiding them removes both the display and the control.
const MINICARD_SETTINGS_KEY = 'hh_minicard_fields_v1';
const MINICARD_FIELDS = [
  { key: 'thumb',    label: 'Thumbnail',            defaultOn: true },
  { key: 'price',    label: 'Price',                defaultOn: true },
  { key: 'address',  label: 'Address',              defaultOn: true },
  { key: 'stat',     label: 'Beds / baths / sqft',  defaultOn: true },
  { key: 'fit',      label: 'Fit score',            defaultOn: false },
  { key: 'chips',    label: 'Group sentiment',      defaultOn: true },
  { key: 'myRating', label: 'My rating (editable stars)', defaultOn: true },
  { key: 'note',     label: 'Add a note',           defaultOn: true },
];
function loadMiniCardSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(MINICARD_SETTINGS_KEY) || '{}');
    return Object.fromEntries(MINICARD_FIELDS.map(f => [f.key, f.key in saved ? saved[f.key] : f.defaultOn]));
  } catch { return Object.fromEntries(MINICARD_FIELDS.map(f => [f.key, f.defaultOn])); }
}
let miniCardSettings = loadMiniCardSettings();
function saveMiniCardSettings() { localStorage.setItem(MINICARD_SETTINGS_KEY, JSON.stringify(miniCardSettings)); }
function miniFieldVisible(key) { return miniCardSettings[key] !== false; }
// Re-render every surface that shows mini-cards, after a config change or a
// mini-card write, without refitting the map.
function refreshMiniCards() {
  renderCombined();
  if (state.clusterPopupOpen && state.pillListings) {
    // Rebuild the open chooser's cards in place from current state.
    const inner = $('clusterPopupInner');
    if (inner && inner.dataset.mlsList) {
      const ids = inner.dataset.mlsList.split(',');
      const items = ids.map(id => findListing(id) || state.rawListings.find(x => x.mls === id)).filter(Boolean);
      inner.innerHTML = '';
      items.forEach(it => inner.appendChild(buildMiniCard(it)));
    }
  }
}

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
// Mini-card field toggles, same shape as the card-sections panel.
function buildMiniCardSettings() {
  const container = $('miniCardFields');
  if (!container) return;
  container.innerHTML = '';
  MINICARD_FIELDS.forEach(f => {
    const label = document.createElement('label');
    label.className = 'settings-row';
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: miniCardSettings[f.key] !== false });
    cb.dataset.key = f.key;
    cb.addEventListener('change', () => { miniCardSettings[f.key] = cb.checked; saveMiniCardSettings(); refreshMiniCards(); });
    const text = document.createElement('div');
    text.innerHTML = `<div>${esc(f.label)}</div>`;
    label.append(cb, text);
    container.appendChild(label);
  });
}
function openSettings() { buildSettingsPanel(); buildThresholdSettings(); buildColumnAccessSettings(); buildMiniCardSettings(); showSettingsMain(); $('settingsDrawer').hidden = false; $('settingsOverlay').hidden = false; }
function closeSettings() { $('settingsDrawer').hidden = true; $('settingsOverlay').hidden = true; }

// ─── Admin: per-member column-group permissions + admin transfer ───────────────
// The nav row and page are shown only when the active person is the admin. The
// admin's own Financial cell is disabled (they cannot deny themselves). Every
// change posts to the server, which is the source of truth and re-attributes it.
function buildColumnAccessSettings() {
  const isAdmin = state.activePerson != null && state.adminId === state.activePerson;
  const nav = $('navColumnAccess');
  if (nav) nav.hidden = !isAdmin;
  if (!isAdmin) return;
  const matrix = $('columnAccessMatrix');
  if (!matrix) return;
  const groups = columnGroupsList();
  const members = state.people.filter(p => p.role === 'buyer');
  let html = '<div class="col-access-scroll"><table class="col-access-table"><thead><tr><th>Member</th>';
  groups.forEach(g => { html += `<th>${esc(g.label)}</th>`; });
  // GAL-19: veto-power column, used by the "hide if a veto member said no"
  // group-consensus filter.
  html += '<th title="Whether this buyer\'s No hides a listing under the veto-member consensus filter">Veto</th>';
  html += '</tr></thead><tbody>';
  members.forEach(m => {
    const perms = state.columnPermissions[m.id] || {};
    const adminTag = m.id === state.adminId ? ' <span class="col-access-admin">admin</span>' : '';
    html += `<tr><td class="col-access-name">${esc(m.name)}${adminTag}</td>`;
    groups.forEach(g => {
      const permitted = perms[g.key] !== false;
      const selfProtected = m.id === state.activePerson && g.key === 'financial';
      const dis = selfProtected ? ' disabled title="You cannot remove your own Financial access"' : '';
      html += `<td><input type="checkbox" class="col-access-cb" data-person="${m.id}" data-group="${esc(g.key)}" ${permitted ? 'checked' : ''}${dis} /></td>`;
    });
    html += `<td><input type="checkbox" class="veto-cb" data-person="${m.id}" ${m.has_veto_power ? 'checked' : ''} /></td>`;
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  matrix.innerHTML = html;
  matrix.querySelectorAll('.col-access-cb').forEach(cb => cb.addEventListener('change', onColumnAccessToggle));
  matrix.querySelectorAll('.veto-cb').forEach(cb => cb.addEventListener('change', onVetoToggle));

  const others = members.filter(m => m.id !== state.adminId);
  const tr = $('columnAccessTransfer');
  if (tr) {
    tr.innerHTML = `
      <div class="settings-group-heading">Transfer admin</div>
      <p class="field-desc">Hand the admin role to another member. Only the admin can do this, and there is always exactly one.</p>
      <div class="col-access-transfer-row">
        <select id="transferAdminSel">${others.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
        <button id="transferAdminBtn" class="secondary"${others.length ? '' : ' disabled'}>Transfer</button>
      </div>`;
    $('transferAdminBtn')?.addEventListener('click', onTransferAdmin);
  }
}
async function onColumnAccessToggle(e) {
  const cb = e.target;
  const personId = Number(cb.dataset.person);
  const groupKey = cb.dataset.group;
  const permitted = cb.checked;
  try {
    const res = await fetch('/api/column-permissions', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor_id: state.activePerson, person_id: personId, group_key: groupKey, permitted }),
    });
    const data = await res.json();
    if (!res.ok) { cb.checked = !permitted; alert(data.detail || 'Could not change permission.'); return; }
    state.columnPermissions = data.permissions || state.columnPermissions;
    // If the change affected the active person's own view, reload so the grid
    // payload matches the new permission immediately.
    if (personId === state.activePerson) await reloadListingsPreservingMapView();
    else renderGrid();
  } catch (err) {
    cb.checked = !permitted;
    alert('Could not change permission: ' + err.message);
  }
}
// GAL-19: admin toggles a buyer's veto power. Updates state.people so the
// "hide if a veto member said no" consensus filter reflects it immediately.
async function onVetoToggle(e) {
  const cb = e.target;
  const personId = Number(cb.dataset.person);
  const hasVeto = cb.checked;
  try {
    const res = await fetch('/api/veto-power', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor_id: state.activePerson, person_id: personId, has_veto_power: hasVeto }),
    });
    const data = await res.json();
    if (!res.ok) { cb.checked = !hasVeto; alert(data.detail || 'Could not change veto power.'); return; }
    const p = state.people.find(x => x.id === personId);
    if (p) p.has_veto_power = hasVeto ? 1 : 0;
    applyFiltersAndRender();
  } catch (err) {
    cb.checked = !hasVeto;
    alert('Could not change veto power: ' + err.message);
  }
}
async function onTransferAdmin() {
  const sel = $('transferAdminSel');
  const newId = sel ? Number(sel.value) : 0;
  if (!newId) return;
  const name = state.people.find(p => p.id === newId)?.name || 'that member';
  if (!confirm(`Transfer the admin role to ${name}? You will no longer be the admin.`)) return;
  try {
    const res = await fetch('/api/transfer-admin', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor_id: state.activePerson, new_admin_id: newId }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.detail || 'Transfer failed.'); return; }
    state.adminId = data.admin_id;
    buildColumnAccessSettings();  // hides the admin page for the now-former admin
    showSettingsMain();
  } catch (err) { alert('Transfer failed: ' + err.message); }
}

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
  // Permitted columns and the grid payload are per person: reload listings +
  // feedback so a denied group's data is absent for the newly selected actor,
  // then re-render. reloadListingsPreservingMapView keeps the current map view.
  reloadListingsPreservingMapView().catch(showError);
  if (state.openMapItem) showMapCard(state.openMapItem);
  refreshInbox();  // GAL-67: the inbox and unread badge are per person
}

function updateLegendHint() {
  const hint = $('legendHint');
  if (hint) hint.hidden = !!state.activePerson;
}

// ─── Buying-party column permissions (admin grants + personal picks) ────────────
// A fallback mirror of the server's five groups, so the grid still groups
// columns sensibly if /api/column-permissions ever fails to load. The server
// payload (state.columnGroups) is authoritative when present.
const DEFAULT_COLUMN_GROUPS = [
  { key: 'identity', label: 'Identity', columns: ['address'] },
  { key: 'facts', label: 'Property facts', columns: ['beds', 'baths', 'sqft', 'fit'] },
  { key: 'opinions', label: 'Opinions', columns: ['myRating', 'group', 'note'] },
  { key: 'financial', label: 'Financial', columns: ['listPrice', 'potentialPrice', 'pit', 'close', 'condoFees'] },
  { key: 'location', label: 'Location', columns: ['highway', 'highwayName', 'commute', 'goStation', 'goDrive', 'goTrain'] },
];
// Export column-key -> group, mirroring the server's EXPORT_KEY_GROUP so the
// export picker shows only permitted columns for the "everything" scope too.
const EXPORT_KEY_GROUP = {
  mls: 'identity', address: 'identity',
  beds: 'facts', baths: 'facts', sqft: 'facts', acres: 'facts', fit: 'facts', fitMet: 'facts', fitTotal: 'facts',
  myRating: 'opinions', group: 'opinions', note: 'opinions',
  price: 'financial', listPrice: 'financial', potentialPrice: 'financial', effectivePrice: 'financial',
  pit: 'financial', monthlyPit: 'financial', close: 'financial', costToClose: 'financial', condoFees: 'financial',
  downPayment: 'financial', cmhc: 'financial', ontarioLtt: 'financial', torontoLtt: 'financial',
  monthlyPI: 'financial', monthlyTax: 'financial',
  highway: 'location', highwayName: 'location', commute: 'location', highwayKm: 'location', nearestHighway: 'location',
  lat: 'location', lng: 'location', goStation: 'location', goDrive: 'location', goMin: 'location', goTrain: 'location', goTotal: 'location',
};

async function loadColumnPermissions() {
  try {
    const res = await fetch('/api/column-permissions', { headers: authHeaders() });
    if (!res.ok) throw new Error('failed to load column permissions');
    const data = await res.json();
    state.columnGroups = data.groups || [];
    state.columnPermissions = data.permissions || {};
    state.adminId = data.admin_id || null;
    state.gridPrefs = data.grid_prefs || {};
  } catch (err) {
    console.error(err);
    state.columnGroups = []; state.columnPermissions = {}; state.adminId = null; state.gridPrefs = {};
  }
}

function columnGroupsList() { return state.columnGroups.length ? state.columnGroups : DEFAULT_COLUMN_GROUPS; }
function groupKeyForColumn(colKey) {
  const g = columnGroupsList().find(g => (g.columns || []).includes(colKey));
  return g ? g.key : null;
}
// The set of group keys this person may see. No stored record for a person =
// all permitted (default-allow today), matching the server's permitted_groups.
function permittedGroupSet(personId) {
  const all = columnGroupsList().map(g => g.key);
  const perms = personId != null ? state.columnPermissions[personId] : null;
  if (!perms) return new Set(all);
  return new Set(all.filter(k => perms[k] !== false));
}
// A person's hidden grid columns. Once they have saved any picks, that explicit
// list is authoritative (empty list = show everything permitted). With no saved
// picks yet, fall back to the columns marked defaultHidden, so the default grid
// stays lean while every card field is still one click away in the picker.
function hiddenColumnsFor(personId) {
  const gp = personId != null ? state.gridPrefs[personId] : null;
  if (gp && Array.isArray(gp.hidden_columns)) return new Set(gp.hidden_columns);
  return new Set(gridColumns().filter(c => c.defaultHidden).map(c => c.key));
}
// gridColumns() the active person is permitted to see (group-permitted), before
// applying their personal show/hide picks. A column whose group is unknown
// (outside the model) is always permitted.
function permittedGridColumns() {
  const permitted = permittedGroupSet(state.activePerson);
  return gridColumns().filter(c => {
    const gk = groupKeyForColumn(c.key);
    return gk == null || permitted.has(gk);
  });
}
// What the grid actually renders: permitted columns minus the person's own hides.
function visibleGridColumns() {
  const hidden = hiddenColumnsFor(state.activePerson);
  return permittedGridColumns().filter(c => !hidden.has(c.key));
}
function exportColumnPermitted(key) {
  const gk = EXPORT_KEY_GROUP[key] || (/^p\d+_(rating|status)$/.test(key) ? 'opinions' : null);
  if (!gk) return true;
  return permittedGroupSet(state.activePerson).has(gk);
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
  // Only add a native title when it says more than the visible label. For
  // chips whose title equals the label (e.g. "Said no"), the title is pure
  // redundancy and just an extra native tooltip to linger, so omit it.
  const titleAttr = o.title && o.title !== o.label ? ` title="${esc(o.title)}"` : '';
  return `
    <label class="chip"${titleAttr}>
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

// ─── Saved draw areas (named, shared, toggleable) ───────────────────────────────
// Search zones are household concepts, so a drawn polygon is saved server-side
// (shared like POI pins, with who-created attribution), not session-only. Each
// saved area has its own on/off toggle in the Layers menu: on means visible on
// the map AND active as a filter, off means neither. The on/off state is a view
// preference, so it lives in localStorage per device (like the other layer
// toggles); the area itself is shared. Active areas filter BOTH sources with OR
// semantics between them, AND with the filter panel: Sample Data via the
// Repliers `map` param (filterParams), POC via the client-side point-in-polygon.
const ACTIVE_AREAS_KEY = 'hh_active_area_ids';
function loadActiveAreaIds() {
  try {
    const v = JSON.parse(localStorage.getItem(ACTIVE_AREAS_KEY) || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'number') : [];
  } catch (_) { return []; }
}
function saveActiveAreaIds(ids) { localStorage.setItem(ACTIVE_AREAS_KEY, JSON.stringify(ids)); }
function isAreaActive(id) { return loadActiveAreaIds().includes(id); }
function setAreaActive(id, on) {
  const ids = loadActiveAreaIds().filter(x => x !== id);
  if (on) ids.push(id);
  saveActiveAreaIds(ids);
}
// Every currently-active saved area (include or exclude).
function activeAreas() {
  return state.savedAreas.filter(a => isAreaActive(a.id));
}
// GAL-63: an area is an exclude zone iff its kind is 'exclude'.
function isExcludeArea(a) { return a && a.kind === 'exclude'; }
// Active include-zone rings (scope the result set). Kept named activeAreaPolygons
// for the callers that only ever meant the include set.
function activeAreaPolygons() {
  return activeAreas().filter(a => !isExcludeArea(a)).map(a => a.polygon);
}
// Active exclude-zone rings (subtract from the result set).
function activeExcludePolygons() {
  return activeAreas().filter(a => isExcludeArea(a)).map(a => a.polygon);
}
// Fit the map to a saved area's polygon boundary itself (not to the listings
// inside it). Turning an area on in the Layers panel jumps here so you see the
// whole zone you drew, even the empty parts, rather than snapping to whatever
// single property happens to sit inside.
function fitMapToArea(area) {
  if (!state.map || !state.mapReady || !area || !Array.isArray(area.polygon)) return;
  const pts = area.polygon.filter(p => Array.isArray(p) && p.length >= 2).map(p => [p[0], p[1]]);
  const b = lngLatBoundsOf(pts);
  if (b) state.map.fitBounds(b, { padding: 40, maxZoom: 15 });
}
function drawnPolygonsParam() {
  const polys = activeAreaPolygons();
  return polys.length ? JSON.stringify(polys) : null;
}
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
// GAL-63: a listing passes the draw filter when it is inside at least one
// include zone (or there are none) AND inside no exclude zone. Use case: draw
// Toronto (include), then a few neighbourhoods as exclude (red) to subtract.
function matchesDrawArea(item) {
  const inc = activeAreaPolygons();
  const exc = activeExcludePolygons();
  if (!inc.length && !exc.length) return true;
  if (item.lng == null || item.lat == null) return inc.length ? false : true;
  const inInclude = inc.length ? inc.some(ring => pointInRing(item.lng, item.lat, ring)) : true;
  if (!inInclude) return false;
  const inExclude = exc.some(ring => pointInRing(item.lng, item.lat, ring));
  return !inExclude;
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

// Keyword-in-features checkboxes: text match only, not a confirmed feature. The
// keyword list is household-defined (feature_keywords in household_settings),
// seeded with garage/pool/basement; each check is a plain substring match, same
// as before, only the list is now the family's own (see buildFeatureKeywordChips).
const DEFAULT_FEATURE_KEYWORDS = ['garage', 'pool', 'basement'];
function featureKeywords() {
  const raw = state.householdSettings.feature_keywords;
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter(k => typeof k === 'string' && k.trim());
    } catch (_) {}
  }
  return DEFAULT_FEATURE_KEYWORDS.slice(); // unset -> seeded defaults, nothing lost
}
function currentCheckedKeywords() {
  return Array.from(document.querySelectorAll('#featureKeywordRow input.feat-kw:checked')).map(cb => cb.dataset.kw);
}
function matchesFeatureKeywords(item) {
  const checked = currentCheckedKeywords();
  if (!checked.length) return true;
  const text = (item.features || '').toLowerCase();
  return checked.every(kw => text.includes(kw.toLowerCase()));
}

// GAL-75: property-type filter. POC listings carry a placeholder type, so it is
// excluded and the control hides for POC; Sample Data (and a real Canadian feed)
// carry a genuine propertyType that drives the chips.
const POC_PLACEHOLDER_PROPTYPE = 'House Hunter POC';
function propTypeOf(item) {
  const t = (item.propertyType || '').trim();
  return (!t || t === POC_PLACEHOLDER_PROPTYPE) ? '' : t;
}
function currentCheckedPropTypes() {
  return Array.from(document.querySelectorAll('#propTypeRow input.prop-type:checked')).map(cb => cb.dataset.pt);
}
function matchesPropertyType(item) {
  const checked = currentCheckedPropTypes();
  if (!checked.length) return true;
  return checked.includes(propTypeOf(item));
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

// GAL-19: group-consensus filter. Only buyers count (realtors/advisors never
// contribute to consensus). "likes it" = a rating of 4 or more; an unrated
// buyer is treated as not-yet-consensus (blocks "everyone likes it"). Veto
// power is the admin-assigned has_veto_power flag.
const CONSENSUS_LIKE_MIN = 4;
function matchesConsensus(item) {
  const mode = $('consensusFilter')?.value || '';
  if (!mode) return true;
  const buyers = state.people.filter(p => p.role === 'buyer');
  if (!buyers.length) return mode !== 'everyone_likes'; // no buyers = no consensus to meet
  const fb = new Map((state.feedback[item.mls] || []).map(f => [f.person_id, f]));
  const likes = p => { const f = fb.get(p.id); return f && f.rating != null && f.rating >= CONSENSUS_LIKE_MIN; };
  const saidNo = p => fb.get(p.id)?.status === 'rejected';
  if (mode === 'everyone_likes') return buyers.every(likes);
  if (mode === 'hide_anyone_no') return !buyers.some(saidNo);
  if (mode === 'hide_veto_no') return !buyers.some(p => p.has_veto_power && saidNo(p));
  return true;
}

function filterByFeedback(listings) {
  const statusVal = $('filterStatus')?.value || '';
  const keyword = ($('q')?.value || '').trim().toLowerCase();
  const personFilters = state.people.map(p => ({ id: p.id, values: checkedValuesFor(p.id) }));
  const openMls = state.openMapItem?.mls;
  return listings.filter(item => {
    // GAL-48: keep the currently-open property card visible even when the
    // rating just entered in it would filter it out (e.g. the "No rating yet"
    // person filter), so the user can still add a note after rating. It drops
    // out when the card is closed (closeMapCard re-runs the filters).
    if (openMls && item.mls === openMls) return true;
    if (!matchesStatusFilter(item.mls, statusVal)) return false;
    if (!matchesConsensus(item)) return false;
    if (!matchesKeyword(item, keyword)) return false;
    if (!matchesRange(effectivePitNum(item), 'minPit', 'maxPit')) return false;
    if (!matchesRange(effectiveDueNum(item), 'minDue', 'maxDue')) return false;
    if (!matchesRangeDirect(item.sqft, 'minSqft', 'maxSqft')) return false;
    if (!matchesRangeDirect(item.acres, 'minAcres', 'maxAcres')) return false;
    if (!matchesRangeDirect(item.goMin, '', 'maxCommute')) return false;
    if (!matchesRangeDirect(item.highwayKm, 'minHwyKm', 'maxHwyKm')) return false;
    if (!matchesAttachDriveFilter(item)) return false;
    if (!matchesDrawArea(item)) return false;
    if (!matchesFeatureKeywords(item)) return false;
    if (!matchesPropertyType(item)) return false;
    return personFilters.every(pf => matchesPersonFilter(item.mls, pf.id, pf.values));
  });
}

function applyFiltersAndRender() {
  buildPropTypeChips(); // GAL-75: keep the type chips in step with the loaded data
  state.listings = filterByFeedback(state.rawListings);
  refreshMap(state.listings);
  renderCards(state.listings);
  renderCombined();
  renderGrid();
  updateFilterBadge();
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
    // person_id lets the server enforce the Opinions group (empty feedback when
    // the active actor is denied it), since ratings/sentiment are not in the
    // listings payload.
    const who = state.activePerson ? '&person_id=' + state.activePerson : '';
    const res = await fetch('/api/feedback?listing_ids=' + encodeURIComponent(ids.join(',')) + who, { headers: authHeaders() });
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

async function fetchComments(listingIds) {
  const ids = [...new Set(listingIds.filter(Boolean))];
  if (!ids.length) return {};
  try {
    const res = await fetch('/api/comments?listing_ids=' + encodeURIComponent(ids.join(',')), { headers: authHeaders() });
    if (!res.ok) return {};
    const data = await res.json();
    return data.comments || {};
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
  state.comments = await fetchComments(listingIds);
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
  // Text + numeric inputmode (not type=number) so thousands separators can show
  // during entry (GAL-60); wirePriceInput keeps dataset.raw as the digit value.
  input.type = 'text';
  input.inputMode = 'numeric';
  input.placeholder = 'Potential purchase price';
  wirePriceInput(input);
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  const statusEl = document.createElement('div');
  statusEl.className = 'feedback-status';

  saveBtn.addEventListener('click', async () => {
    if (!state.activePerson) { showFeedbackStatus(statusEl, 'Select who you are first.', true); return; }
    const price = Number(input.dataset.raw || input.value.replace(/[^\d]/g, ''));
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
    if (box.hidden) {
      input.value = entry ? formatThousands(String(entry.price)) : '';
      input.dataset.raw = entry ? String(entry.price) : '';
      box.hidden = false;
    } else { box.hidden = true; }
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
    // T16: re-run the active filters so a rating/reject that now falls outside
    // an active person-rating or status filter drops the listing from list and
    // map. Capture the open card BEFORE re-rendering: refreshMap (inside
    // applyFiltersAndRender) closes the map card and clears state.openMapItem,
    // so checking it afterward always failed and the card closed on rating
    // (GAL-48). filterByFeedback pins the open item so it stays in the list;
    // reopen it so the card stays up for a follow-up note.
    const wasOpen = state.openMapItem === item;
    applyFiltersAndRender();
    if (wasOpen) {
      if (state.listings.some(l => l.mls === item.mls)) showMapCard(item);
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

// ─── View toggle (Map / Combined / List), persisted per device ──────────────────
const VIEW_KEY = 'hh_view';
function isNarrowViewport() { return window.matchMedia('(max-width:699px)').matches; }
let _wasNarrowViewport = isNarrowViewport(); // tracks breakpoint crossings for resize
function loadView() {
  const v = localStorage.getItem(VIEW_KEY);
  const view = (v === 'list' || v === 'combined' || v === 'grid') ? v : 'map';
  // Combined ("Both") and Grid are desktop-only. On a phone: Both -> Map (the
  // drawer is the combined experience there); Grid -> List (its row-per-listing
  // equivalent).
  if (isNarrowViewport()) {
    if (view === 'combined') return 'map';
    if (view === 'grid') return 'list';
  }
  return view;
}
function switchView(view) {
  state.activeView = view;
  localStorage.setItem(VIEW_KEY, view);
  const mapShown = view === 'map' || view === 'combined';
  // The cards drawer/column shows for desktop "Both" AND for mobile "Map": on a
  // phone, Map with the drawer IS the combined experience (there is no Both).
  const drawerOn = view === 'combined' || (view === 'map' && isNarrowViewport());
  state.drawerOn = drawerOn;
  $('viewMap').hidden = !mapShown;
  $('viewList').hidden = view !== 'list';
  $('combinedPanel').hidden = !drawerOn;
  $('viewGrid').hidden = view !== 'grid';
  document.body.classList.toggle('combined', drawerOn);
  document.body.classList.toggle('grid', view === 'grid');
  $('btnMap').classList.toggle('active', view === 'map');
  $('btnCombined')?.classList.toggle('active', view === 'combined');
  $('btnList').classList.toggle('active', view === 'list');
  $('btnGrid')?.classList.toggle('active', view === 'grid');
  if (drawerOn) renderCombined();
  if (view === 'grid') renderGrid();
  // The map's container width changes entering/leaving the desktop column, so
  // let Mapbox recompute the canvas size after layout settles.
  if (mapShown) requestAnimationFrame(() => state.map?.resize());
}

// ─── Listing discussion + inbox (GAL-67) ────────────────────────────────────
function fmtCommentTime(ts) { return (ts || '').slice(0, 16).replace('T', ' '); }

// Names longest-first so "@Mary Ann" highlights over "@Mary".
function mentionRoster() {
  return state.people.map(p => p.name).filter(Boolean).sort((a, b) => b.length - a.length);
}
function highlightMentions(body) {
  const html = esc(body);              // escape first; names are letters/spaces so esc leaves tokens intact
  const names = mentionRoster();
  if (!names.length) return html;
  const pattern = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp('@(' + pattern + ')(?![A-Za-z0-9])', 'gi');
  const meName = (state.people.find(p => p.id === state.activePerson) || {}).name;
  return html.replace(re, (_m, name) => {
    const me = meName && name.toLowerCase() === meName.toLowerCase();
    return '<span class="mention' + (me ? ' mention-me' : '') + '">@' + esc(name) + '</span>';
  });
}

function buildDiscussion(node, item) {
  const container = node.querySelector('.card-discussion');
  if (!container) return;
  container.innerHTML = '';
  container.append(el('div', { className: 'attach-heading', textContent: 'Discussion' }));

  const thread = el('div', { className: 'comment-thread' });
  const list = state.comments[item.mls] || [];
  if (!list.length) {
    thread.append(el('div', { className: 'comment-empty', textContent: 'No comments yet.' }));
  } else {
    list.forEach(c => {
      const bodyEl = el('div', { className: 'comment-body' });
      bodyEl.innerHTML = highlightMentions(c.body);
      thread.append(el('div', { className: 'comment-row' },
        el('div', { className: 'comment-head' },
          el('span', { className: 'comment-author', textContent: c.person_name }),
          el('span', { className: 'comment-time', textContent: fmtCommentTime(c.created_at) })),
        bodyEl));
    });
  }
  container.append(thread);

  if (!state.activePerson) {
    container.append(el('div', { className: 'feedback-prompt', textContent: 'Select who you are (top right) to comment.' }));
    return;
  }

  // Composer. NOT class feedback-compose: the global Enter delegate submits the
  // first button in a .feedback-compose, which would fire mid-typeahead.
  const composer = el('div', { className: 'comment-compose' });
  const ta = el('textarea', { className: 'comment-input', rows: 2, placeholder: 'Comment... use @ to mention' });
  const menu = el('div', { className: 'mention-menu' }); menu.hidden = true;
  const statusEl = el('div', { className: 'feedback-status' });
  const postBtn = el('button', { type: 'button', textContent: 'Post' });

  let menuItems = [], menuIdx = -1;
  const closeMenu = () => { menu.hidden = true; menu.innerHTML = ''; menuItems = []; menuIdx = -1; };
  const activeToken = () => {
    const upto = ta.value.slice(0, ta.selectionStart);
    const at = upto.lastIndexOf('@');
    if (at < 0) return null;
    if (at > 0 && !/\s/.test(upto[at - 1])) return null;
    const frag = upto.slice(at + 1);
    if (/\n/.test(frag)) return null;
    return { at, frag };
  };
  const updateMenuActive = () => { [...menu.children].forEach((c, i) => c.classList.toggle('active', i === menuIdx)); };
  const pickMention = (p) => {
    const tok = activeToken(); if (!tok) return;
    const before = ta.value.slice(0, tok.at);
    const after = ta.value.slice(ta.selectionStart);
    const insert = '@' + p.name + ' ';
    ta.value = before + insert + after;
    const caret = (before + insert).length;
    ta.focus(); ta.setSelectionRange(caret, caret);
    closeMenu();
  };
  const renderMenu = () => {
    const tok = activeToken();
    if (!tok) return closeMenu();
    const q = tok.frag.toLowerCase();
    const matches = state.people.filter(p => (p.name || '').toLowerCase().startsWith(q)).slice(0, 6);
    if (!matches.length) return closeMenu();
    menuItems = matches; menuIdx = 0;
    menu.innerHTML = '';
    matches.forEach((p, i) => {
      const b = el('button', { type: 'button', className: 'mention-item' + (i === 0 ? ' active' : ''), textContent: p.name });
      b.addEventListener('mousedown', (e) => { e.preventDefault(); pickMention(p); });
      menu.append(b);
    });
    menu.hidden = false;
  };
  ta.addEventListener('input', renderMenu);
  ta.addEventListener('keydown', (e) => {
    if (!menu.hidden && menuItems.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); menuIdx = (menuIdx + 1) % menuItems.length; updateMenuActive(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); menuIdx = (menuIdx - 1 + menuItems.length) % menuItems.length; updateMenuActive(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); pickMention(menuItems[menuIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); postComment(item, ta, statusEl, postBtn); }
  });
  postBtn.addEventListener('click', () => postComment(item, ta, statusEl, postBtn));

  composer.append(ta, menu, postBtn, statusEl);
  container.append(composer);
}

async function postComment(item, ta, statusEl, postBtn) {
  const body = (ta.value || '').trim();
  if (!body) { showFeedbackStatus(statusEl, 'Type a comment first.', true); return; }
  postBtn.disabled = true;
  showFeedbackStatus(statusEl, 'Posting...', false);
  try {
    const res = await fetch('/api/comments', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_id: state.activePerson, listing_id: item.mls, body, listing_address: item.address }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || 'Post failed');
    Object.assign(state.comments, await fetchComments([item.mls]));
    if (state.openMapItem && state.openMapItem.mls === item.mls) showMapCard(item);
    else renderCards(state.listings);
    refreshInbox();
  } catch (e) {
    postBtn.disabled = false;
    showFeedbackStatus(statusEl, e.message, true);
  }
}

async function refreshInbox() {
  if (!state.activePerson) { state.inbox = []; state.unreadCount = 0; updateInboxBadge(); return; }
  try {
    const res = await fetch('/api/inbox?person_id=' + state.activePerson, { headers: authHeaders() });
    if (res.ok) { const d = await res.json(); state.inbox = d.inbox || []; state.unreadCount = d.unread_count || 0; }
  } catch (e) { console.error(e); }
  updateInboxBadge();
}
function updateInboxBadge() {
  const b = $('inboxBadge'); if (!b) return;
  const n = state.unreadCount || 0;
  if (n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.hidden = false; } else { b.hidden = true; }
}
function openInbox() { refreshInbox().then(renderInbox); $('inboxOverlay').hidden = false; $('inboxDrawer').hidden = false; }
function closeInbox() { $('inboxOverlay').hidden = true; $('inboxDrawer').hidden = true; }
function renderInbox() {
  const list = $('inboxList'); if (!list) return;
  list.innerHTML = '';
  if (!state.activePerson) { list.append(el('div', { className: 'inbox-empty', textContent: 'Select who you are (top right) to see your inbox.' })); return; }
  if (!state.inbox.length) { list.append(el('div', { className: 'inbox-empty', textContent: "You're all caught up." })); return; }
  state.inbox.forEach(row => {
    const where = row.listing_address || row.listing_id;
    // Main tap area: opens the property and marks the item read (it stays in
    // the inbox, dimmed, until archived, GAL-67 rework).
    const main = el('button', { type: 'button', className: 'inbox-main' },
      el('div', { className: 'inbox-line' },
        el('strong', { textContent: row.author_name }),
        el('span', { textContent: ' on ' + where + ': ' }),
        el('span', { className: 'inbox-snippet', textContent: (row.body || '').slice(0, 80) })),
      el('div', { className: 'inbox-meta' },
        el('span', { className: 'inbox-time', textContent: fmtCommentTime(row.created_at) }),
        ...(row.mentioned ? [el('span', { className: 'inbox-tag', textContent: '@ you' })] : [])));
    main.addEventListener('click', () => openInboxItem(row));
    const archiveBtn = el('button', { type: 'button', className: 'inbox-archive', title: 'Archive', textContent: '🗑' });
    archiveBtn.addEventListener('click', (e) => { e.stopPropagation(); archiveInboxItem(row); });
    list.append(el('div', { className: 'inbox-row ' + (row.read ? 'read' : 'unread') }, main, archiveBtn));
  });
}
async function archiveInboxItem(row) {
  try {
    const res = await fetch('/api/comments/archive', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_id: state.activePerson, comment_id: row.id }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      state.inbox = state.inbox.filter(r => r.id !== row.id);
      if (typeof d.unread_count === 'number') state.unreadCount = d.unread_count;
      updateInboxBadge();
      renderInbox();
    }
  } catch (e) { console.error(e); }
}
async function openInboxItem(row) {
  try {
    const res = await fetch('/api/comments/read', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_id: state.activePerson, listing_id: row.listing_id }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && typeof d.unread_count === 'number') { state.unreadCount = d.unread_count; updateInboxBadge(); }
  } catch (e) { console.error(e); }
  closeInbox();
  const item = findListing(row.listing_id) || state.rawListings.find(x => x.mls === row.listing_id);
  if (item) { switchView('map'); showMapCard(item); }
  else { alert('That property is not in the current view. Clear filters, or switch data source, to open it.'); }
}
function wireInbox() {
  $('inboxBtn')?.addEventListener('click', openInbox);
  $('inboxClose')?.addEventListener('click', closeInbox);
  $('inboxOverlay')?.addEventListener('click', closeInbox);
}

// ─── Map (Mapbox GL JS) ────────────────────────────────────────────────────────
const MAP_LAYER_IDS = ['listings-circles', 'clusters-circles', 'clusters-labels', 'go-stations-existing-circles', 'go-stations-planned-circles', 'go-lines-layer', 'hwy413-line', 'poi-pins-circles', 'poi-pins-icons'];

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
    style: MAP_STYLES[mapStyleChoice()], // persisted Streets/Satellite choice
    center: [-79.5, 44.0],
    zoom: 9,
  });
  state.mapStyle = mapStyleChoice(); // tracks the loaded basemap for applyMapStyle
  // No NavigationControl: the map is full-screen with the app's own chrome
  // (topbar, filters, status bar) floating over it, and a top-right zoom stack
  // renders under the person selector and reads as a clipped white fragment on
  // mobile. Pinch / double-tap (touch) and scroll / double-click (desktop) zoom
  // remain, which is the norm for a mobile-first map.

  state.map.on('load', () => {
    addMapLayers();
    wireMapHandlers(); // event handlers register ONCE (survive setStyle)
    refreshPoiLayer();
    state.mapReady = true;
    updateMapStyleUI();
    state.map.on('rotate', updateCompass); // keep the compass needle in step with the bearing
    updateCompass();
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

  window.addEventListener('resize', () => {
    state.map?.resize();
    // Only react when the mobile/desktop breakpoint actually flips (mobile
    // URL-bar show/hide fires resize constantly, which must not rebuild the
    // drawer). Crossing into phone width drops Both -> Map; either crossing
    // re-derives the drawer (mobile Map has it, desktop Map does not).
    const narrow = isNarrowViewport();
    if (narrow === _wasNarrowViewport) return;
    _wasNarrowViewport = narrow;
    // Crossing into phone width drops the desktop-only views (Both -> Map,
    // Grid -> List). Otherwise re-derive the current view for the new width
    // (mobile Map has the drawer, desktop Map does not).
    if (narrow && state.activeView === 'combined') switchView('map');
    else if (narrow && state.activeView === 'grid') switchView('list');
    else switchView(state.activeView);
  });
}

// All custom sources + layers. Split out from event wiring because setStyle()
// (the Streets/Satellite toggle) destroys every custom source and layer, so
// this is re-run after each style load to rebuild them; the event handlers in
// wireMapHandlers() bind to layer ids and survive a style switch, so they must
// register exactly once. Keep the two in sync: every layer added here has its
// handlers (if any) in wireMapHandlers.
function addMapLayers() {
  const map = state.map;

  // Basemap dimming layer (item: transit legibility). A world-covering fill in
  // the app dim colour, added FIRST so every custom overlay (transit lines,
  // stations, pins) paints above it and stays crisp while only the basemap is
  // darkened. Opacity is driven by updateBasemapDim (0 unless transit lines on).
  map.addSource('basemap-dim', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] }, properties: {} },
  });
  map.addLayer({ id: 'basemap-dim-layer', type: 'fill', source: 'basemap-dim',
    paint: { 'fill-color': MAP_COLORS.dim, 'fill-opacity': 0 } });

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
      'circle-stroke-color': MAP_COLORS.white,
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
      'text-color': MAP_COLORS.white,
      'text-halo-color': 'rgba(0,0,0,0.45)',
      'text-halo-width': 1,
    },
  });

  map.addSource('clusters', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'clusters-circles',
    type: 'circle',
    source: 'clusters',
    paint: {
      'circle-radius': ['get', 'radius'],
      // Coloured by the highest fit among the cluster's contents when they are
      // known (small clusters carry inline listings); a neutral slate when a
      // big cluster's contents are not loaded (see renderClusterLayer).
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.82,
      'circle-stroke-width': 2,
      'circle-stroke-color': MAP_COLORS.white,
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
    paint: { 'text-color': MAP_COLORS.labelInk },
  });

  // Draw-an-area: completed polygons (fill + outline), the in-progress ring
  // (dashed line), and its vertices (dots).
  map.addSource('draw', { type: 'geojson', data: emptyFC() });
  // GAL-63: exclude zones render red, include zones blue (keyed off the
  // feature `kind` property set in renderDrawLayer; the in-progress line has no
  // kind and falls through to blue).
  map.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw',
    filter: ['==', '$type', 'Polygon'],
    paint: {
      'fill-color': ['case', ['==', ['get', 'kind'], 'exclude'], MAP_COLORS.drawExclude, MAP_COLORS.blue],
      'fill-opacity': ['case', ['==', ['get', 'kind'], 'exclude'], 0.18, 0.12],
    } });
  map.addLayer({ id: 'draw-line', type: 'line', source: 'draw',
    filter: ['in', '$type', 'Polygon', 'LineString'],
    paint: {
      'line-color': ['case', ['==', ['get', 'kind'], 'exclude'], MAP_COLORS.drawExclude, MAP_COLORS.blue],
      'line-width': 2, 'line-dasharray': [2, 1],
    } });
  map.addLayer({ id: 'draw-verts', type: 'circle', source: 'draw',
    filter: ['==', '$type', 'Point'],
    paint: { 'circle-radius': 5, 'circle-color': MAP_COLORS.blue, 'circle-stroke-width': 2, 'circle-stroke-color': MAP_COLORS.white } });

  // GO Stations + GO Lines + Highway 413 -- off by default (layer toggle panel).
  // Stations and lines are DELIBERATELY separate sources/files (go-stations.geojson
  // is Point-only, go-lines.geojson is LineString-only) -- a single mixed source
  // previously caused GTFS route-shape vertices to render as station-like pins.
  // GAL-83: the go-stations SOURCE is declared here, but its station-circle
  // LAYERS are added AFTER the go-lines layer below so the station dots draw on
  // top of the line (Mapbox paints later-added layers above earlier ones). The
  // GTFS route shapes (go-lines) and stops (go-stations) come from separate
  // files and their endpoints do not land on the exact same coordinate, so with
  // the line on top the junction looked messy (line painted over the dot). TTC
  // already adds stations after its lines for the same reason.
  map.addSource('go-stations', { type: 'geojson', data: '/layers/go-stations.geojson' });

  map.addSource('go-lines', { type: 'geojson', data: '/layers/go-lines.geojson' });
  // White casing beneath the coloured GO line, hidden by default and shown only
  // in satellite mode (see updateOverlayLegibility): the GTFS route colours are
  // legible on the street basemap but can vanish against dark imagery, so the
  // casing gives them a light halo. Added before the coloured line so it sits
  // underneath.
  map.addLayer({
    id: 'go-lines-casing',
    type: 'line',
    source: 'go-lines',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': MAP_COLORS.white, 'line-width': 6, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'go-lines-layer',
    type: 'line',
    source: 'go-lines',
    layout: { visibility: 'none' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 3 },
  });

  // GAL-83: station circles added here (after the GO line) so the dots sit ON
  // TOP of the line and the line tucks under them, giving a clean junction.
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
      'circle-stroke-color': MAP_COLORS.white,
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
      'circle-stroke-color': MAP_COLORS.goPlanned,
    },
  });

  // TTC subway: same pattern as GO. Lines coloured by the official TTC route
  // colour (from the TTC GTFS route_color), stations as filled dots. Off by
  // default. Lines get the same white satellite-mode casing as GO lines.
  map.addSource('ttc-lines', { type: 'geojson', data: '/layers/ttc-subway-lines.geojson' });
  map.addLayer({
    id: 'ttc-lines-casing',
    type: 'line',
    source: 'ttc-lines',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': MAP_COLORS.white, 'line-width': 6, 'line-opacity': 0.9 },
  });
  // GAL-25: Line 6 Finch West's official colour is a low-contrast grey
  // (#808080) that blends into the street basemap. Both Line 5 and Line 6 are in
  // revenue service (Line 6 opened 2025-12-07, Line 5 2026-02-08), so EXISTING
  // tiering is correct; the only fix is legibility. Keep the official grey but
  // give ONLY Line 6 a white casing that shows on the street basemap too (the
  // general ttc-lines-casing is satellite-only), so the grey line reads without
  // recolouring it. Drawn under the coloured line layer.
  map.addLayer({
    id: 'ttc-line6-casing',
    type: 'line',
    source: 'ttc-lines',
    filter: ['==', ['get', 'line'], 'Line 6'],
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': MAP_COLORS.white, 'line-width': 7, 'line-opacity': 0.95 },
  });
  map.addLayer({
    id: 'ttc-lines-layer',
    type: 'line',
    source: 'ttc-lines',
    layout: { visibility: 'none' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 4 },
  });
  map.addSource('ttc-stations', { type: 'geojson', data: '/layers/ttc-subway-stations.geojson' });
  map.addLayer({
    id: 'ttc-stations-circles',
    type: 'circle',
    source: 'ttc-stations',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 5,
      'circle-color': ['get', 'statusColor'],
      'circle-stroke-width': 2,
      'circle-stroke-color': MAP_COLORS.white,
    },
  });

  map.addSource('hwy413', { type: 'geojson', data: '/layers/highway-413.geojson' });
  // Same casing treatment for the dark-red Highway 413 corridor, which is the
  // overlay most at risk of vanishing against imagery.
  map.addLayer({
    id: 'hwy413-casing',
    type: 'line',
    source: 'hwy413',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': MAP_COLORS.white, 'line-width': 8, 'line-opacity': 0.85 },
  });
  map.addLayer({
    id: 'hwy413-line',
    type: 'line',
    source: 'hwy413',
    layout: { visibility: 'none' },
    // GAL-84: dashed, not solid. The 413 is not built and this alignment is a
    // statistical approximation of MTO design geometry (see TODOS.md), so it
    // will not lie exactly on any road in the basemap. A dashed "planned
    // corridor" style plus the "(planned, approx.)" toggle label signals that
    // it is a proposed route, not a surveyed road, so the offset reads as
    // intentional rather than as a bug.
    paint: { 'line-color': MAP_COLORS.hwy413, 'line-opacity': 0.55, 'line-width': 4, 'line-dasharray': [2, 2] },
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
      // GAL-66: a slightly larger disc so the category emoji sits legibly on
      // top. Colour still keys off the category, so the pin reads even before
      // the emoji glyph resolves.
      'circle-radius': 11,
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 2,
      'circle-stroke-color': MAP_COLORS.white,
    },
  });
  // GAL-66: the category emoji drawn on the disc, so the icon IS the pin.
  map.addLayer({
    id: 'poi-pins-icons',
    type: 'symbol',
    source: 'poi-pins',
    layout: {
      visibility: 'none',
      'text-field': ['get', 'icon'],
      'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
      'text-size': 14,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
  });
}

// Map event handlers. Registered ONCE (from initMap's load), never re-run on a
// style switch: handlers bind to layer ids, and addMapLayers() re-creates those
// ids, so the same handlers keep firing after setStyle().
function wireMapHandlers() {
  const map = state.map;

  map.on('click', 'listings-circles', e => {
    if (state.drawMode) return; // in draw mode, the tap drops a vertex instead
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

  map.on('click', 'clusters-circles', e => {
    if (state.drawMode) return; // in draw mode, the tap drops a vertex instead
    e.originalEvent?.stopPropagation();
    closeOutsideDetailsPanels(document.body);
    const p = e.features[0].properties;
    const c = state.clusters[Number(p.clusterIdx)];
    if (c) handleClusterClick(c, p);
  });
  map.on('mouseenter', 'clusters-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'clusters-circles', () => { map.getCanvas().style.cursor = ''; });

  // On pan/zoom: refetch server clusters when clustering is active, else
  // re-collapse the individual pill markers for the new zoom so pills separate
  // as you zoom in and merge into count circles where they would pile up.
  map.on('moveend', () => {
    if (clusteringActive()) scheduleClusterRefetch(); else schedulePillRelayout();
    if (state.drawerOn) renderCombined(); // re-derive the viewport set (drawer/column)
  });

  // In draw mode every map click drops a polygon vertex (works with touch: one
  // tap = one vertex). The listing/cluster click handlers early-return in draw
  // mode so a tap never opens a card mid-draw.
  map.on('click', e => { if (state.drawMode) { addDrawVertex(e.lngLat); } });

  // GAL-21: build a GO-station popup body. Existing stations stay minimal
  // (name + lines); planned/proposed stations show a clear status, their lines,
  // an honest opening note (none have a firm public date as of 2026), and, when
  // withLink, a link to the Metrolinx/City project page. Declared as a function
  // so it hoists above the handlers that use it.
  function goStationHtml(p, withLink) {
    const head = `<strong>${esc(p.name)}</strong>`;
    if (p.status === 'Existing') {
      return `${head}<br>${esc(p.lines || '')}${p.lines ? ' &middot; ' : ''}GO Station`;
    }
    const parts = [head];
    if (p.statusText) parts.push(`<span class="go-planned-status">${esc(p.statusText)}</span>`);
    if (p.lines) parts.push(esc(p.lines));
    if (p.openingNote) parts.push(esc(p.openingNote));
    if (withLink && p.projectUrl) {
      parts.push(`<a class="go-project-link" href="${esc(p.projectUrl)}" target="_blank" rel="noopener">Metrolinx project page ↗</a>`);
    } else if (p.projectUrl) {
      parts.push('<span class="go-planned-hint">Click the station for the project link</span>');
    }
    return parts.join('<br>');
  }

  // GAL-21: status-dependent station popup. Hover shows a quick, richer tooltip
  // (name + status + opening note); clicking a planned station opens a
  // persistent popup that also carries the Metrolinx/City project link (a link
  // is not usable inside a hover tooltip, which disappears on mouseleave).
  let goStationPopup = null;
  let goStationClickPopup = null;
  ['go-stations-existing-circles', 'go-stations-planned-circles'].forEach(layerId => {
    map.on('mouseenter', layerId, e => {
      map.getCanvas().style.cursor = 'pointer';
      const p = e.features[0].properties;
      goStationPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'go-station-tooltip', offset: 10 })
        .setLngLat(e.features[0].geometry.coordinates)
        .setHTML(goStationHtml(p, false))
        .addTo(map);
    });
    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = '';
      goStationPopup?.remove();
      goStationPopup = null;
    });
    map.on('click', layerId, e => {
      const p = e.features[0].properties;
      if (p.status === 'Existing') return; // existing stations need no link/detail
      e.originalEvent?.stopPropagation();
      goStationPopup?.remove(); goStationPopup = null;
      goStationClickPopup?.remove();
      goStationClickPopup = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, className: 'go-station-tooltip go-station-detail', offset: 10 })
        .setLngLat(e.features[0].geometry.coordinates)
        .setHTML(goStationHtml(p, true))
        .addTo(map);
    });
  });

  let ttcStationPopup = null;
  map.on('mouseenter', 'ttc-stations-circles', e => {
    map.getCanvas().style.cursor = 'pointer';
    const p = e.features[0].properties;
    ttcStationPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'go-station-tooltip', offset: 10 })
      .setLngLat(e.features[0].geometry.coordinates)
      .setHTML(`<strong>${esc(p.name)}</strong><br>${esc(p.lines || '')}`)
      .addTo(map);
  });
  map.on('mouseleave', 'ttc-stations-circles', () => {
    map.getCanvas().style.cursor = '';
    ttcStationPopup?.remove();
    ttcStationPopup = null;
  });

  let poiPopup = null;
  map.on('mouseenter', 'poi-pins-circles', e => {
    map.getCanvas().style.cursor = 'pointer';
    const p = e.features[0].properties;
    const meta = POI_TYPE_META[p.type] || POI_TYPE_META.other;
    const typeLabel = `${meta.icon} ${meta.label}`;
    poiPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'go-station-tooltip', offset: 10 })
      .setLngLat(e.features[0].geometry.coordinates)
      .setHTML(`<strong>${esc(p.label || meta.label)}</strong><br>${esc(typeLabel)}${p.created_by_name ? ' &middot; added by ' + esc(p.created_by_name) : ''}`)
      .addTo(map);
  });
  map.on('mouseleave', 'poi-pins-circles', () => {
    map.getCanvas().style.cursor = '';
    poiPopup?.remove();
    poiPopup = null;
  });
}

// ─── Basemap style switching ────────────────────────────────────────────────────
// setStyle() destroys all custom sources/layers, so after the new style loads we
// rebuild every overlay (addMapLayers), re-apply toggle visibility + satellite
// legibility, and re-populate the data-driven overlays (drawn areas, POI pins,
// listings pills/clusters). HTML-marker pills survive a style switch on their
// own (they are DOM overlays, not part of the style), but the GeoJSON cluster
// source is destroyed, so applyFiltersAndRender re-renders it.
function applyMapStyle(choice) {
  if (!state.map) return;
  const target = choice === 'satellite' ? 'satellite' : 'streets';
  setMapStyleChoice(target);
  updateMapStyleUI();
  // Skip a redundant setStyle to the style already loaded (it would drop every
  // overlay and rebuild for nothing). Tracked with an explicit state flag, not
  // sprite-string matching: the satellite-streets sprite URL itself contains
  // "streets", so a substring check would misfire switching back.
  if (state.mapStyle === target) { updateOverlayLegibility(); return; }
  state.mapStyle = target;
  state.map.setStyle(MAP_STYLES[target]);
  state.map.once('style.load', () => {
    addMapLayers();
    applyPersistedLayerVisibility(); // also calls updateOverlayLegibility()
    renderDrawLayer();
    refreshPoiLayer();
    if (state.rawListings.length) applyFiltersAndRender();
  });
}
function updateMapStyleUI() {
  // Satellite/streets is a single Layers-toggle concern now (the duplicate
  // Appearance "Map imagery" select was removed to avoid two controls for one
  // state). The Layers checkbox is the single source of truth + persistence.
  const toggle = $('layerSatellite');
  if (toggle) toggle.checked = mapStyleChoice() === 'satellite';
}

// ─── Icon-only map controls ─────────────────────────────────────────────────────
// One consistent inline-SVG set (Lucide-style strokes) for the whole control
// family: funnel (Filters), layers (Layers), pencil (Draw), key/legend (Legend),
// sort arrows (Sort). Inline SVG so it works under the strict CSP (no icon CDN).
const CONTROL_ICONS = {
  filter: '<polygon points="21 4 3 4 10 12 10 19 14 21 14 12 21 4"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  legend: '<circle cx="4" cy="6" r="1.6"/><circle cx="4" cy="12" r="1.6"/><circle cx="4" cy="18" r="1.6"/><line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/>',
  sort: '<polyline points="7 4 7 20"/><polyline points="3.5 8 7 4 10.5 8"/><polyline points="17 20 17 4"/><polyline points="13.5 16 17 20 20.5 16"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
};
function ctrlSvg(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20" aria-hidden="true">${CONTROL_ICONS[name] || ''}</svg>`;
}
function setupControlIcons() {
  document.querySelectorAll('[data-ctrl-icon]').forEach(el => {
    const glyph = el.querySelector('.ctrl-glyph');
    if (glyph) glyph.innerHTML = ctrlSvg(el.dataset.ctrlIcon);
  });
}
// Discoverability: desktop hover + touch long-press use the native title (set in
// HTML). Additionally, the FIRST time a device sees the icon-only controls, the
// text labels show (icon + text), then collapse to icon-only on the first
// interaction with any control or after a few seconds, whichever comes first, so
// the icon->meaning mapping is taught once rather than assumed. Per-device flag.
const ICONS_TAUGHT_KEY = 'hh_icons_taught_v1';
function maybeTeachIconLabels() {
  if (localStorage.getItem(ICONS_TAUGHT_KEY)) return;
  document.body.classList.add('icons-labeled');
  let timer = null;
  const collapse = () => {
    document.body.classList.remove('icons-labeled');
    localStorage.setItem(ICONS_TAUGHT_KEY, '1');
    document.removeEventListener('pointerdown', onInteract, true);
    if (timer) clearTimeout(timer);
  };
  const onInteract = e => {
    if (e.target.closest('.map-ctrl-btn, .map-draw-btn, .status-bar .sort-inline')) collapse();
  };
  document.addEventListener('pointerdown', onInteract, true);
  timer = setTimeout(collapse, 4500);
}
// Satellite-mode legibility: show the white line casings (only meaningful in
// satellite mode, and only when their parent line layer is toggled on), and
// bump the Highway 413 line opacity so it reads against imagery. Streets mode
// keeps the casings hidden and the original appearance unchanged.
function updateOverlayLegibility() {
  if (!state.mapReady || !state.map) return;
  const map = state.map;
  const sat = mapStyleChoice() === 'satellite';
  const goOn = !!($('layerGoLines') && $('layerGoLines').checked);
  const hwyOn = !!($('layerHwy413') && $('layerHwy413').checked);
  const ttcOn = !!($('layerTtcLines') && $('layerTtcLines').checked);
  if (map.getLayer('go-lines-casing')) map.setLayoutProperty('go-lines-casing', 'visibility', (sat && goOn) ? 'visible' : 'none');
  if (map.getLayer('hwy413-casing')) map.setLayoutProperty('hwy413-casing', 'visibility', (sat && hwyOn) ? 'visible' : 'none');
  if (map.getLayer('ttc-lines-casing')) map.setLayoutProperty('ttc-lines-casing', 'visibility', (sat && ttcOn) ? 'visible' : 'none');
  // GAL-25: Line 6's white casing shows whenever the TTC lines are on (street
  // and satellite), so the grey line reads on the light basemap too.
  if (map.getLayer('ttc-line6-casing')) map.setLayoutProperty('ttc-line6-casing', 'visibility', ttcOn ? 'visible' : 'none');
  if (map.getLayer('hwy413-line')) map.setPaintProperty('hwy413-line', 'line-opacity', sat ? 0.9 : 0.55);
}

// ─── POI pins (T14) ─────────────────────────────────────────────────────────
// Visual/map-only for now, not wired into any commute or distance
// calculation. Shared across the whole buyer group the same way listing
// feedback is shared -- created_by just records who added it.
// GAL-66: every place category carries an emoji icon, shown in the list, the
// attach rows, the hover popup, and as the map pin itself. `color` on the five
// original types is a live getter so it always reflects MAP_COLORS (the CSS
// :root map palette); the icon-only types added here carry a literal colour
// (they have no CSS variable and do not need one). Insertion order is the order
// the picker shows: favourite first, then the common household categories.
const POI_TYPE_META = {
  heart: { label: 'Favourite', icon: '❤️', color: '#e0245e' },
  home: { label: 'Home', icon: '🏠', color: '#2e7d32' },
  family: { label: 'Family', icon: '👪', color: '#6a1b9a' },
  work: { label: 'Workplace', icon: '💼', get color() { return MAP_COLORS.poiWork; } },
  school: { label: 'School', icon: '🏫', get color() { return MAP_COLORS.poiSchool; } },
  hospital: { label: 'Hospital', icon: '🏥', get color() { return MAP_COLORS.poiHospital; } },
  worship: { label: 'Place of worship', icon: '🙏', get color() { return MAP_COLORS.poiWorship; } },
  gym: { label: 'Gym', icon: '🏋️', color: '#ef6c00' },
  grocery: { label: 'Groceries', icon: '🛒', color: '#00838f' },
  park: { label: 'Park', icon: '🌳', color: '#388e3c' },
  other: { label: 'Other', icon: '📍', get color() { return MAP_COLORS.poiOther; } },
};

function refreshPoiLayer() {
  if (!state.mapReady || !state.map.getSource('poi-pins')) return; // guard mid style-switch
  const fc = {
    type: 'FeatureCollection',
    features: state.poi.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        type: p.type,
        label: p.label || '',
        color: (POI_TYPE_META[p.type] || POI_TYPE_META.other).color,
        icon: (POI_TYPE_META[p.type] || POI_TYPE_META.other).icon,
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
  renderPoiList();
}

// Manage-list for the shared POI pins, shown under "Add place" in the Layers
// menu, mirroring the saved-areas list. Each row names the place and offers a
// group-wide delete. Deletion is refused server-side when the pin is still
// attached to listings; on that 409 we surface the count and let the user
// force a cascade.
function renderPoiList() {
  const list = $('poiLayerList');
  if (!list) return;
  list.innerHTML = '';
  // GAL-85: the "Places" layer only shows pins the group adds itself; there is
  // no built-in hospitals/schools dataset. With none added, turning the layer
  // on drew nothing and read as broken. Show an explicit empty-state so it is
  // clear the layer is working and how to populate it.
  if (!state.poi.length) {
    const empty = document.createElement('div');
    empty.className = 'poi-empty-hint';
    empty.textContent = 'No places added yet. Use "Add place" above to pin a school, hospital, or anywhere else, shared with the whole group.';
    list.appendChild(empty);
    return;
  }
  state.poi.forEach(p => {
    const meta = POI_TYPE_META[p.type] || POI_TYPE_META.other;
    const row = document.createElement('div');
    row.className = 'poi-row';
    const label = document.createElement('span');
    label.className = 'poi-chip';
    const dot = document.createElement('span');
    dot.className = 'poi-dot';
    dot.style.background = meta.color;
    label.appendChild(dot);
    label.appendChild(document.createTextNode(' ' + meta.icon + ' ' + (p.label || meta.label)));
    if (p.created_by_name) {
      const by = document.createElement('span');
      by.className = 'poi-by';
      by.textContent = ' · ' + p.created_by_name;
      label.appendChild(by);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'poi-del';
    del.title = 'Delete this place for everyone';
    del.textContent = '✕';
    del.addEventListener('click', () => deletePoi(p));
    row.appendChild(label);
    row.appendChild(del);
    list.appendChild(row);
  });
}

async function deletePoi(poi, force = false) {
  const meta = POI_TYPE_META[poi.type] || POI_TYPE_META.other;
  const name = poi.label || meta.label;
  if (!force && !window.confirm(`Delete the place "${name}"? This removes it for everyone.`)) return;
  try {
    const res = await fetch('/api/poi', {
      method: 'DELETE', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: poi.id, force }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.error === 'poi_referenced') {
      if (window.confirm(`${data.detail} Delete anyway?`)) return deletePoi(poi, true);
      return;
    }
    if (!res.ok) throw new Error(data.detail || data.error || 'delete failed');
    await loadPoi();
  } catch (e) {
    alert('Could not delete the place: ' + e.message);
  }
}

// ─── In-app issue reporter (GAL-42) ─────────────────────────────────────────
// A tester describes a bug, optionally attaches a photo/screenshot, and the
// server files it in Linear Triage with captured context and an AI first-pass.
// The button only appears when the server has a Linear key (REPORT_ENABLED).
// The pristine report-form markup, captured from index.html once so it is the
// single source of truth. sendReport replaces the body with a thanks message,
// so openReportModal restores this to reset the form.
let REPORT_BODY_HTML = null;

function initReportButton() {
  const btn = $('reportIssueBtn');
  if (!btn) return;
  if (!REPORT_ENABLED) { btn.hidden = true; return; }
  REPORT_BODY_HTML = $('reportBody')?.innerHTML || '';
  btn.hidden = false;
  btn.addEventListener('click', openReportModal);
  $('reportClose')?.addEventListener('click', closeReportModal);
  $('reportOverlay')?.addEventListener('click', closeReportModal);
}

function openReportModal() {
  const body = $('reportBody');
  body.innerHTML = REPORT_BODY_HTML;  // reset the form (a prior send left a thanks message)
  $('reportSend').addEventListener('click', () => sendReport().catch(err => {
    showFeedbackStatus($('reportStatus'), err.message || 'Could not send. Try again.', true);
  }));
  // GAL-57: reflect how many images the tester picked, and flag the 5 cap.
  $('reportImage')?.addEventListener('change', updateReportImageCount);
  $('reportOverlay').hidden = false;
  $('reportModal').hidden = false;
  $('reportText').focus();
}

function closeReportModal() {
  $('reportOverlay').hidden = true;
  $('reportModal').hidden = true;
}

// GAL-57: max images a tester can attach to one report. Mirrors the server's
// REPORT_MAX_IMAGES; the client trims to this before sending.
const REPORT_MAX_IMAGES = 5;

function updateReportImageCount() {
  const el = $('reportImageCount');
  const input = $('reportImage');
  if (!el || !input) return;
  const n = input.files ? input.files.length : 0;
  if (!n) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = n > REPORT_MAX_IMAGES
    ? `${n} selected, only the first ${REPORT_MAX_IMAGES} will be sent.`
    : `${n} image${n === 1 ? '' : 's'} selected.`;
}

// Downscale a chosen image to a phone-friendly JPEG (max 1600px long edge) and
// return { image_base64, image_mimetype }, or null if there is no usable image.
// Keeps the JSON body well under the server's 8 MB cap even for 12 MP photos.
function prepareReportImage(file) {
  return new Promise(resolve => {
    if (!file) { resolve(null); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxEdge = 1600;
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      resolve({ image_base64: dataUrl.split(',', 2)[1], image_mimetype: 'image/jpeg' });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function reportContext() {
  const person = state.people.find(p => p.id === state.activePerson) || {};
  const token = (document.querySelector('script[src*="app.js"]')?.src.match(/[?&]v=([\w.-]+)/) || [])[1] || null;
  let viewport = null;
  if (state.map) {
    const c = state.map.getCenter();
    viewport = {
      lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5),
      zoom: +state.map.getZoom().toFixed(2), bearing: +state.map.getBearing().toFixed(1),
    };
  }
  return {
    person_id: state.activePerson,
    person_name: person.name || null,
    listing_id: state.openMapItem?.mls || null,
    listing_address: state.openMapItem?.address || null,
    view: state.activeView,
    source: state.source,
    filters: filterParams().toString(),
    viewport,
    deploy_token: token,
    user_agent: navigator.userAgent,
  };
}

async function sendReport() {
  const description = ($('reportText')?.value || '').trim();
  const status = $('reportStatus');
  if (!description) { showFeedbackStatus(status, 'Please describe the issue first.', true); return; }
  const sendBtn = $('reportSend');
  sendBtn.disabled = true;
  showFeedbackStatus(status, 'Sending...', false);

  // GAL-57: downscale up to REPORT_MAX_IMAGES chosen photos and send them as an
  // array. Files that fail to decode drop out silently rather than blocking.
  const files = Array.from($('reportImage')?.files || []).slice(0, REPORT_MAX_IMAGES);
  const images = (await Promise.all(files.map(prepareReportImage))).filter(Boolean);

  const payload = {
    description,
    issue_type: $('reportType')?.value || '',
    priority: $('reportPriority')?.value || '',
    milestone: $('reportMilestone')?.value || '',
    context: reportContext(),
  };
  if (images.length) payload.images = images;

  let res, data;
  try {
    res = await fetch('/api/report-issue', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    sendBtn.disabled = false;
    showFeedbackStatus(status, 'Network error. Try again.', true);
    return;
  }
  if (!res.ok) {
    sendBtn.disabled = false;
    showFeedbackStatus(status, data.detail || data.error || 'Could not send. Try again.', true);
    return;
  }
  // Replace the form with a thanks confirmation, then auto-close.
  $('reportBody').innerHTML = `<p class="report-thanks">Thanks, filed as ${esc(data.identifier || 'a new issue')}.</p>`;
  setTimeout(closeReportModal, 2500);
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
  // The keyword filter row + settings editor reflect the household list.
  buildFeatureKeywordChips();
  renderKeywordEditor();
  updateFilterBadge();
}

// Build the filter-panel keyword checkboxes from the household list, preserving
// which are checked across a rebuild (from the live DOM and persisted state).
function buildFeatureKeywordChips() {
  const row = $('featureKeywordRow');
  if (!row) return;
  const checkedNow = new Set(currentCheckedKeywords());
  const persisted = new Set(loadSavedFilterState()._featureKeywords || []);
  row.innerHTML = '';
  featureKeywords().forEach(kw => {
    const label = document.createElement('label');
    label.className = 'chip';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'feat-kw';
    cb.dataset.kw = kw;
    cb.checked = checkedNow.has(kw) || persisted.has(kw);
    cb.addEventListener('change', () => { saveFilterState(); applyFiltersAndRender(); });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' Mentions ' + kw));
    row.appendChild(label);
  });
}
// GAL-75: build the property-type checkboxes from the distinct types in the
// loaded data. Hides the whole group when there are fewer than two meaningful
// types (POC's placeholder, or a source without the field), so it is a no-op
// there. Preserves which are checked across rebuilds (live DOM + persisted).
function buildPropTypeChips() {
  const row = $('propTypeRow');
  const heading = $('propTypeHeading');
  if (!row || !heading) return;
  const types = Array.from(new Set((state.rawListings || []).map(propTypeOf).filter(Boolean))).sort();
  if (types.length < 2) {
    // Nothing useful to filter on: hide and drop any stale selection so it
    // cannot silently filter a source that has no types.
    row.innerHTML = '';
    row.hidden = true;
    heading.hidden = true;
    return;
  }
  const checkedNow = new Set(currentCheckedPropTypes());
  const persisted = new Set(loadSavedFilterState()._propTypes || []);
  row.innerHTML = '';
  types.forEach(t => {
    const label = document.createElement('label');
    label.className = 'chip';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'prop-type';
    cb.dataset.pt = t;
    cb.checked = checkedNow.has(t) || persisted.has(t);
    cb.addEventListener('change', () => { saveFilterState(); applyFiltersAndRender(); });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + t));
    row.appendChild(label);
  });
  row.hidden = false;
  heading.hidden = false;
}

// Settings-drawer keyword editor: one row per keyword with a delete button,
// plus an add field. Persists the whole list to household_settings.
function renderKeywordEditor() {
  const list = $('keywordEditorList');
  if (!list) return;
  list.innerHTML = '';
  const kws = featureKeywords();
  if (!kws.length) { list.innerHTML = '<div class="field-desc">No keywords yet. Add one below.</div>'; return; }
  kws.forEach(kw => {
    const rowEl = document.createElement('div');
    rowEl.className = 'keyword-editor-row';
    const name = document.createElement('span');
    name.className = 'keyword-name';
    name.textContent = kw;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'keyword-del';
    del.textContent = '✕';
    del.title = 'Remove this keyword';
    del.addEventListener('click', () => saveKeywords(featureKeywords().filter(k => k !== kw)));
    rowEl.append(name, del);
    list.appendChild(rowEl);
  });
}
async function saveKeywords(listArr) {
  if (!state.activePerson) { alert('Select who you are (top right) first.'); return false; }
  try {
    const res = await fetch('/api/household-settings', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_id: state.activePerson, key: 'feature_keywords', value: JSON.stringify(listArr) }),
    });
    if (!res.ok) throw new Error('save failed');
    state.householdSettings.feature_keywords = JSON.stringify(listArr);
    renderKeywordEditor();
    buildFeatureKeywordChips();
    updateFilterBadge();
    applyFiltersAndRender();
    return true;
  } catch (e) { alert('Could not save keywords: ' + e.message); return false; }
}
function addKeywordFromInput() {
  const input = $('keywordAddInput');
  if (!input) return;
  const kw = (input.value || '').trim().toLowerCase();
  if (!kw) return;
  const kws = featureKeywords();
  if (kws.includes(kw)) { input.value = ''; return; }
  saveKeywords([...kws, kw]).then(ok => { if (ok) input.value = ''; });
}

// Results-per-fetch (page size) only applies to the paged Sample Data feed; POC
// returns the whole set, so hide it there.
function updateResultsPerFetchVisibility() {
  const label = $('resultsPerFetchLabel');
  if (label) label.hidden = currentSource() !== 'repliers';
}

// Highlight filter fields that currently hold a value, so persisted-but-easy-to-
// miss constraints are findable in the long panel (the reason a badge count can
// look higher than what is visible at a glance).
const HIGHLIGHT_FIELD_IDS = ['q', 'filterStatus', 'minPrice', 'maxPrice', 'minBeds', 'maxBeds',
  'minBaths', 'maxBaths', 'minSqft', 'maxSqft', 'minAcres', 'maxAcres', 'maxCommute',
  'minHwyKm', 'maxHwyKm', 'minAttachDrive', 'maxAttachDrive', 'minPit', 'maxPit',
  'minDue', 'maxDue', 'minFit'];
function markFilledFilters() {
  HIGHLIGHT_FIELD_IDS.forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle('filter-filled', String(el.value || '').trim() !== '');
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
      ? state.poi.map(p => `<option value="${p.id}">${(POI_TYPE_META[p.type] || POI_TYPE_META.other).icon} ${esc(p.label || (POI_TYPE_META[p.type] || POI_TYPE_META.other).label)}</option>`).join('')
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
// GAL-53 rework: the Layers "Add place" flow now uses the SAME Search Box
// typeahead + icon dropdown as the property-card composer, instead of a chain
// of prompt() dialogs on the classic geocoder. Toggling the button builds an
// inline composer once and shows/hides it.
function togglePoiComposer() {
  if (!state.activePerson) { alert('Select who you are (top right) first.'); return; }
  const box = $('poiAddComposer');
  if (!box) return;
  if (!box.hidden) { box.hidden = true; return; }
  buildPoiComposer(box);
  box.hidden = false;
}

function buildPoiComposer(box) {
  box.innerHTML = '';
  const sessionToken = newSearchSession();
  const selectedPlaceRef = { value: null };

  const addrInput = el('input', { type: 'text', className: 'attach-input',
    placeholder: 'Search a name or address, e.g. Islington United Church' });
  const suggestBox = el('div', { className: 'attach-suggest' });
  suggestBox.hidden = true;
  let suggestTimer = null, suggestItems = [], suggestIdx = -1;
  const closeSuggest = () => { suggestBox.hidden = true; suggestBox.innerHTML = ''; suggestItems = []; suggestIdx = -1; };
  const updateActive = () => { [...suggestBox.children].forEach((c, i) => c.classList.toggle('active', i === suggestIdx)); };
  const pick = async (p) => {
    addrInput.value = p.label;
    selectedPlaceRef.value = null;
    closeSuggest();
    addrInput.focus();
    if (p.lng != null && p.lat != null) { selectedPlaceRef.value = p; return; }
    if (p.mapbox_id) {
      const full = await searchBoxRetrieve(p.mapbox_id, sessionToken);
      if (full && addrInput.value.trim() === p.label.trim()) selectedPlaceRef.value = full;
    }
  };
  const runSuggest = async () => {
    const q = addrInput.value.trim();
    selectedPlaceRef.value = null;
    if (q.length < 3) { closeSuggest(); return; }
    const places = await geocodeSuggest(q, sessionToken);
    if (addrInput.value.trim() !== q) return;
    if (!places.length) { closeSuggest(); return; }
    suggestItems = places; suggestIdx = -1;
    suggestBox.innerHTML = '';
    places.forEach(p => {
      const opt = el('button', { type: 'button', className: 'attach-suggest-item', textContent: p.label });
      opt.addEventListener('mousedown', (e) => { e.preventDefault(); pick(p); });
      suggestBox.append(opt);
    });
    suggestBox.hidden = false;
  };
  addrInput.addEventListener('input', () => { clearTimeout(suggestTimer); suggestTimer = setTimeout(runSuggest, 250); });
  addrInput.addEventListener('keydown', (e) => {
    if (!suggestBox.hidden && suggestItems.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); suggestIdx = (suggestIdx + 1) % suggestItems.length; updateActive(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); suggestIdx = (suggestIdx - 1 + suggestItems.length) % suggestItems.length; updateActive(); return; }
      if (e.key === 'Enter') { e.preventDefault(); pick(suggestItems[suggestIdx >= 0 ? suggestIdx : 0]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
  });

  const typeSel = el('select', { className: 'attach-select' });
  typeSel.innerHTML = Object.entries(POI_TYPE_META).map(([k, v]) => `<option value="${k}">${v.icon} ${esc(v.label)}</option>`).join('');
  typeSel.value = 'other';

  const statusEl = el('div', { className: 'feedback-status' });
  const addBtn = el('button', { type: 'button', textContent: 'Add place' });
  const cancelBtn = el('button', { type: 'button', className: 'secondary', textContent: 'Cancel' });
  cancelBtn.addEventListener('click', () => { box.hidden = true; });

  addBtn.addEventListener('click', async () => {
    const query = addrInput.value.trim();
    if (!query) { showFeedbackStatus(statusEl, 'Search for a place first.', true); return; }
    addBtn.disabled = true;
    let place = selectedPlaceRef.value;
    if (!place) { showFeedbackStatus(statusEl, 'Looking up place…', false); place = await geocodePlace(query); }
    if (!place) { showFeedbackStatus(statusEl, 'No place found for that name or address.', true); addBtn.disabled = false; return; }
    try {
      const res = await fetch('/api/poi', {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: state.activePerson, type: typeSel.value, label: place.label, lat: place.lat, lng: place.lng }),
      });
      if (!res.ok) throw new Error('save failed');
      await loadPoi();
      refreshPoiLayer();
      // Turn the Places layer on so the new pin is visible immediately.
      const cb = $('layerPoiPins');
      if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
      box.hidden = true;
    } catch (err) {
      console.error(err);
      showFeedbackStatus(statusEl, 'Could not save the place. Try again.', true);
      addBtn.disabled = false;
    }
  });

  box.append(
    el('div', { className: 'attach-new-wrap' }, addrInput, suggestBox),
    el('div', { className: 'poi-add-row' }, typeSel, addBtn, cancelBtn),
    statusEl,
  );
}

// ─── Per-property place attachments ───────────────────────────────────────────
// Progressive, like notes and the potential price: existing attachments and an
// "Attach a place" button always show; the composer is hidden until clicked. A
// place is always a POI pin (one source of truth): attach an existing pin, or
// enter a new address that gets geocoded into a pin. Shared across the group
// with who-added attribution. Straight-line distance shows immediately;
// street-routed drive time is computed on attach and cached server-side, with a
// recompute affordance. Deliberately NOT gated on any star rating in code.
// GAL-53: place search uses the Mapbox Search Box API (POI-first), not the
// classic address geocoder, so a named landmark like "Islington United Church"
// resolves to the building instead of the nearest street. Same Mapbox token,
// same free tier, no new account (decision logged in DECISIONS.md 2026-07-11;
// Google Places is deferred there). The Search Box flow is two calls that share
// one session_token: /suggest lists candidates (no coordinates), /retrieve
// resolves the picked one to lng/lat. A free-text attach with no pick uses
// /forward (single call). Every path falls back to the classic geocoder on
// error, so attaching a place never dead-ends.
const GTA_PROXIMITY = '-79.5,44.0';

// A session_token groups a suggest/retrieve cycle for Search Box billing. One
// per composer is fine. crypto.randomUUID where available, else a v4-ish id.
function newSearchSession() {
  try {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16), v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Classic Geocoding API fallback: returns [{lng, lat, label}].
async function classicGeocode(query, limit) {
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`
      + `?access_token=${encodeURIComponent(MAPBOX_TOKEN)}&proximity=${GTA_PROXIMITY}&limit=${limit}&country=ca`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features || []).map(f => ({ lng: f.center[0], lat: f.center[1], label: f.place_name }));
  } catch (err) { console.error(err); return []; }
}

function searchBoxLabel(nameOrProps) {
  const name = nameOrProps.name || '';
  const place = nameOrProps.place_formatted || '';
  return place ? `${name}, ${place}` : name;
}

// Search Box /suggest: candidates by name or address, no coordinates yet.
// Returns [{mapbox_id, label}]. Falls back to the classic geocoder on error
// (those items carry lng/lat instead of mapbox_id, handled at retrieve time).
async function geocodeSuggest(query, sessionToken) {
  try {
    const url = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(query)}`
      + `&access_token=${encodeURIComponent(MAPBOX_TOKEN)}&session_token=${encodeURIComponent(sessionToken)}`
      + `&country=ca&language=en&limit=5&proximity=${GTA_PROXIMITY}`
      + `&types=poi,address,place,neighborhood,locality,street`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('suggest ' + res.status);
    const data = await res.json();
    const items = (data.suggestions || [])
      .filter(s => s.mapbox_id)
      .map(s => ({ mapbox_id: s.mapbox_id, label: searchBoxLabel(s) }));
    return items.length ? items : await classicGeocode(query, 5);
  } catch (err) {
    console.error(err);
    return classicGeocode(query, 5);
  }
}

// Search Box /retrieve: resolve a picked suggestion's mapbox_id to coordinates.
// Returns {lng, lat, label} or null.
async function searchBoxRetrieve(mapboxId, sessionToken) {
  try {
    const url = `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(mapboxId)}`
      + `?access_token=${encodeURIComponent(MAPBOX_TOKEN)}&session_token=${encodeURIComponent(sessionToken)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const f = (data.features || [])[0];
    if (!f || !f.geometry) return null;
    const c = f.geometry.coordinates;
    return { lng: c[0], lat: c[1], label: searchBoxLabel(f.properties || {}) };
  } catch (err) { console.error(err); return null; }
}

// Single-call resolve for a typed name/address with no picked suggestion.
// Search Box /forward (POI-first) with the classic geocoder as fallback.
async function geocodePlace(query) {
  try {
    const url = `https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(query)}`
      + `&access_token=${encodeURIComponent(MAPBOX_TOKEN)}&country=ca&language=en&limit=1&proximity=${GTA_PROXIMITY}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const f = (data.features || [])[0];
      if (f && f.geometry) {
        const c = f.geometry.coordinates;
        return { lng: c[0], lat: c[1], label: searchBoxLabel(f.properties || {}) };
      }
    }
  } catch (err) { console.error(err); }
  const arr = await classicGeocode(query, 1);
  return arr[0] || null;
}

// GAL-55: which listing's "Attach a place" composer should stay open across a
// card rebuild, so a buyer can add several places (school, work, gym) without
// reopening it each time. Cleared when the composer is closed.
let attachComposerOpenFor = null;

function buildPlaceAttachments(node, item) {
  const container = node.querySelector('.card-place-attachments');
  if (!container) return;
  container.innerHTML = '';
  if (!item.poc) return; // pocOnly: attachments measure from a listing's coordinates

  container.append(el('div', { className: 'attach-heading', textContent: 'Attached places' }));

  // GAL-56: the active person's "Max travel time to a place" threshold was
  // stored but never surfaced anywhere, so a home over the limit showed no
  // warning. If the active person set a max travel time to THIS place, flag on
  // the row whether the drive clears it (travel_dest_ref is the poi id,
  // travel_minutes the limit in minutes).
  const activeT = thresholdFor(state.activePerson);

  (state.placeAttachments[item.mls] || []).forEach(a => {
    const typeMeta = POI_TYPE_META[a.poi_type] || POI_TYPE_META.other;
    const typeLabel = typeMeta.label;
    const straight = a.straight_km != null ? `${num(a.straight_km)} km straight-line` : '';
    const drive = a.drive_minutes != null
      ? `${num(a.drive_minutes)} min drive` + (a.drive_km != null ? ` (${num(a.drive_km)} km)` : '')
      : 'drive time unavailable';
    const info = el('div', { className: 'attach-info' },
      el('span', { className: 'attach-name', textContent: typeMeta.icon + ' ' + (a.poi_label || typeLabel) }),
      el('span', { className: 'attach-detail', textContent: [straight, drive].filter(Boolean).join(' · ') }),
      el('span', { className: 'attach-by', textContent: `added by ${a.created_by_name}` }));

    const overLimit = activeT && activeT.travel_dest_kind === 'poi'
      && String(activeT.travel_dest_ref) === String(a.poi_id)
      && activeT.travel_minutes != null;
    if (overLimit) {
      const limit = Number(activeT.travel_minutes);
      const who = (state.people.find(p => p.id === state.activePerson) || {}).name || 'your';
      let badge;
      if (a.drive_minutes == null) {
        badge = el('span', { className: 'attach-limit attach-limit-unknown',
          textContent: `drive time unavailable, cannot check ${who}'s ${limit} min limit` });
      } else if (a.drive_minutes > limit) {
        badge = el('span', { className: 'attach-limit attach-limit-bad',
          textContent: `× ${num(a.drive_minutes)} min drive is over ${who}'s ${limit} min limit` });
      } else {
        badge = el('span', { className: 'attach-limit attach-limit-good',
          textContent: `✓ within ${who}'s ${limit} min limit` });
      }
      info.append(badge);
    }

    const row = el('div', { className: 'attach-row' });
    row.append(info);
    // GAL-66: edit the place's category/icon after adding it, via an inline
    // dropdown of the emoji categories, without deleting and re-adding.
    const editWrap = el('div', { className: 'attach-edit' });
    editWrap.hidden = true;
    const editSel = el('select', { className: 'attach-select' });
    editSel.innerHTML = Object.entries(POI_TYPE_META).map(([k, v]) => `<option value="${k}">${v.icon} ${esc(v.label)}</option>`).join('');
    editSel.value = POI_TYPE_META[a.poi_type] ? a.poi_type : 'other';
    const editSave = el('button', { type: 'button', className: 'fb-btn', textContent: 'Save' });
    const editCancel = el('button', { type: 'button', className: 'secondary fb-btn', textContent: 'Back' });
    editSave.addEventListener('click', () => updatePoiType(item, a.poi_id, editSel.value));
    editCancel.addEventListener('click', () => { editWrap.hidden = true; });
    editWrap.append(el('span', { className: 'attach-edit-label', textContent: 'Category' }), editSel, editSave, editCancel);

    const editBtn = el('button', { type: 'button', className: 'secondary fb-btn', textContent: '✎', title: 'Edit category / icon' });
    editBtn.addEventListener('click', () => {
      editWrap.hidden = !editWrap.hidden;
      if (!editWrap.hidden) { editSel.value = POI_TYPE_META[a.poi_type] ? a.poi_type : 'other'; editSel.focus(); }
    });
    const recomputeBtn = el('button', { type: 'button', className: 'secondary fb-btn', textContent: '↻', title: 'Recompute drive time' });
    recomputeBtn.addEventListener('click', () => recomputeAttachment(item, a.id));
    const removeBtn = el('button', { type: 'button', className: 'secondary fb-btn fb-btn-reject', textContent: '✕', title: 'Remove this place' });
    removeBtn.addEventListener('click', () => removeAttachment(item, a.id));
    row.append(el('div', { className: 'attach-btns' }, editBtn, recomputeBtn, removeBtn));
    row.append(editWrap);
    container.append(row);
  });

  const addBtn = el('button', { type: 'button', className: 'secondary fb-btn', textContent: '➕ Attach a place' });
  const composer = el('div', { className: 'feedback-compose attach-compose' });
  // Stay open across the rebuild that follows a successful attach (GAL-55).
  composer.hidden = attachComposerOpenFor !== item.mls;

  const modeSel = el('select', { className: 'attach-select' });
  modeSel.innerHTML = `<option value="existing">Choose a pinned place</option><option value="new">New address</option>`;
  const poiSel = el('select', { className: 'attach-select' });
  const refreshPoiOptions = () => {
    poiSel.innerHTML = state.poi.length
      ? state.poi.map(p => `<option value="${p.id}">${(POI_TYPE_META[p.type] || POI_TYPE_META.other).icon} ${esc(p.label || (POI_TYPE_META[p.type] || POI_TYPE_META.other).label)}</option>`).join('')
      : `<option value="">No places pinned yet</option>`;
  };
  refreshPoiOptions();

  const addrInput = el('input', { type: 'text', placeholder: 'Search a name or address, e.g. Islington United Church' });
  // GAL-53: live suggestions. selectedPlaceRef holds a picked suggestion so the
  // attach uses its exact coordinates instead of re-geocoding the typed text.
  const suggestBox = el('div', { className: 'attach-suggest' });
  suggestBox.hidden = true;
  const selectedPlaceRef = { value: null };
  const sessionToken = newSearchSession(); // GAL-53: one Search Box session per composer
  let suggestTimer = null, suggestItems = [], suggestIdx = -1;
  const closeSuggest = () => { suggestBox.hidden = true; suggestBox.innerHTML = ''; suggestItems = []; suggestIdx = -1; };
  const updateSuggestActive = () => { [...suggestBox.children].forEach((c, i) => c.classList.toggle('active', i === suggestIdx)); };
  // A Search Box suggestion has a mapbox_id but no coordinates yet; retrieve
  // them on pick. A classic-geocoder fallback item already carries lng/lat.
  const pickSuggestion = async (p) => {
    addrInput.value = p.label;
    selectedPlaceRef.value = null;
    closeSuggest();
    addrInput.focus();
    if (p.lng != null && p.lat != null) { selectedPlaceRef.value = p; return; }
    if (p.mapbox_id) {
      const full = await searchBoxRetrieve(p.mapbox_id, sessionToken);
      // Apply only if the field still shows this pick (user did not keep typing).
      if (full && addrInput.value.trim() === p.label.trim()) selectedPlaceRef.value = full;
    }
  };
  const runSuggest = async () => {
    const q = addrInput.value.trim();
    selectedPlaceRef.value = null; // typing invalidates a prior pick
    if (q.length < 3) { closeSuggest(); return; }
    const places = await geocodeSuggest(q, sessionToken);
    if (addrInput.value.trim() !== q) return; // a newer keystroke superseded this
    if (!places.length) { closeSuggest(); return; }
    suggestItems = places; suggestIdx = -1;
    suggestBox.innerHTML = '';
    places.forEach(p => {
      const opt = el('button', { type: 'button', className: 'attach-suggest-item', textContent: p.label });
      opt.addEventListener('mousedown', (e) => { e.preventDefault(); pickSuggestion(p); });
      suggestBox.append(opt);
    });
    suggestBox.hidden = false;
  };
  addrInput.addEventListener('input', () => { clearTimeout(suggestTimer); suggestTimer = setTimeout(runSuggest, 250); });
  // GAL-55: own the Enter key. Without this the global .feedback-compose Enter
  // delegate clicked the first button in the composer, which is now a
  // suggestion button, so Enter never attached and the address was lost. Enter
  // picks the highlighted suggestion when the list is open, otherwise attaches;
  // stopPropagation keeps the global delegate from misfiring.
  addrInput.addEventListener('keydown', (e) => {
    if (!suggestBox.hidden && suggestItems.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); suggestIdx = (suggestIdx + 1) % suggestItems.length; updateSuggestActive(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); suggestIdx = (suggestIdx - 1 + suggestItems.length) % suggestItems.length; updateSuggestActive(); return; }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pickSuggestion(suggestItems[suggestIdx >= 0 ? suggestIdx : 0]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirmBtn.click(); }
  });
  const typeSel = el('select', { className: 'attach-select' });
  typeSel.innerHTML = Object.entries(POI_TYPE_META).map(([k, v]) => `<option value="${k}">${v.icon} ${esc(v.label)}</option>`).join('');
  typeSel.value = 'work';
  const newWrap = el('div', { className: 'attach-new-wrap' }, addrInput, suggestBox, typeSel);

  const applyMode = () => {
    const isNew = modeSel.value === 'new';
    poiSel.style.display = isNew ? 'none' : '';
    newWrap.style.display = isNew ? '' : 'none';
  };
  modeSel.addEventListener('change', applyMode);
  applyMode();

  const statusEl = el('div', { className: 'feedback-status' });
  const confirmBtn = el('button', { type: 'button', textContent: 'Attach' });
  confirmBtn.addEventListener('click', () => attachPlace(item, { modeSel, poiSel, addrInput, typeSel, statusEl, confirmBtn, selectedPlaceRef }));

  const hint = el('div', { className: 'attach-hint', textContent: 'Add as many places as you like (school, work, gym). The form stays open so you can add another.' });
  composer.append(modeSel, poiSel, newWrap, confirmBtn, statusEl, hint);
  addBtn.addEventListener('click', () => {
    if (composer.hidden) { refreshPoiOptions(); composer.hidden = false; attachComposerOpenFor = item.mls; }
    else { composer.hidden = true; attachComposerOpenFor = null; }
  });
  container.append(addBtn, composer);
}

async function attachPlace(item, ui) {
  if (!state.activePerson) { showFeedbackStatus(ui.statusEl, 'Select who you are first.', true); return; }
  ui.confirmBtn.disabled = true;
  try {
    let body;
    if (ui.modeSel.value === 'new') {
      const query = ui.addrInput.value.trim();
      if (!query) { showFeedbackStatus(ui.statusEl, 'Enter a name or address.', true); return; }
      // Use the picked suggestion's exact coordinates when there is one (GAL-53),
      // otherwise geocode the typed text.
      let place = ui.selectedPlaceRef && ui.selectedPlaceRef.value;
      if (!place) {
        showFeedbackStatus(ui.statusEl, 'Looking up address…', false);
        place = await geocodePlace(query);
      }
      if (!place) { showFeedbackStatus(ui.statusEl, 'No place found for that name or address.', true); return; }
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
    attachComposerOpenFor = item.mls; // keep the composer open so another place can be added (GAL-55)
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

// GAL-66: change an attached place's category (and thus its icon) after adding.
// Type lives on the shared POI pin, so this updates it everywhere the place
// appears (list, map pin, other listings it is attached to).
async function updatePoiType(item, poiId, type) {
  try {
    const res = await fetch('/api/poi/update', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: poiId, type }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || 'update failed');
    await reloadAfterAttachmentChange(item);
    refreshPoiLayer();
  } catch (err) { console.error(err); alert('Could not update the category: ' + err.message); }
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
  if (f?.status === 'rejected') return MAP_COLORS.rejectedPin;
  const total = item.fit?.total || 8;
  return fitRatioColor((item.fit?.met ?? 0) / total);
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
  if (!state.mapReady || !state.map.getSource('clusters')) return; // guard mid style-switch
  const fc = emptyFC();
  state.clusters.forEach((c, idx) => {
    if (c.lat == null || c.lng == null) return;
    const b = c.bounds;
    fc.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
      properties: {
        count: c.count, radius: clusterRadius(c.count), clusterIdx: idx,
        // Fit colour from the cluster's known contents; slate when a big
        // cluster carries no inline listings (nothing to colour by).
        color: (c.listings && c.listings.length) ? clusterFitColor(c.listings) : MAP_COLORS.fitRejected,
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
  inner.dataset.mlsList = listings.map(l => l.mls).join(','); // for in-place refresh after a mini-card write
  listings.forEach(item => inner.appendChild(buildMiniCard(item)));
  const cnt = $('clusterPopupCount');
  if (cnt) cnt.textContent = `${listings.length} listings here`;
  $('clusterPopup').hidden = false;
  state.clusterPopupOpen = true;
}
function closeClusterPopup() { const p = $('clusterPopup'); if (p) { p.hidden = true; } state.clusterPopupOpen = false; }
function buildMiniCard(item) {
  const card = document.createElement('div');
  card.className = 'mini-card';
  card.dataset.mls = item.mls;

  // The "open the full card" region: everything except the interactive footer.
  const open = document.createElement('div');
  open.className = 'mini-open';
  const thumb = miniFieldVisible('thumb')
    ? (item.image
        ? `<img class="mini-thumb" src="${esc(item.image)}" alt="" loading="lazy" />`
        : `<div class="mini-thumb mini-thumb-empty">🏠</div>`)
    : '';
  const stat = [item.beds && item.beds + ' bd', item.baths != null && num(item.baths) + ' ba', item.sqft && num(item.sqft) + ' sqft'].filter(Boolean).join(' · ');
  const feedbackList = state.feedback[item.mls] || [];
  const byPerson = new Map(feedbackList.map(f => [f.person_id, f]));
  const chips = state.people.length ? state.people.map(p => groupSentimentChip(p, byPerson.get(p.id) || null)).join('') : '';
  let body = '<div class="mini-body">';
  if (miniFieldVisible('price')) body += `<div class="mini-price">${esc(pillLabel(item) || 'Price n/a')}</div>`;
  if (miniFieldVisible('address')) body += `<div class="mini-addr">${esc(item.address || '')}</div>`;
  if (miniFieldVisible('stat') && stat) body += `<div class="mini-stat">${esc(stat)}</div>`;
  if (miniFieldVisible('fit') && item.fit) body += `<div class="mini-fit">Fit ${item.fit.met}/${item.fit.total}</div>`;
  if (miniFieldVisible('chips') && chips) body += `<div class="mini-chips">${chips}</div>`;
  body += '</div>';
  open.innerHTML = thumb + body;
  // stopPropagation so this tap does not also reach the global click-outside
  // listener, which would otherwise immediately close the card it just opened.
  open.addEventListener('click', e => { e.stopPropagation(); closeClusterPopup(); showMapCard(item); });
  card.appendChild(open);

  // Interactive footer: editable stars + inline note, active-person attributed,
  // standard write paths. Only rendered if at least one is enabled.
  if (miniFieldVisible('myRating') || miniFieldVisible('note')) {
    const foot = document.createElement('div');
    foot.className = 'mini-actions';
    foot.addEventListener('click', e => e.stopPropagation()); // never opens the card
    if (miniFieldVisible('myRating')) foot.appendChild(buildMiniStars(item));
    if (miniFieldVisible('note')) foot.appendChild(buildMiniNote(item));
    card.appendChild(foot);
  }
  return card;
}
// Editable rating stars for a mini-card (same write path + attribution as the
// grid inline stars). Re-renders in place after a write and refreshes the views.
function buildMiniStars(item) {
  const wrap = document.createElement('div');
  wrap.className = 'mini-stars';
  const render = () => {
    const r = personFeedbackFor(item.mls, state.activePerson)?.rating ?? 0;
    wrap.innerHTML = '';
    for (let s = 1; s <= 5; s++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gr-star' + (s <= r ? ' on' : '');
      b.textContent = '★';
      b.title = `Rate ${s} star${s === 1 ? '' : 's'}`;
      b.addEventListener('click', async e => {
        e.stopPropagation();
        if (!state.activePerson) { alert('Select who you are (top right) first.'); return; }
        try {
          await postFeedback({ person_id: state.activePerson, listing_id: item.mls, action_type: 'rating', rating: s });
          Object.assign(state.feedback, await fetchFeedback([item.mls]));
          render();
          applyFiltersAndRender(); // updates pills/grid; no refit (item 7)
        } catch (err) { alert('Could not set rating: ' + err.message); }
      });
      wrap.appendChild(b);
    }
  };
  render();
  return wrap;
}
// Inline "Add a note" for a mini-card. A .feedback-compose so the global
// Enter-to-submit handler applies. Active-person attributed.
function buildMiniNote(item) {
  const wrap = document.createElement('div');
  wrap.className = 'mini-note';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mini-note-btn secondary';
  btn.textContent = '📝 Note';
  const box = document.createElement('div');
  box.className = 'feedback-compose mini-note-box';
  box.hidden = true;
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Add a note…';
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Save';
  const status = document.createElement('div');
  status.className = 'feedback-status';
  save.addEventListener('click', async e => {
    e.stopPropagation();
    if (!state.activePerson) { showFeedbackStatus(status, 'Select who you are first.', true); return; }
    const note = input.value.trim();
    if (!note) return;
    try {
      await postFeedback({ person_id: state.activePerson, listing_id: item.mls, action_type: 'note', note });
      Object.assign(state.feedback, await fetchFeedback([item.mls]));
      input.value = '';
      box.hidden = true;
      applyFiltersAndRender();
    } catch (err) { showFeedbackStatus(status, err.message, true); }
  });
  btn.addEventListener('click', e => { e.stopPropagation(); box.hidden = !box.hidden; if (!box.hidden) input.focus(); });
  box.append(input, save, status);
  wrap.append(btn, box);
  return wrap;
}

// ─── Saved draw areas: drawing, saving, toggling ────────────────────────────────
function renderDrawLayer() {
  if (!state.mapReady || !state.map.getSource('draw')) return; // guard mid style-switch
  const fc = emptyFC();
  // Every currently-active saved area, plus the polygon being drawn right now.
  // GAL-63: carry the include/exclude kind so the fill/line pick red vs blue.
  activeAreas().forEach(area => {
    fc.features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [area.polygon] },
      properties: { kind: isExcludeArea(area) ? 'exclude' : 'include' } });
  });
  if (state.drawCurrent.length >= 2) {
    fc.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: state.drawCurrent }, properties: {} });
  }
  state.drawCurrent.forEach(pt => fc.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: pt }, properties: {} }));
  state.map.getSource('draw').setData(fc);
}
function addDrawVertex(lngLat) {
  state.drawCurrent.push([lngLat.lng, lngLat.lat]);
  renderDrawLayer();
  updateDrawToolbar();
}
function undoDrawVertex() {
  state.drawCurrent.pop();
  renderDrawLayer();
  updateDrawToolbar();
}
// GAL-63: the closed ring waiting to be saved, held while the save modal is open.
let pendingAreaRing = null;

// Finish = open the save modal (name + include/exclude radios). Replaces the
// old prompt() + OK/Cancel confirm, which was not user friendly.
function finishPolygon() {
  if (state.drawCurrent.length < 3) { updateDrawToolbar(); return; }
  if (!state.activePerson) { alert('Select who you are ("I am", top right) before saving an area.'); return; }
  const ring = state.drawCurrent.slice();
  ring.push(ring[0]); // close the ring (first point == last)
  openAreaSaveModal(ring);
}

function openAreaSaveModal(ring) {
  pendingAreaRing = ring;
  const nameEl = $('areaSaveName');
  if (nameEl) nameEl.value = 'Area ' + (state.savedAreas.length + 1);
  const inc = document.querySelector('input[name="areaKind"][value="include"]');
  if (inc) inc.checked = true;
  const status = $('areaSaveStatus'); if (status) status.textContent = '';
  $('areaSaveOverlay').hidden = false;
  $('areaSaveModal').hidden = false;
  if (nameEl) { nameEl.focus(); nameEl.select(); }
}

// Cancel just closes the modal and keeps the in-progress polygon, so the user
// can adjust points (Undo) or Finish again.
function closeAreaSaveModal() {
  $('areaSaveOverlay').hidden = true;
  $('areaSaveModal').hidden = true;
  pendingAreaRing = null;
}

async function saveDrawnArea() {
  if (!pendingAreaRing) return;
  const name = ($('areaSaveName').value || '').trim() || ('Area ' + (state.savedAreas.length + 1));
  const kindEl = document.querySelector('input[name="areaKind"]:checked');
  const kind = kindEl && kindEl.value === 'exclude' ? 'exclude' : 'include';
  const status = $('areaSaveStatus');
  const ring = pendingAreaRing;
  try {
    const res = await fetch('/api/areas', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_id: state.activePerson, name, polygon: ring, kind }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || 'save failed');
    closeAreaSaveModal();
    state.drawCurrent = [];
    exitDrawModeQuietly();
    await loadAreas();
    setAreaActive(data.id, true); // the creator sees the new area on + filtering
    renderAreaLayers();
    renderDrawLayer();
    onDrawAreaChanged();
  } catch (e) {
    if (status) showFeedbackStatus(status, 'Could not save the area: ' + e.message, true);
    else alert('Could not save the area: ' + e.message);
  }
}
function toggleDrawMode() { if (state.drawMode) cancelDrawing(); else enterDrawMode(); }
function enterDrawMode() {
  if (!state.mapReady) { alert('The map is not available, so drawing an area is not possible here.'); return; }
  if (!state.activePerson) { alert('Select who you are ("I am", top right) before drawing an area.'); return; }
  // One open map panel at a time: entering draw mode closes any open panel.
  closeMapDetailPanels();
  state.drawMode = true;
  document.body.classList.add('draw-mode');
  if (state.map) state.map.getCanvas().style.cursor = 'crosshair';
  updateDrawToolbar();
}
// Cancel = discard the in-progress polygon and leave draw mode. Saved areas are
// the model now, so there is no unsaved session polygon to preserve.
function cancelDrawing() {
  state.drawCurrent = [];
  exitDrawModeQuietly();
  renderDrawLayer();
}
function exitDrawModeQuietly() {
  state.drawMode = false;
  document.body.classList.remove('draw-mode');
  if (state.map) state.map.getCanvas().style.cursor = '';
  updateDrawToolbar();
}

// Load the household's saved areas (shared) from the server.
async function loadAreas() {
  try {
    const res = await fetch('/api/areas', { headers: authHeaders() });
    const data = await res.json();
    state.savedAreas = (res.ok && Array.isArray(data.areas)) ? data.areas : [];
  } catch (_) { state.savedAreas = []; }
}
// One Layers-menu row per saved area: an on/off toggle (visible + filtering)
// and a delete button, with the creator's name as attribution.
function renderAreaLayers() {
  const list = $('areaLayerList');
  if (!list) return;
  list.innerHTML = '';
  state.savedAreas.forEach(area => {
    const row = document.createElement('div');
    row.className = 'area-row';
    const label = document.createElement('label');
    label.className = 'chip area-chip';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isAreaActive(area.id);
    cb.addEventListener('change', () => {
      setAreaActive(area.id, cb.checked);
      renderDrawLayer();
      onDrawAreaChanged();
      // Turning an area on frames the polygon boundary itself.
      if (cb.checked) fitMapToArea(area);
    });
    label.appendChild(cb);
    // GAL-63: a coloured dot (red = exclude, blue = include) and, for exclude
    // zones, an explicit tag so their subtractive effect is obvious in the list.
    const dot = document.createElement('span');
    dot.className = 'area-dot';
    dot.style.background = isExcludeArea(area) ? MAP_COLORS.drawExclude : MAP_COLORS.blue;
    label.appendChild(dot);
    label.appendChild(document.createTextNode(' ' + area.name));
    if (isExcludeArea(area)) {
      const tag = document.createElement('span');
      tag.className = 'area-exclude-tag';
      tag.textContent = ' exclude';
      label.appendChild(tag);
    }
    if (area.created_by_name) {
      const by = document.createElement('span');
      by.className = 'area-by';
      by.textContent = ' · ' + area.created_by_name;
      label.appendChild(by);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'area-del';
    del.title = 'Delete this area for everyone';
    del.textContent = '✕';
    del.addEventListener('click', () => deleteArea(area));
    row.appendChild(label);
    row.appendChild(del);
    list.appendChild(row);
  });
}
async function deleteArea(area) {
  if (!window.confirm(`Delete the saved area "${area.name}"? This removes it for everyone.`)) return;
  try {
    const res = await fetch('/api/areas', {
      method: 'DELETE', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: area.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || 'delete failed');
    setAreaActive(area.id, false);
    await loadAreas();
    renderAreaLayers();
    renderDrawLayer();
    onDrawAreaChanged();
  } catch (e) {
    alert('Could not delete the area: ' + e.message);
  }
}
// Turn every active area off (used by the indicator Clear button and Reset).
// Areas are not deleted, just deactivated, so they can be toggled back on.
function deactivateAllAreas() {
  saveActiveAreaIds([]);
  renderAreaLayers();
  renderDrawLayer();
  onDrawAreaChanged();
}
function onDrawAreaChanged() {
  updateDrawIndicator();
  updateFilterBadge(); // enabled drawn areas count toward the active-filter badge
  // Sample Data is re-fetched so the Repliers `map` param filters server-side;
  // POC filters client-side, so a re-render is enough. Neither re-centers the
  // map (the areas may be anywhere; the user is looking at the current view).
  if (currentSource() === 'repliers') reloadListingsPreservingMapView().catch(showError);
  else applyFiltersAndRender();
}
function updateDrawIndicator() {
  const ind = $('drawIndicator');
  if (!ind) return;
  const active = state.savedAreas.filter(a => isAreaActive(a.id));
  ind.hidden = active.length === 0;
  const label = $('drawIndicatorLabel');
  if (label) {
    // Name the active areas when few, so a filtered view is always explicable.
    if (active.length === 0) label.textContent = '';
    else if (active.length <= 2) label.textContent = 'Filtering to ' + active.map(a => a.name).join(' + ');
    else label.textContent = `Filtering to ${active.length} areas`;
  }
}
function updateDrawToolbar() {
  const btn = $('drawAreaBtn');
  if (btn) {
    // Icon-only button: toggle the active (blue) state and the title/label, but
    // never overwrite the SVG glyph with textContent.
    btn.classList.toggle('active', state.drawMode);
    btn.title = state.drawMode ? 'Drawing… tap the map to add points' : 'Draw area';
    const label = btn.querySelector('.ctrl-label');
    if (label) label.textContent = state.drawMode ? 'Drawing…' : 'Draw area';
  }
  const bar = $('drawToolbar');
  if (bar) bar.hidden = !state.drawMode;
  const finish = $('drawFinishBtn');
  if (finish) finish.disabled = state.drawCurrent.length < 3;
  const undo = $('drawUndoBtn');
  if (undo) undo.disabled = state.drawCurrent.length === 0;
  const hint = $('drawHint');
  if (hint) hint.textContent = state.drawCurrent.length
    ? `${state.drawCurrent.length} point${state.drawCurrent.length === 1 ? '' : 's'} placed, then Finish`
    : 'Tap the map to add points';
}

// Individual listings render as info pills (HTML markers) that collapse into
// fit-coloured count circles wherever they would materially overlap at the
// current zoom, so pills never pile up. Recomputed on zoom via
// schedulePillRelayout. mapboxgl.Marker anchors each element to its lng/lat.
let _pillMarkers = [];
function clearPillMarkers() {
  _pillMarkers.forEach(m => m.remove());
  _pillMarkers = [];
}
function renderPillMarkers(list) {
  if (!state.mapReady || !state.map) return;
  clearPillMarkers();
  const project = it => state.map.project([it.lng, it.lat]);
  // POC clustering off -> one pill per listing, no overlap-collapse.
  const groups = pocClusteringOn()
    ? collapsePillGroups(list, project)
    : list.filter(it => it.lat != null && it.lng != null).map(it => ({ items: [it] }));
  groups.forEach(g => {
    let el;
    if (g.items.length === 1) {
      const item = g.items[0];
      el = document.createElement('button');
      el.type = 'button';
      el.className = 'map-pill';
      el.dataset.mls = item.mls; // lets a hovered Combined card highlight this pin
      el.style.background = markerColor(item);
      el.textContent = pillLabel(item);
      el.title = item.address || '';
      el.addEventListener('click', ev => {
        ev.stopPropagation();
        if (state.drawMode) return;
        closeOutsideDetailsPanels(document.body);
        showMapCard(item);
      });
    } else {
      const items = g.items.slice();
      el = document.createElement('button');
      el.type = 'button';
      el.className = 'map-pill-cluster';
      el.style.background = clusterFitColor(items);
      el.textContent = String(items.length);
      el.title = items.length + ' listings here';
      el.addEventListener('click', ev => {
        ev.stopPropagation();
        if (state.drawMode) return;
        closeOutsideDetailsPanels(document.body);
        openListingChooser(items);
      });
    }
    const anchor = g.items[0];
    _pillMarkers.push(new mapboxgl.Marker({ element: el }).setLngLat([anchor.lng, anchor.lat]).addTo(state.map));
  });
  // GAL-86: remember the zoom this layout was built at. Overlap-collapse groups
  // by on-screen pixel distance, which only changes with zoom. A pure pan keeps
  // every pairwise pixel gap identical, so the grouping is unchanged and Mapbox
  // has already repositioned each marker by its lng/lat. schedulePillRelayout
  // uses this to skip the rebuild on pan and only rebuild on an actual zoom
  // change, which is what removes the pan flicker.
  _pillLayoutZoom = state.map.getZoom();
}
let _pillRelayoutTimer = null;
let _pillLayoutZoom = null;
function schedulePillRelayout() {
  clearTimeout(_pillRelayoutTimer);
  _pillRelayoutTimer = setTimeout(() => {
    if (clusteringActive() || !state.pillListings || !state.pillListings.length) return;
    // Pure pan (zoom unchanged): markers are already in place, no regroup needed.
    // Rebuilding here is what made the price pills flicker while dragging.
    if (_pillLayoutZoom != null && Math.abs(state.map.getZoom() - _pillLayoutZoom) < 1e-3) return;
    renderPillMarkers(state.pillListings);
  }, 150);
}

function refreshMap(list) {
  if (!state.mapReady) return;
  // During a basemap style switch the custom sources are destroyed until
  // style.load re-adds them (applyMapStyle). If a data load lands in that
  // window, bail rather than call setData on a missing source; style.load then
  // re-renders. (listings + clusters are added together, so one check covers.)
  if (!state.map.getSource('listings')) return;
  // Only refit the viewport when an explicit user action asked for it (initial
  // load, Apply/Reset filters). refreshMap runs on EVERY re-render, including
  // after a rating/note write, so refitting here by default would yank the map
  // back to fit-all every time someone leaves feedback. One-shot flag: consumed
  // each call so it never leaks into an incidental re-render. Area selection
  // does its own polygon fit (fitMapToArea), not this listings fit.
  const shouldFit = state.fitMapNext === true;
  state.fitMapNext = false;
  closeMapCard();
  closeClusterPopup();
  if (clusteringActive()) {
    // Viewport-driven server clusters: no pill markers, no auto-fit (that would
    // fight the user's zoom). Render current clusters, then refetch this view.
    clearPillMarkers();
    state.pillListings = [];
    state.map.getSource('listings').setData(emptyFC());
    renderClusterLayer();
    refetchClustersForViewport();
    requestAnimationFrame(() => state.map?.resize());
    return;
  }
  // Individual listings as info pills (POC always; Sample Data when clustering
  // is off). The GeoJSON listings/clusters sources stay empty here; pills and
  // their collapse circles are HTML markers.
  state.map.getSource('clusters').setData(emptyFC());
  state.map.getSource('listings').setData(emptyFC());
  state.pillListings = list;
  const bounds = [];
  list.forEach(item => { if (item.lat != null && item.lng != null) bounds.push([item.lng, item.lat]); });
  const b = lngLatBoundsOf(bounds);
  if (shouldFit && b) state.map.fitBounds(b, { padding: 40, maxZoom: 15 });
  // Collapse against the just-set view. fitBounds animates; render once now for
  // an immediate result, and moveend (schedulePillRelayout) refines it after.
  renderPillMarkers(list);
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
  const cardEl = $('mapCard');
  cardEl.hidden = false;
  // Always start a newly opened card scrolled to the top. The card element is
  // reused across opens (swapping only its inner content), so without this the
  // previous card's scroll position carries over -- most visibly when a rating
  // change drops the current card out of the filtered set and the next one
  // loads into the same reused container. Reset both the scroll container and
  // its inner in case either holds the offset.
  cardEl.scrollTop = 0;
  inner.scrollTop = 0;
  state.openMapItem = item;
  // Zoom to pin (guarded: the card also opens from the list/chooser where the
  // map may not be initialised, e.g. if WebGL is unavailable).
  if (state.map && item.lng != null && item.lat != null) {
    state.map.easeTo({ center: [item.lng, item.lat], zoom: Math.max(state.map.getZoom(), 12) });
  }
}

function closeMapCard() {
  $('mapCard').hidden = true;
  state.openMapItem = null;
}

// A user-initiated card dismiss (X button, tap outside). Unlike closeMapCard,
// this re-runs the filters so a listing that was pinned visible past a filter
// while its card was open (e.g. after rating under "No rating yet", GAL-48)
// drops out now. It must NOT be called from refreshMap: refreshMap already
// calls closeMapCard, and applyFiltersAndRender calls refreshMap, so wiring the
// re-filter into closeMapCard itself caused infinite recursion that left the
// map with no pins.
function dismissMapCard() {
  const wasOpen = state.openMapItem != null;
  closeMapCard();
  if (wasOpen) applyFiltersAndRender();
}

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
// The three collapsible map panels. One-open-at-a-time is enforced across these
// plus the draw-mode toolbar (see setupExclusivePanels + enterDrawMode).
const MAP_DETAIL_PANEL_IDS = ['filterbox', 'mapLayersPanel', 'mapLegend'];
function closeMapDetailPanels(exceptId) {
  MAP_DETAIL_PANEL_IDS.forEach(id => { if (id !== exceptId) { const el = $(id); if (el) el.open = false; } });
}
// Exclusive panels: opening any one map panel closes the others and cancels
// draw mode, so at most one panel/toolbar is open at a time. Consistent with the
// existing click-outside-to-dismiss rule. The `toggle` event fires on open and
// close; only act on open. Closing the siblings fires their toggle events with
// open=false, which the guard ignores, so there is no loop.
function setupExclusivePanels() {
  MAP_DETAIL_PANEL_IDS.forEach(id => {
    const d = $(id);
    d?.addEventListener('toggle', () => {
      if (!d.open) return;
      closeMapDetailPanels(id);
      if (state.drawMode) cancelDrawing();
    });
  });
}

function closeOutsideDetailsPanels(clickTarget) {
  [$('filterbox'), $('mapLayersPanel'), $('mapLegend')].forEach(el => {
    if (el && el.open && !el.contains(clickTarget)) el.open = false;
  });
}

function closeOutsidePanels(clickTarget) {
  closeOutsideDetailsPanels(clickTarget);
  const mapCard = $('mapCard');
  if (mapCard && !mapCard.hidden && !mapCard.contains(clickTarget)) dismissMapCard();
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

  // GAL-67: group discussion thread with @mentions
  buildDiscussion(node, item);

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

  // GAL-58: direct link to Google Maps at the property, coordinates first for
  // accuracy, address as a fallback. Opens the Maps app on mobile.
  const mapsBtn = node.querySelector('.card-maps-btn');
  if (mapsBtn) {
    const q = (item.lat != null && item.lng != null) ? `${item.lat},${item.lng}` : (item.address || '');
    if (q) mapsBtn.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
    else mapsBtn.style.display = 'none';
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

// ─── Combined view: viewport-linked cards + map ────────────────────────────────
// The visible set: already-filtered listings (filterByFeedback, so all active
// filters + enabled drawn areas apply) whose pins fall inside the current map
// viewport, in the current sort order. Re-derived on pan/zoom (moveend).
function listingsInViewport() {
  const all = sortListings(state.listings);
  if (!state.map || !state.mapReady || typeof state.map.getBounds !== 'function') return all;
  let b;
  try { b = state.map.getBounds(); } catch (_) { return all; }
  if (!b) return all;
  return all.filter(it => it.lat != null && it.lng != null && b.contains([it.lng, it.lat]));
}
function highlightPin(mls, on) {
  if (!mls) return;
  const sel = '.map-pill[data-mls="' + ((window.CSS && CSS.escape) ? CSS.escape(mls) : mls) + '"]';
  const el = document.querySelector(sel);
  if (el) el.classList.toggle('map-pill-hi', on);
}
function renderCombined() {
  if (!state.drawerOn) return; // desktop Both or mobile Map drawer
  const container = $('combinedCards');
  if (!container) return;
  const inView = listingsInViewport();
  container.innerHTML = '';
  inView.forEach(item => {
    const card = buildMiniCard(item); // the one mini-card component (also cluster popup + list)
    // Desktop nicety: hovering a card highlights its pin, when that pin is an
    // individual (un-clustered) pill. Clustered listings have no own pin, so
    // they simply do not highlight (see DECISIONS.md).
    card.addEventListener('mouseenter', () => highlightPin(item.mls, true));
    card.addEventListener('mouseleave', () => highlightPin(item.mls, false));
    container.appendChild(card);
  });
  const countEl = $('combinedCount');
  if (countEl) countEl.textContent = `${inView.length} of ${state.listings.length} listings`;
}

// Mobile bottom-drawer drag: the handle snaps the drawer between a collapsed
// strip and an expanded taller list. Card scrolling (horizontal, collapsed) is
// native overflow inside the drawer, so it never reaches the map; map pan
// happens on the map area above the drawer.
function initDrawerDrag() {
  const handle = $('combinedHandle');
  const panel = $('combinedPanel');
  if (!handle || !panel) return;
  let startY = null, dragging = false;
  const isMobile = () => window.matchMedia('(max-width:699px)').matches;
  const setExpanded = expand => {
    panel.classList.toggle('expanded', expand);
    panel.classList.toggle('collapsed', !expand);
  };
  handle.addEventListener('pointerdown', e => {
    if (!isMobile()) return;
    // Do not hijack the sort control that lives in the header: let it open.
    if (e.target.closest('.sort-inline, .sort-control')) return;
    startY = e.clientY; dragging = true;
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
  });
  handle.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
    const dy = e.clientY - startY;
    if (dy < -30) setExpanded(true);          // dragged up -> expand
    else if (dy > 30) setExpanded(false);     // dragged down -> collapse
    else setExpanded(!panel.classList.contains('expanded')); // tap -> toggle
  });
  handle.addEventListener('pointercancel', () => { dragging = false; });
}

// ─── Grid view (desktop): spreadsheet + selection + bulk commands + export ──────
function numOrNull(v) { return (v == null || v === '' || isNaN(Number(v))) ? null : Number(v); }
function sentimentWordFor(item) {
  const feedbackByPerson = new Map((state.feedback[item.mls] || []).map(f => [f.person_id, f]));
  const buyers = state.people.filter(p => p.role === 'buyer');
  return buyerHeadline(buyers, feedbackByPerson).word;
}
function gridCommuteVal(i) { return i.poc?.goTotal ?? i.goMin ?? null; }
function gridLatestNote(i) { return personFeedbackFor(i.mls, state.activePerson)?.note || ''; }
function gridAttachSummary(i) {
  return (state.placeAttachments[i.mls] || []).map(a =>
    `${(POI_TYPE_META[a.poi_type] || POI_TYPE_META.other).icon} ${a.poi_label || (POI_TYPE_META[a.poi_type] || POI_TYPE_META.other).label}${a.drive_minutes != null ? ' (' + a.drive_minutes + ' min)' : ''}`).join('; ');
}
// Data columns (checkbox + thumbnail are rendered separately). `get` returns the
// raw value (numbers stay numbers for sort + export typing); `fmt` is the display
// string; `type` drives export cell typing and numeric alignment. Every field on
// the property card is available here (card parity); `defaultHidden` keeps the
// default grid lean, the rest are one click away in the column picker. `editable`
// marks the one editable cell (the shared potential offer price). Group ownership
// (for admin permissions) is defined server-side in COLUMN_GROUPS by key.
function gridColumns() {
  const rating = i => personFeedbackFor(i.mls, state.activePerson)?.rating ?? null;
  return [
    { key: 'address', label: 'Address', type: 'text', get: i => i.address || '', fmt: i => i.address || '', sortable: true },
    { key: 'listPrice', label: 'List price', type: 'number', get: i => numOrNull(i.price), fmt: i => money(i.price) || '', sortable: true },
    { key: 'potentialPrice', label: 'Potential offer price', type: 'number', editable: true, get: i => i.potentialPurchasePrice?.price ?? null, fmt: i => money(i.potentialPurchasePrice?.price) || '', sortable: true },
    { key: 'beds', label: 'Beds', type: 'number', get: i => numOrNull(i.bedsNum ?? i.beds), fmt: i => String(i.beds ?? i.bedsNum ?? ''), sortable: true },
    { key: 'baths', label: 'Baths', type: 'number', get: i => numOrNull(i.baths), fmt: i => i.baths != null ? num(i.baths) : '', sortable: true },
    { key: 'sqft', label: 'Sqft', type: 'number', get: i => numOrNull(i.sqft), fmt: i => i.sqft ? num(i.sqft) : '', sortable: true },
    { key: 'fit', label: 'Fit', type: 'number', get: i => i.fit?.met ?? null, fmt: i => i.fit ? `${i.fit.met}/${i.fit.total}` : '', sortable: true },
    { key: 'myRating', label: 'My rating', type: 'number', get: i => rating(i), fmt: i => { const r = rating(i); return r != null ? r + '★' : ''; }, sortable: true },
    { key: 'group', label: 'Group', type: 'text', get: i => sentimentWordFor(i), fmt: i => sentimentWordFor(i), sortable: true },
    { key: 'note', label: 'Latest note', type: 'text', defaultHidden: true, get: i => gridLatestNote(i), fmt: i => gridLatestNote(i), sortable: true },
    { key: 'pit', label: 'Monthly PIT', type: 'number', get: i => effectivePitNum(i) ?? null, fmt: i => money(effectivePitNum(i)) || '', sortable: true },
    { key: 'close', label: 'Cost to close', type: 'number', get: i => effectiveDueNum(i) ?? null, fmt: i => money(effectiveDueNum(i)) || '', sortable: true },
    { key: 'condoFees', label: 'Condo fees', type: 'number', defaultHidden: true, get: i => numOrNull(i.condoFeeNum), fmt: i => i.condoFeeNum != null ? money(i.condoFeeNum) : '', sortable: true },
    { key: 'highway', label: 'Highway (km)', type: 'number', get: i => numOrNull(i.highwayKm), fmt: i => i.highwayKm != null ? num(i.highwayKm) : '', sortable: true },
    { key: 'highwayName', label: 'Nearest highway', type: 'text', defaultHidden: true, get: i => i.nearestHighway || '', fmt: i => i.nearestHighway || '', sortable: true },
    { key: 'commute', label: 'GO total (min)', type: 'number', get: i => numOrNull(gridCommuteVal(i)), fmt: i => { const g = gridCommuteVal(i); return g != null ? num(g) : ''; }, sortable: true },
    { key: 'goStation', label: 'GO station', type: 'text', defaultHidden: true, get: i => i.goStation || '', fmt: i => i.goStation || '', sortable: true },
    { key: 'goDrive', label: 'GO drive (min)', type: 'number', defaultHidden: true, get: i => numOrNull(i.goMin), fmt: i => i.goMin != null ? num(i.goMin) : '', sortable: true },
    { key: 'goTrain', label: 'GO train (min)', type: 'number', defaultHidden: true, get: i => numOrNull(i.poc?.goTrain ?? i.goTrain), fmt: i => { const t = i.poc?.goTrain ?? i.goTrain; return t != null ? num(t) : ''; }, sortable: true },
    { key: 'attachments', label: 'Attached places', type: 'text', defaultHidden: true, get: i => gridAttachSummary(i), fmt: i => gridAttachSummary(i), sortable: false },
  ];
}
// Same filtered set as every view; grid header clicks set a local sort override,
// otherwise the shared global sort (sortListings) applies.
function gridRows() {
  const cols = gridColumns();
  if (!state.gridSort) return sortListings(state.listings);
  const col = cols.find(c => c.key === state.gridSort.key);
  if (!col) return sortListings(state.listings);
  const dir = state.gridSort.dir === 'asc' ? 1 : -1;
  const isNum = col.type === 'number';
  return [...state.listings].sort((a, b) => {
    let av = col.get(a), bv = col.get(b);
    if (isNum) { if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1; return (av - bv) * dir; }
    av = (av || '').toString().toLowerCase(); bv = (bv || '').toString().toLowerCase();
    return av < bv ? -dir : av > bv ? dir : 0;
  });
}
function toggleGridSort(key) {
  if (state.gridSort && state.gridSort.key === key) state.gridSort.dir = state.gridSort.dir === 'asc' ? 'desc' : 'asc';
  else state.gridSort = { key, dir: 'asc' };
  renderGrid();
}
function renderGrid() {
  if (state.activeView !== 'grid') return;
  const table = $('gridTable');
  if (!table) return;
  // Only the columns the active person is permitted to see AND has not hidden
  // for themselves. Admin-denied groups never appear (their data is not even in
  // the payload); personal hides are the member's own preference within that.
  const cols = visibleGridColumns();
  const rows = gridRows();
  // Drop any selection that filtered out of the visible set.
  const visible = new Set(rows.map(r => r.mls));
  [...state.gridSelection].forEach(mls => { if (!visible.has(mls)) state.gridSelection.delete(mls); });
  const allSelected = rows.length > 0 && rows.every(r => state.gridSelection.has(r.mls));
  let html = '<thead><tr>';
  html += `<th class="grid-th-sel"><input type="checkbox" id="gridSelectAll" ${allSelected ? 'checked' : ''} title="Select all visible" /></th>`;
  html += '<th class="grid-th-thumb"></th>';
  cols.forEach(c => {
    const active = state.gridSort && state.gridSort.key === c.key;
    const arrow = active ? (state.gridSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    html += `<th data-col="${c.key}" class="${c.sortable ? 'grid-th-sortable' : ''}${active ? ' grid-th-active' : ''}${c.type === 'number' ? ' grid-td-num' : ''}">${esc(c.label)}${arrow}</th>`;
  });
  html += '</tr></thead><tbody>';
  rows.forEach(item => {
    const sel = state.gridSelection.has(item.mls);
    html += `<tr data-mls="${esc(item.mls)}" class="${sel ? 'grid-row-sel' : ''}">`;
    html += `<td class="grid-td-sel"><input type="checkbox" class="grid-row-cb" ${sel ? 'checked' : ''} /></td>`;
    html += `<td class="grid-td-thumb">${item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy"/>` : '<span class="grid-thumb-empty">🏠</span>'}</td>`;
    cols.forEach(c => { html += gridCellHtml(c, item); });
    html += '</tr>';
  });
  html += '</tbody>';
  table.innerHTML = html;
  $('gridCount').textContent = `${rows.length} listing${rows.length === 1 ? '' : 's'}`;
  updateGridCommandBar();
  updateUndoButton();
}
// A grid cell. Two card-editable values render as inline editors here so they
// can be changed without opening the card: the active person's rating (stars)
// and the group's potential offer price (the only editable price anywhere).
// The address cell is clickable to open the full card (grid-td-address). List
// price and everything else are read-only.
function gridCellHtml(c, item) {
  if (c.key === 'myRating') {
    const r = personFeedbackFor(item.mls, state.activePerson)?.rating ?? 0;
    let stars = '';
    for (let s = 1; s <= 5; s++) {
      stars += `<button type="button" class="gr-star${s <= r ? ' on' : ''}" data-mls="${esc(item.mls)}" data-rate="${s}" title="Rate ${s} star${s === 1 ? '' : 's'}">★</button>`;
    }
    return `<td class="grid-td-rating">${stars}</td>`;
  }
  if (c.key === 'potentialPrice') {
    const val = item.potentialPurchasePrice?.price ?? null;
    const isPotential = item.potentialPurchasePrice != null;
    return `<td class="grid-td-num grid-td-price${isPotential ? ' has-potential' : ''}" data-mls="${esc(item.mls)}" tabindex="0" title="Click to set the group's potential offer price">${esc(money(val) || '—')}</td>`;
  }
  if (c.key === 'address') {
    return `<td class="grid-td-address" title="Open the full property card">${esc(c.fmt(item))}</td>`;
  }
  if (c.type === 'number') {
    return `<td class="grid-td-num">${esc(c.fmt(item))}</td>`;
  }
  // Free-text columns (note, attached places, GO station, nearest highway) can
  // be long: truncate with a full-value tooltip so one row cannot blow out the
  // column width.
  const val = c.fmt(item);
  return `<td class="grid-td-text"${val ? ` title="${esc(val)}"` : ''}>${esc(val)}</td>`;
}
// Inline single-property rating write (same path as the card's stars).
async function setInlineRating(mls, rating) {
  if (!state.activePerson) { alert('Select who you are (top right) first.'); return; }
  try {
    await postFeedback({ person_id: state.activePerson, listing_id: mls, action_type: 'rating', rating });
    Object.assign(state.feedback, await fetchFeedback([mls]));
    applyFiltersAndRender();
  } catch (e) { alert('Could not set rating: ' + e.message); }
}
// Inline edit of the group's potential purchase price (same endpoint as the
// card): a number input in the cell; Enter/blur saves, Escape cancels, blank
// clears back to list price.
function startPriceEdit(cell) {
  if (cell.querySelector('input')) return;
  if (!state.activePerson) { alert('Select who you are (top right) first.'); return; }
  const mls = cell.dataset.mls;
  const item = findListing(mls) || state.rawListings.find(x => x.mls === mls);
  if (!item) return;
  const input = document.createElement('input');
  // Text + numeric inputmode (not type=number) so commas can show while typing,
  // matching the card price editor (GAL-60). wirePriceInput keeps dataset.raw.
  input.type = 'text'; input.inputMode = 'numeric'; input.className = 'grid-price-input';
  const existing = item.potentialPurchasePrice != null ? String(item.potentialPurchasePrice.price) : '';
  input.value = existing ? formatThousands(existing) : '';
  input.dataset.raw = existing;
  input.placeholder = item.price != null ? formatThousands(String(item.price)) : 'price';
  wirePriceInput(input);
  cell.textContent = '';
  cell.appendChild(input);
  input.focus(); input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    if (save) {
      const v = (input.dataset.raw || input.value.replace(/[^\d]/g, '')).trim();
      try {
        if (v === '') {
          if (item.potentialPurchasePrice != null) {
            await fetch('/api/potential-purchase-prices', { method: 'DELETE', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ listing_id: mls }) });
          }
        } else {
          const price = Number(v);
          if (!price || price <= 0) { alert('Enter a positive number, or leave blank to clear.'); done = false; input.focus(); return; }
          await fetch('/api/potential-purchase-prices', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ person_id: state.activePerson, listing_id: mls, price }) });
        }
        await reloadAfterPotentialPriceChange(item); // reloads + re-renders the grid
        return;
      } catch (e) { alert('Could not save price: ' + e.message); }
    }
    renderGrid(); // cancel path: restore the cell
  };
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', e => e.stopPropagation());
}

function updateGridCommandBar() {
  const n = state.gridSelection.size;
  const bar = $('gridCommandBar');
  if (bar) bar.hidden = n === 0;
  const cnt = $('gridSelCount');
  if (cnt) cnt.textContent = `${n} selected`;
}
function gridToggleSelectAll(on) {
  const rows = gridRows();
  if (on) rows.forEach(r => state.gridSelection.add(r.mls));
  else state.gridSelection.clear();
  renderGrid();
}
function gridClearSelection() { state.gridSelection.clear(); renderGrid(); }

// ─── Personal column picker (grid header) ───────────────────────────────────────
// A member's own show/hide picks, within what the admin permits. Denied groups
// never appear here (their columns are not in permittedGridColumns). Persisted
// per person server-side so the choice follows the person across devices.
function toggleColumnPicker() {
  const menu = $('gridColsMenu');
  const btn = $('gridColsBtn');
  if (!menu) return;
  const willOpen = menu.hidden;
  if (willOpen) renderColumnPicker();
  menu.hidden = !willOpen;
  btn?.setAttribute('aria-expanded', String(willOpen));
}
function closeColumnPicker() {
  const menu = $('gridColsMenu');
  if (menu && !menu.hidden) { menu.hidden = true; $('gridColsBtn')?.setAttribute('aria-expanded', 'false'); }
}
function renderColumnPicker() {
  const menu = $('gridColsMenu');
  if (!menu) return;
  if (!state.activePerson) {
    menu.innerHTML = '<div class="grid-cols-empty">Select who you are ("I am", top right) to choose your columns.</div>';
    return;
  }
  const permitted = permittedGridColumns();
  const hidden = hiddenColumnsFor(state.activePerson);
  const rowHtml = c => `<label class="grid-cols-row"><input type="checkbox" class="grid-col-cb" data-col="${esc(c.key)}" ${hidden.has(c.key) ? '' : 'checked'} /> <span>${esc(c.label)}</span></label>`;
  let html = '<div class="grid-cols-title">Your columns</div>';
  columnGroupsList().forEach(g => {
    const cols = permitted.filter(c => groupKeyForColumn(c.key) === g.key);
    if (!cols.length) return;
    html += `<div class="grid-cols-group">${esc(g.label)}</div>`;
    cols.forEach(c => { html += rowHtml(c); });
  });
  // Columns outside the five permission groups (e.g. Attached places) under an
  // "Other" heading so they are still toggleable in the picker.
  const ungrouped = permitted.filter(c => groupKeyForColumn(c.key) == null);
  if (ungrouped.length) {
    html += '<div class="grid-cols-group">Other</div>';
    ungrouped.forEach(c => { html += rowHtml(c); });
  }
  menu.innerHTML = html;
  menu.querySelectorAll('.grid-col-cb').forEach(cb => cb.addEventListener('change', onColumnPick));
}
async function onColumnPick() {
  if (!state.activePerson) return;
  // Rebuild the hidden set from the checkboxes on screen, then preserve any
  // existing hides for columns not shown here (e.g. columns in a group the
  // admin later denied), so toggling one column never resurrects another.
  const shownKeys = new Set([...$('gridColsMenu').querySelectorAll('.grid-col-cb')].map(cb => cb.dataset.col));
  const hidden = [...$('gridColsMenu').querySelectorAll('.grid-col-cb')].filter(cb => !cb.checked).map(cb => cb.dataset.col);
  hiddenColumnsFor(state.activePerson).forEach(k => { if (!shownKeys.has(k)) hidden.push(k); });
  state.gridPrefs[state.activePerson] = { hidden_columns: hidden };
  renderGrid();
  try {
    await fetch('/api/grid-prefs', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_id: state.activePerson, hidden_columns: hidden }),
    });
  } catch (e) { console.error('grid-prefs save failed', e); }
}

// ─── Bulk-action safety: confirmation gate + session undo ──────────────────────
// Every bulk command routes through confirmBulk(), which names the exact action
// and count so the dialog doubles as a proofread of the action, not just a
// brake. It resolves true ONLY on an explicit Confirm click: Enter never
// confirms (the modal swallows Enter, and the Confirm button is never focused),
// so the fast keystroke rhythm that fires an accidental bulk cannot also confirm
// it.
let _bulkConfirmResolve = null;
function confirmBulk(message) {
  return new Promise(resolve => {
    _bulkConfirmResolve = resolve;
    $('bulkConfirmMsg').textContent = message;
    $('bulkConfirmOverlay').hidden = false;
    $('bulkConfirmModal').hidden = false;
    $('bulkConfirmCancel').focus(); // focus Cancel, never Confirm
  });
}
function resolveBulkConfirm(ok) {
  if (_bulkConfirmResolve == null) return;
  $('bulkConfirmOverlay').hidden = true;
  $('bulkConfirmModal').hidden = true;
  const r = _bulkConfirmResolve; _bulkConfirmResolve = null;
  r(ok);
}
// Session-level record of the last bulk action's created rows, for one-click
// undo. Not persisted (cleared on reload). Undo deletes exactly those rows; the
// append-only feedback model then restores the prior value automatically.
function setLastBulk(kind, label, ids) {
  state.lastBulk = (ids && ids.length) ? { kind, label, ids } : null;
  updateUndoButton();
}
function updateUndoButton() {
  const btn = $('gridUndoBtn');
  if (!btn) return;
  btn.hidden = !state.lastBulk;
  if (state.lastBulk) btn.title = 'Undo: ' + state.lastBulk.label;
}
async function undoLastBulk() {
  const lb = state.lastBulk;
  if (!lb || !lb.ids.length) return;
  const ok = await confirmBulk(`Undo "${lb.label}"? This deletes exactly the ${lb.ids.length} row${lb.ids.length === 1 ? '' : 's'} that action created and restores the prior state. Continue?`);
  if (!ok) return;
  try {
    if (lb.kind === 'feedback') {
      const res = await fetch('/api/feedback', { method: 'DELETE', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: lb.ids }) });
      if (!res.ok) throw new Error('delete failed');
      state.feedback = await fetchFeedback(state.rawListings.map(x => x.mls));
    } else if (lb.kind === 'attachment') {
      for (const id of lb.ids) {
        await fetch('/api/place-attachments', { method: 'DELETE', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      }
      state.placeAttachments = await fetchPlaceAttachments(state.rawListings.map(x => x.mls));
    }
    setLastBulk(null, '', []);
    applyFiltersAndRender();
  } catch (e) { alert('Could not undo: ' + e.message); }
}

// Bulk set rating: n listings = n standard rating writes as the active person,
// behind the confirmation gate, with the created rows recorded for undo.
async function bulkSetRating(rating) {
  if (!state.activePerson) { alert('Select who you are (top right) first.'); return; }
  const targets = [...state.gridSelection];
  if (!targets.length) return;
  const n = targets.length;
  const ok = await confirmBulk(`Set rating to ${rating} star${rating === 1 ? '' : 's'} for ${n} propert${n === 1 ? 'y' : 'ies'}. This can be undone immediately after, but not later. Continue?`);
  if (!ok) return;
  try {
    const ids = [];
    for (const mls of targets) {
      const d = await postFeedback({ person_id: state.activePerson, listing_id: mls, action_type: 'rating', rating });
      if (d && d.id) ids.push(d.id);
    }
    Object.assign(state.feedback, await fetchFeedback(targets));
    setLastBulk('feedback', `Set rating to ${rating}★ on ${n} propert${n === 1 ? 'y' : 'ies'}`, ids);
    applyFiltersAndRender();
  } catch (e) { alert('Could not set ratings: ' + e.message); }
}

// Bulk add note: one note text added (never edited) to every selected property,
// as the active person, via n standard note writes. Server-side created_at
// timestamps them today.
function openBulkNote() {
  if (!state.gridSelection.size) return;
  if (!state.activePerson) { alert('Select who you are (top right) first.'); return; }
  $('bulkNoteText').value = '';
  $('bulkNoteStatus').textContent = '';
  const n = state.gridSelection.size;
  $('bulkNoteTitle').textContent = `Add a note to ${n} propert${n === 1 ? 'y' : 'ies'}`;
  $('bulkNoteOverlay').hidden = false;
  $('bulkNoteModal').hidden = false;
}
function closeBulkNote() { $('bulkNoteOverlay').hidden = true; $('bulkNoteModal').hidden = true; }
async function bulkNoteGo() {
  const note = $('bulkNoteText').value.trim();
  if (!note) { $('bulkNoteStatus').textContent = 'Enter some note text first.'; return; }
  const targets = [...state.gridSelection];
  if (!targets.length) { closeBulkNote(); return; }
  const n = targets.length;
  const preview = note.length > 80 ? note.slice(0, 80) + '…' : note;
  const ok = await confirmBulk(`Add this note to ${n} propert${n === 1 ? 'y' : 'ies'}: "${preview}". This can be undone immediately after, but not later. Continue?`);
  if (!ok) return;
  closeBulkNote();
  try {
    const ids = [];
    for (const mls of targets) {
      const d = await postFeedback({ person_id: state.activePerson, listing_id: mls, action_type: 'note', note });
      if (d && d.id) ids.push(d.id);
    }
    Object.assign(state.feedback, await fetchFeedback(targets));
    setLastBulk('feedback', `Added a note to ${n} propert${n === 1 ? 'y' : 'ies'}`, ids);
    applyFiltersAndRender();
  } catch (e) { alert('Could not add notes: ' + e.message); }
}

// GAL-53: bulk (grid) attach resolves a typed name/address through the same
// Search Box path as the per-card composer, so named places resolve there too.
// Returns the {center:[lng,lat], place_name} shape its callers expect.
async function geocodeAddress(query) {
  const place = await geocodePlace(query);
  return place ? { center: [place.lng, place.lat], place_name: place.label } : null;
}
function openBulkAttach() {
  if (!state.gridSelection.size) return;
  if (!state.activePerson) { alert('Select who you are (top right) first.'); return; }
  const poiSel = $('bulkAttachPoi');
  poiSel.innerHTML = '<option value="">— pick an existing place —</option>'
    + state.poi.map(p => `<option value="${p.id}">${(POI_TYPE_META[p.type] || POI_TYPE_META.other).icon} ${esc((POI_TYPE_META[p.type] || POI_TYPE_META.other).label)}: ${esc(p.label || '')}</option>`).join('');
  // GAL-66: emoji category dropdown here too (was a stale 5-option static list).
  const typeSel = $('bulkAttachType');
  if (typeSel) {
    typeSel.innerHTML = Object.entries(POI_TYPE_META).map(([k, v]) => `<option value="${k}">${v.icon} ${esc(v.label)}</option>`).join('');
    typeSel.value = 'other';
  }
  $('bulkAttachAddr').value = '';
  $('bulkAttachStatus').textContent = '';
  $('bulkAttachTitle').textContent = `Attach a place to ${state.gridSelection.size} listings`;
  $('bulkAttachOverlay').hidden = false;
  $('bulkAttachModal').hidden = false;
}
function closeBulkAttach() { $('bulkAttachOverlay').hidden = true; $('bulkAttachModal').hidden = true; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function bulkAttachGo() {
  const targets = [...state.gridSelection];
  const status = msg => { $('bulkAttachStatus').textContent = msg; };
  if (!targets.length) { closeBulkAttach(); return; }
  let poiId = $('bulkAttachPoi').value ? Number($('bulkAttachPoi').value) : null;
  const addr = $('bulkAttachAddr').value.trim();
  if (!poiId && !addr) { status('Pick an existing place or enter an address.'); return; }
  // Name the specific place in the confirmation, so the dialog proofreads it.
  const poiSelEl = $('bulkAttachPoi');
  const placeName = poiId ? poiSelEl.options[poiSelEl.selectedIndex].text : addr;
  const nSel = targets.length;
  const okGate = await confirmBulk(`Attach "${placeName}" to ${nSel} propert${nSel === 1 ? 'y' : 'ies'}. This can be undone immediately after, but not later. Continue?`);
  if (!okGate) return;
  try {
    if (!poiId && addr) {
      status('Finding the address…');
      const feat = await geocodeAddress(addr);
      if (!feat) { status('No place found for that address.'); return; }
      const [lng, lat] = feat.center;
      const res = await fetch('/api/poi', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: state.activePerson, type: $('bulkAttachType').value, label: feat.place_name, lat, lng }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'could not create place');
      poiId = data.id;
      await loadPoi();
    }
    if (!poiId) { status('Pick an existing place or enter an address.'); return; }
    // Attach sequentially: each attach computes a per-listing drive time via the
    // Mapbox Directions API server-side, so a small delay between calls keeps a
    // large selection under the 300 requests/min limit (~8/sec here). For very
    // large selections this queues rather than bursting.
    let done = 0;
    const attIds = [];
    for (const mls of targets) {
      const res = await fetch('/api/place-attachments', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: mls, person_id: state.activePerson, poi_id: poiId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.detail || 'attach failed');
      if (d.attachment && d.attachment.id) attIds.push(d.attachment.id);
      done++;
      status(`Attaching… ${done} of ${targets.length}`);
      await sleep(120);
    }
    state.placeAttachments = await fetchPlaceAttachments(state.rawListings.map(x => x.mls));
    setLastBulk('attachment', `Attached "${placeName}" to ${nSel} propert${nSel === 1 ? 'y' : 'ies'}`, attIds);
    closeBulkAttach();
    applyFiltersAndRender();
  } catch (e) { status('Error: ' + e.message); }
}

// ─── Export (scope -> columns -> CSV/xlsx) ─────────────────────────────────────
// "Everything" scope: every scalar listing field, all per-person feedback, notes,
// attachments, and the computed financial breakdown, flattened into columns.
function everythingColumns() {
  const cols = [
    { key: 'mls', label: 'MLS', type: 'text', get: i => i.mls || '' },
    { key: 'address', label: 'Address', type: 'text', get: i => i.address || '' },
    { key: 'listPrice', label: 'List price', type: 'number', get: i => numOrNull(i.price) },
    { key: 'potentialPrice', label: 'Potential price', type: 'number', get: i => i.potentialPurchasePrice?.price ?? null },
    { key: 'effectivePrice', label: 'Effective price', type: 'number', get: i => effectivePrice(i).value ?? null },
    { key: 'beds', label: 'Beds', type: 'text', get: i => String(i.beds ?? i.bedsNum ?? '') },
    { key: 'baths', label: 'Baths', type: 'number', get: i => numOrNull(i.baths) },
    { key: 'sqft', label: 'Sqft', type: 'number', get: i => numOrNull(i.sqft) },
    { key: 'acres', label: 'Lot acres', type: 'number', get: i => numOrNull(i.acres) },
    { key: 'fitMet', label: 'Fit met', type: 'number', get: i => i.fit?.met ?? null },
    { key: 'fitTotal', label: 'Fit total', type: 'number', get: i => i.fit?.total ?? null },
    { key: 'lat', label: 'Lat', type: 'number', get: i => numOrNull(i.lat) },
    { key: 'lng', label: 'Lng', type: 'number', get: i => numOrNull(i.lng) },
    { key: 'highwayKm', label: 'Highway km', type: 'number', get: i => numOrNull(i.highwayKm) },
    { key: 'nearestHighway', label: 'Nearest highway', type: 'text', get: i => i.nearestHighway || '' },
    { key: 'goMin', label: 'GO drive (min)', type: 'number', get: i => numOrNull(i.goMin) },
    { key: 'goTrain', label: 'GO train (min)', type: 'number', get: i => numOrNull(i.poc?.goTrain) },
    { key: 'goTotal', label: 'GO total (min)', type: 'number', get: i => numOrNull(i.poc?.goTotal) },
    { key: 'monthlyPit', label: 'Monthly PIT', type: 'number', get: i => effectivePitNum(i) ?? null },
    { key: 'costToClose', label: 'Cost to close', type: 'number', get: i => effectiveDueNum(i) ?? null },
    { key: 'group', label: 'Group sentiment', type: 'text', get: i => sentimentWordFor(i) },
  ];
  // Per-person feedback columns.
  state.people.forEach(p => {
    const fb = i => (state.feedback[i.mls] || []).find(f => f.person_id === p.id) || null;
    cols.push({ key: `p${p.id}_rating`, label: `${p.name} rating`, type: 'number', get: i => fb(i)?.rating ?? null });
    cols.push({ key: `p${p.id}_status`, label: `${p.name} status`, type: 'text', get: i => fb(i)?.status || '' });
    cols.push({ key: `p${p.id}_note`, label: `${p.name} note`, type: 'text', get: i => fb(i)?.note || '' });
    cols.push({ key: `p${p.id}_research`, label: `${p.name} research`, type: 'text', get: i => fb(i)?.research_requested ? 'yes' : '' });
  });
  // Attachments (all places attached to the listing, summarized).
  cols.push({ key: 'attachments', label: 'Attached places', type: 'text', get: i =>
    (state.placeAttachments[i.mls] || []).map(a => `${(POI_TYPE_META[a.poi_type] || POI_TYPE_META.other).icon} ${a.poi_label || (POI_TYPE_META[a.poi_type] || POI_TYPE_META.other).label}${a.drive_minutes != null ? ' (' + a.drive_minutes + ' min)' : ''}`).join('; ') });
  // Computed financial breakdown itemized.
  const bd = i => i.mortgageBreakdown || null;
  cols.push({ key: 'downPayment', label: 'Down payment', type: 'number', get: i => bd(i)?.downPayment?.amount ?? null });
  cols.push({ key: 'cmhc', label: 'CMHC premium', type: 'number', get: i => bd(i)?.cmhc?.applies ? bd(i).cmhc.premium : null });
  cols.push({ key: 'ontarioLtt', label: 'Ontario LTT', type: 'number', get: i => bd(i)?.ontarioLtt?.afterRebate ?? null });
  cols.push({ key: 'torontoLtt', label: 'Toronto LTT', type: 'number', get: i => bd(i)?.torontoLtt?.applies ? bd(i).torontoLtt.afterRebate : null });
  cols.push({ key: 'monthlyPI', label: 'Monthly P&I', type: 'number', get: i => bd(i)?.monthlyPrincipalInterest ?? null });
  cols.push({ key: 'monthlyTax', label: 'Monthly property tax', type: 'number', get: i => bd(i)?.monthlyPropertyTax ?? null });
  return cols;
}
function exportColumnsForScope(scope) {
  // The export picker shows only columns the exporting person is permitted (the
  // same server-side rule the grid uses). "Displayed" uses the grid's visible
  // columns; "everything" starts from the full set, both filtered by permission.
  const base = scope === 'everything' ? everythingColumns() : visibleGridColumns();
  return base.filter(c => exportColumnPermitted(c.key));
}
function exportFilenameBase() {
  const date = new Date().toISOString().slice(0, 10);
  const parts = [];
  const st = $('filterStatus')?.value; if (st) parts.push(st);
  const mf = $('minFit')?.value; if (mf) parts.push('fit' + mf + 'plus');
  if ($('minPrice')?.value || $('maxPrice')?.value) parts.push('price');
  const areas = state.savedAreas.filter(a => isAreaActive(a.id));
  if (areas.length === 1) parts.push(areas[0].name);
  // Include a concise filter summary in the name; otherwise a generic tag.
  let summary = parts.join('-');
  if (activeFilterCount() > 0 && summary.length > 40) summary = 'filtered';
  return 'listings-' + date + (summary ? '-' + summary : '');
}
let _exportState = { scope: 'displayed' };
function openExport() {
  if (state.activeView !== 'grid') return;
  _exportState = { scope: 'displayed' };
  $('exportTitle').textContent = 'Export';
  renderExportStep1();
  $('exportOverlay').hidden = false;
  $('exportModal').hidden = false;
}
function closeExport() { $('exportOverlay').hidden = true; $('exportModal').hidden = true; }
function renderExportStep1() {
  const n = gridRows().length;
  $('exportBody').innerHTML = `
    <p class="settings-desc">Exports the ${n} listing${n === 1 ? '' : 's'} currently shown (all active filters and drawn areas apply).</p>
    <div class="export-scope">
      <label class="export-radio"><input type="radio" name="exportScope" value="displayed" checked /> <div><div>Displayed columns</div><div class="field-desc">The ${exportColumnsForScope('displayed').length} columns shown in the grid</div></div></label>
      <label class="export-radio"><input type="radio" name="exportScope" value="everything" /> <div><div>Everything</div><div class="field-desc">All listing fields, every person's feedback, notes, attachments, and the financial breakdown</div></div></label>
    </div>
    <button id="exportNext">Next: choose columns</button>`;
  $('exportNext').addEventListener('click', () => {
    _exportState.scope = document.querySelector('input[name=exportScope]:checked').value;
    renderExportStep2();
  });
}
function renderExportStep2() {
  const cols = exportColumnsForScope(_exportState.scope);
  const checks = cols.map((c, idx) =>
    `<label class="export-col"><input type="checkbox" class="export-col-cb" data-idx="${idx}" checked /> ${esc(c.label)}</label>`).join('');
  $('exportBody').innerHTML = `
    <div class="export-col-head">
      <button class="link-btn" id="exportBack">‹ Back</button>
      <span>${cols.length} columns, all selected by default</span>
    </div>
    <div class="export-col-list">${checks}</div>
    <div class="export-format">
      <span>Format:</span>
      <label><input type="radio" name="exportFormat" value="csv" checked /> CSV</label>
      <label><input type="radio" name="exportFormat" value="xlsx" /> Excel (.xlsx)</label>
    </div>
    <button id="exportRun">Export</button>`;
  $('exportBack').addEventListener('click', renderExportStep1);
  $('exportRun').addEventListener('click', () => {
    const chosen = [...document.querySelectorAll('.export-col-cb:checked')].map(cb => cols[Number(cb.dataset.idx)]);
    if (!chosen.length) { alert('Pick at least one column.'); return; }
    const format = document.querySelector('input[name=exportFormat]:checked').value;
    runExport(chosen, format).catch(err => alert('Export failed: ' + err.message));
  });
}
async function runExport(columns, format) {
  const rows = gridRows().map(item => {
    const r = {};
    columns.forEach(c => { r[c.key] = c.get(item); });
    return r;
  });
  const payload = {
    format, filename: exportFilenameBase(),
    columns: columns.map(c => ({ key: c.key, label: c.label, type: c.type })),
    rows,
    // The server re-applies the permission filter (defence in depth): a denied
    // group cannot be exported even if the client sent its columns.
    person_id: state.activePerson || null,
  };
  const res = await fetch('/api/export', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error('server ' + res.status);
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="([^"]+)"/);
  const fname = m ? m[1] : payload.filename + '.' + format;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  closeExport();
}

// ─── Active-filter count badge (on the collapsed Filters summary) ──────────────
function activeFilterCount() {
  let n = 0;
  const valueFields = ['q', 'filterStatus', 'minPrice', 'maxPrice', 'minBeds', 'maxBeds',
    'minBaths', 'maxBaths', 'minSqft', 'maxSqft', 'minAcres', 'maxAcres', 'maxCommute',
    'minHwyKm', 'maxHwyKm', 'minAttachDrive', 'maxAttachDrive', 'minPit', 'maxPit',
    'minDue', 'maxDue', 'minFit'];
  valueFields.forEach(id => { const el = $(id); if (el && String(el.value || '').trim() !== '') n++; });
  if (($('consensusFilter')?.value || '') !== '') n++; // GAL-19 group consensus
  n += currentCheckedKeywords().length; // each checked household keyword
  n += currentCheckedPropTypes().length; // GAL-75: each checked property type
  state.people.forEach(p => PERSON_FILTER_OPTIONS.forEach(o => { if ($(personFilterCbId(p.id, o.value))?.checked) n++; }));
  n += state.savedAreas.filter(a => isAreaActive(a.id)).length; // each enabled drawn area
  return n;
}
function updateFilterBadge() {
  markFilledFilters(); // highlight populated fields so the count is explicable
  const badge = $('filterBadge');
  if (!badge) return;
  const n = activeFilterCount();
  badge.hidden = n === 0;
  badge.textContent = String(n);
}

// ─── Sort ─────────────────────────────────────────────────────────────────────
function currentSort() {
  // Both sort selects stay in sync; use whichever is active
  return ($('sort')?.value || $('sortList')?.value || 'fit-desc');
}

function syncSort(value) {
  if ($('sort')) $('sort').value = value;
  if ($('sortList')) $('sortList').value = value;
  if ($('sortCombined')) $('sortCombined').value = value;
  updateSortBtnTitle();
}

// GAL-73: sort is a compact icon button that opens a small menu driving a hidden
// native <select>. Used in two places with the same code: the status bar
// (#sortBtn/#sortMenu/#sort) and the Combined-view drawer header
// (#sortCombinedBtn/#sortCombinedMenu/#sortCombined). The button title names the
// current sort so it is not a mystery icon.
const SORT_CONTROLS = [
  { btn: 'sortBtn', menu: 'sortMenu', sel: 'sort' },
  { btn: 'sortCombinedBtn', menu: 'sortCombinedMenu', sel: 'sortCombined' },
];
function updateSortBtnTitle() {
  const sel = $('sort');
  const label = sel && sel.selectedOptions.length ? sel.selectedOptions[0].textContent.trim() : '';
  if (!label) return;
  SORT_CONTROLS.forEach(c => { const b = $(c.btn); if (b) b.title = 'Sort: ' + label; });
}
function buildSortMenuInto(menu, sel) {
  if (!menu || !sel) return;
  menu.innerHTML = '';
  Array.from(sel.options).forEach(opt => {
    const b = el('button', { type: 'button', textContent: opt.textContent });
    if (opt.value === sel.value) b.classList.add('active');
    b.addEventListener('click', () => {
      if (sel.value !== opt.value) { sel.value = opt.value; sel.dispatchEvent(new Event('change')); }
      closeAllSortMenus();
    });
    menu.append(b);
  });
}
function closeAllSortMenus() {
  SORT_CONTROLS.forEach(c => {
    const m = $(c.menu); if (m) m.hidden = true;
    $(c.btn)?.setAttribute('aria-expanded', 'false');
  });
}
function toggleSortMenu(c) {
  const btn = $(c.btn), menu = $(c.menu), sel = $(c.sel);
  if (!menu || !sel) return;
  const willOpen = menu.hidden;
  closeAllSortMenus();
  if (willOpen) { buildSortMenuInto(menu, sel); menu.hidden = false; btn?.setAttribute('aria-expanded', 'true'); }
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

function wirePriceInput(el) {
  // Accept an id or the element itself, so dynamically-created money inputs
  // (e.g. the est purchase price editor) can reuse this too (GAL-60).
  if (typeof el === 'string') el = $(el);
  if (!el) return;
  // GAL-60: show thousands separators DURING entry, not just on blur. Reformat
  // on each input and keep the caret after the same number of digits.
  const reformat = () => {
    const caret = el.selectionStart == null ? el.value.length : el.selectionStart;
    const digitsBeforeCaret = el.value.slice(0, caret).replace(/[^\d]/g, '').length;
    const digits = el.value.replace(/[^\d]/g, '');
    el.dataset.raw = digits;
    el.value = formatThousands(digits);
    if (el.selectionStart != null) {
      let pos = 0, seen = 0;
      while (pos < el.value.length && seen < digitsBeforeCaret) { if (/\d/.test(el.value[pos])) seen++; pos++; }
      try { el.setSelectionRange(pos, pos); } catch (_) { /* type may not allow selection */ }
    }
  };
  el.addEventListener('input', reformat);
  el.addEventListener('blur', reformat);
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
  // Draw-an-area: Sample Data is filtered server-side via the Repliers `map`
  // polygon param (POC is filtered client-side by matchesDrawArea instead).
  const poly = drawnPolygonsParam();
  if (poly && currentSource() === 'repliers') { p.set('map', poly); p.set('mapOperator', 'OR'); }
  // The active actor decides which column groups the server includes in the
  // payload (denied groups are stripped server-side). Absent -> all permitted.
  if (state.activePerson) p.set('person_id', String(state.activePerson));
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
  state.comments = await fetchComments(listingIds);
  if (source === 'poc') state.map?.jumpTo({ center: [-79.5, 44.0], zoom: 9 });
  else state.map?.jumpTo({ center: [-87.6298, 41.8781], zoom: 10 });
  // Explicit load (initial, Apply, Reset, source switch): fit to the results.
  state.fitMapNext = true;
  applyFiltersAndRender();
}

function reset() {
  ['q','minPrice','maxPrice','minBeds','maxBeds','minBaths','maxBaths','minSqft','maxSqft','minAcres','maxAcres','maxCommute','minHwyKm','maxHwyKm','minAttachDrive','maxAttachDrive','minPit','maxPit','minDue','maxDue','minFit','filterStatus']
    .forEach(id => { const el=$(id); if(el) { el.value=''; delete el.dataset.raw; } });
  $('resultsPerPage').value = '60';
  const cf = $('consensusFilter'); if (cf) cf.value = ''; // GAL-19
  document.querySelectorAll('#featureKeywordRow input.feat-kw').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('#propTypeRow input.prop-type').forEach(cb => { cb.checked = false; }); // GAL-75
  state.people.forEach(p => {
    PERSON_FILTER_OPTIONS.forEach(o => { const cb = $(personFilterCbId(p.id, o.value)); if (cb) cb.checked = false; });
  });
  // Reset also clears any drawn search areas (session-level, so just wipe the
  // state and layer; the load() below refetches without the map filter).
  // Reset clears the area filter by turning every saved area off (the areas
  // themselves stay saved and re-toggleable, they are shared household data).
  state.drawMode = false;
  state.drawCurrent = [];
  document.body.classList.remove('draw-mode');
  saveActiveAreaIds([]);
  renderAreaLayers();
  renderDrawLayer();
  updateDrawIndicator();
  updateDrawToolbar();
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
  'consensusFilter', // GAL-19: group-consensus select (replaced hideVetoed)
  'resultsPerPage', 'source', 'sort',
];
const PERSISTED_CHECKBOX_IDS = [
  'layerGoStations', 'layerGoStationsPlanned', 'layerGoLines',
  'layerTtcLines', 'layerTtcStations', 'layerHwy413', 'layerPoiPins',
];

function saveFilterState() {
  const saved = {};
  PERSISTED_FIELD_IDS.forEach(id => { const el = $(id); if (el) saved[id] = el.value; });
  PERSISTED_CHECKBOX_IDS.forEach(id => { const el = $(id); if (el) saved[id] = el.checked; });
  saved._personFilters = Array.from(document.querySelectorAll('#personFilters input[type=checkbox]:checked')).map(cb => cb.id);
  saved._featureKeywords = currentCheckedKeywords(); // household keyword checkboxes (dynamic)
  saved._propTypes = currentCheckedPropTypes(); // GAL-75: property-type chips (dynamic)
  localStorage.setItem(FILTER_STATE_KEY, JSON.stringify(saved));
  updateFilterBadge(); // the badge tracks live edits, not just applied loads
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
    layerTtcLines: 'ttc-lines-layer',
    layerTtcStations: 'ttc-stations-circles',
    layerHwy413: 'hwy413-line',
    layerPoiPins: 'poi-pins-circles',
  };
  Object.entries(layerFor).forEach(([checkboxId, layerId]) => {
    const cb = $(checkboxId);
    if (cb) state.map.setLayoutProperty(layerId, 'visibility', cb.checked ? 'visible' : 'none');
  });
  // GAL-66: the POI emoji layer rides the same toggle as its disc layer.
  if (state.map.getLayer('poi-pins-icons') && state.map.getLayer('poi-pins-circles')) {
    state.map.setLayoutProperty('poi-pins-icons', 'visibility',
      state.map.getLayoutProperty('poi-pins-circles', 'visibility'));
  }
  // Satellite-mode casings mirror the GO lines / Highway 413 toggle state.
  updateOverlayLegibility();
  updateBasemapDim(); // dim the basemap iff transit lines are on
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

window.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadMapColors();          // read the CSS :root map palette into MAP_COLORS (before the map builds layers)
  setupControlIcons();      // inject the inline-SVG glyphs into the icon controls
  maybeTeachIconLabels();   // first-visit: show labels once, then collapse to icons
  setupExclusivePanels();   // one open map panel at a time (Filters/Layers/Legend/Draw)
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
      initReportButton();  // show the Report button when the server has a Linear key
      wireInbox();          // GAL-67 inbox drawer open/close
      loadPeople().then(() => {
        applyFiltersAndRender();
        refreshInbox();     // GAL-67: populate the unread badge for the restored person
        loadPersonThresholds();
        // Column permissions reference people, so load after the roster. A grid
        // re-render picks up the active person's permitted + hidden columns.
        loadColumnPermissions().then(() => { if (state.activeView === 'grid') renderGrid(); });
      });
      loadPoi().then(buildThresholdSettings);
      // Saved areas (shared) drive the Layers menu entries + the area filter.
      loadAreas().then(() => {
        renderAreaLayers();
        renderDrawLayer();
        updateDrawIndicator();
        if (state.rawListings.length) applyFiltersAndRender();
      });
      loadHouseholdSettings().then(migrateHighwayFilterCheckbox);
      return load();
    })
    .catch(showError);
  bindHouseholdToggle('firstTimeBuyerToggle', 'first_time_buyer');
  HOUSEHOLD_NUMBER_SETTINGS.forEach(({ id, key }) => bindHouseholdNumberInput(id, key));
  $('addPoiBtn')?.addEventListener('click', () => togglePoiComposer());
  $('layerPoiPins')?.addEventListener('change', e => {
    if (!state.mapReady) return;
    const vis = e.target.checked ? 'visible' : 'none';
    state.map.setLayoutProperty('poi-pins-circles', 'visibility', vis);
    if (state.map.getLayer('poi-pins-icons')) state.map.setLayoutProperty('poi-pins-icons', 'visibility', vis);
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
    updateOverlayLegibility(); // keep the satellite casing in step with the toggle
    updateBasemapDim();        // transit lines drive the basemap dim
  });
  $('layerHwy413')?.addEventListener('change', e => {
    if (!state.mapReady) return;
    state.map.setLayoutProperty('hwy413-line', 'visibility', e.target.checked ? 'visible' : 'none');
    updateOverlayLegibility();
  });
  $('layerTtcLines')?.addEventListener('change', e => {
    if (!state.mapReady) return;
    state.map.setLayoutProperty('ttc-lines-layer', 'visibility', e.target.checked ? 'visible' : 'none');
    updateOverlayLegibility(); // TTC line casing follows the toggle in satellite mode
    updateBasemapDim();        // transit lines drive the basemap dim
  });
  $('layerTtcStations')?.addEventListener('change', e => {
    if (!state.mapReady) return;
    state.map.setLayoutProperty('ttc-stations-circles', 'visibility', e.target.checked ? 'visible' : 'none');
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
  $('consensusFilter')?.addEventListener('change', () => { saveFilterState(); applyFiltersAndRender(); });
  // Keyword filter chips wire their own change handlers in buildFeatureKeywordChips().
  buildFeatureKeywordChips();
  updateResultsPerFetchVisibility();
  $('keywordAddBtn')?.addEventListener('click', addKeywordFromInput);
  $('keywordAddInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addKeywordFromInput(); } });
  // Enter-to-submit for single-line inputs, one delegated handler so it also
  // covers the card compose boxes that are created dynamically per card. A
  // textarea keeps Shift+Enter for a newline; plain Enter submits. Inputs that
  // manage their own Enter (grid inline price edit, keyword add) stopPropagation
  // or sit outside these containers, so they are not double-handled.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const isTextarea = t.tagName === 'TEXTAREA';
    if (isTextarea && e.shiftKey) return; // Shift+Enter = newline in a textarea
    // Card note / potential price / reject / attach compose boxes: click the box's button.
    const compose = t.closest('.feedback-compose');
    if (compose && (t.tagName === 'INPUT' || isTextarea)) {
      const btn = compose.querySelector('button');
      if (btn) { e.preventDefault(); btn.click(); }
      return;
    }
    // Filter panel: Enter applies the filters (same as the Apply button).
    if (t.closest('.controls') && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) {
      e.preventDefault(); $('load')?.click();
      return;
    }
    // Bulk modals: Enter is the primary action.
    const modalPrimary = { bulkNoteText: 'bulkNoteGo', bulkAttachAddr: 'bulkAttachGo' };
    if (modalPrimary[t.id]) { e.preventDefault(); $(modalPrimary[t.id])?.click(); }
  });
  $('source').addEventListener('change', () => { updateResultsPerFetchVisibility(); buildSettingsPanel(); load().catch(showError); });
  // Map clustering (Appearance): toggle switches the map between count bubbles
  // and individual pins immediately; granularity re-fetches at a new precision.
  const clusterCb = $('mapClusterToggle');
  if (clusterCb) {
    clusterCb.checked = mapClusteringOn();
    clusterCb.addEventListener('change', e => { setMapClustering(e.target.checked); refreshMap(state.listings); });
  }
  const pocClusterCb = $('pocClusterToggle');
  if (pocClusterCb) {
    pocClusterCb.checked = pocClusteringOn();
    pocClusterCb.addEventListener('change', e => { setPocClustering(e.target.checked); refreshMap(state.listings); });
  }
  const granSel = $('mapClusterGranSelect');
  if (granSel) {
    granSel.value = mapClusterGranularity();
    granSel.addEventListener('change', e => { setMapClusterGranularity(e.target.value); if (clusteringActive()) refetchClustersForViewport(); });
  }
  const decSel = $('pillDecimalsSelect');
  if (decSel) {
    decSel.value = String(pillCompactDecimals());
    // Re-render both views so pills and cards pick up the new decimals at once.
    decSel.addEventListener('change', e => { setPillCompactDecimals(parseInt(e.target.value, 10)); applyFiltersAndRender(); });
  }
  const dimSel = $('basemapDimSelect');
  if (dimSel) {
    dimSel.value = String(basemapDimPct());
    dimSel.addEventListener('change', e => { setBasemapDimPct(parseInt(e.target.value, 10)); updateBasemapDim(); });
  }
  // Basemap Streets/Satellite: the Layers-menu "Satellite imagery" toggle and
  // the Appearance select both drive applyMapStyle(); updateMapStyleUI keeps
  // the two surfaces in sync. Basemap is a layer decision, so its primary
  // control lives with the other layer toggles.
  const satToggle = $('layerSatellite');
  if (satToggle) {
    satToggle.checked = mapStyleChoice() === 'satellite';
    satToggle.addEventListener('change', e => applyMapStyle(e.target.checked ? 'satellite' : 'streets'));
  }
  $('clusterPopupClose')?.addEventListener('click', closeClusterPopup);
  $('compassBtn')?.addEventListener('click', () => state.map?.easeTo({ bearing: 0, pitch: 0 }));
  // Draw-an-area controls
  $('drawAreaBtn')?.addEventListener('click', toggleDrawMode);
  $('drawFinishBtn')?.addEventListener('click', () => finishPolygon());
  $('drawUndoBtn')?.addEventListener('click', undoDrawVertex);
  // GAL-63: area-save modal (name + include/exclude radios).
  $('areaSaveGo')?.addEventListener('click', () => saveDrawnArea().catch(err => console.error(err)));
  $('areaSaveCancel')?.addEventListener('click', closeAreaSaveModal);
  $('areaSaveClose')?.addEventListener('click', closeAreaSaveModal);
  $('areaSaveOverlay')?.addEventListener('click', closeAreaSaveModal);
  $('areaSaveName')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveDrawnArea().catch(err => console.error(err)); }
  });
  $('drawCancelBtn')?.addEventListener('click', cancelDrawing);
  $('drawIndicatorClear')?.addEventListener('click', deactivateAllAreas);
  $('sort')?.addEventListener('change', e => { syncSort(e.target.value); renderCards(state.listings); refreshMap(state.listings); renderCombined(); });
  // GAL-73: compact sort icon + popup menu, in the status bar and the Combined
  // drawer header. Each drives its hidden native select.
  SORT_CONTROLS.forEach(c => {
    $(c.btn)?.addEventListener('click', (e) => { e.stopPropagation(); toggleSortMenu(c); });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sort-control')) closeAllSortMenus();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllSortMenus(); });
  updateSortBtnTitle();
  $('sortList')?.addEventListener('change', e => { syncSort(e.target.value); renderCards(state.listings); });
  // Combined sort: reuse the same option list; changing it re-sorts every view.
  if ($('sortCombined') && $('sort')) {
    $('sortCombined').innerHTML = $('sort').innerHTML;
    $('sortCombined').value = currentSort();
    $('sortCombined').addEventListener('change', e => { syncSort(e.target.value); renderCombined(); renderCards(state.listings); saveFilterState(); });
  }
  initDrawerDrag();
  $('btnMap').addEventListener('click', () => switchView('map'));
  $('btnCombined')?.addEventListener('click', () => switchView('combined'));
  $('btnList').addEventListener('click', () => switchView('list'));
  $('btnGrid')?.addEventListener('click', () => switchView('grid'));
  // Grid table interactions (delegated once; innerHTML is rebuilt each render).
  const gt = $('gridTable');
  if (gt) {
    gt.addEventListener('click', e => {
      const th = e.target.closest('th[data-col]');
      if (th) { const c = gridColumns().find(x => x.key === th.dataset.col); if (c?.sortable) toggleGridSort(c.key); return; }
      if (e.target.matches('input[type=checkbox]')) return; // handled on change
      // Inline edits: a rating star, or the price cell. Handle before the row
      // click so they edit in place instead of opening the card.
      const star = e.target.closest('.gr-star');
      if (star) { e.stopPropagation(); setInlineRating(star.dataset.mls, Number(star.dataset.rate)); return; }
      const priceCell = e.target.closest('.grid-td-price');
      if (priceCell) { e.stopPropagation(); startPriceEdit(priceCell); return; }
      // Only the address or thumbnail opens the card; the rest of the row is
      // inert (the checkbox is the only selection click). Keeps inline editing
      // and plain reading from accidentally launching the card.
      const openCell = e.target.closest('.grid-td-address, .grid-td-thumb');
      if (openCell) {
        // Stop the document-level click-outside handler from seeing this same
        // click and immediately closing the card we are about to open (the map
        // pill/cluster handlers stopPropagation for the same reason).
        e.stopPropagation();
        const tr = openCell.closest('tbody tr[data-mls]');
        if (tr) { const item = findListing(tr.dataset.mls) || state.rawListings.find(x => x.mls === tr.dataset.mls); if (item) showMapCard(item); }
      }
    });
    gt.addEventListener('change', e => {
      if (e.target.id === 'gridSelectAll') { gridToggleSelectAll(e.target.checked); return; }
      if (e.target.classList.contains('grid-row-cb')) {
        const mls = e.target.closest('tr').dataset.mls;
        if (e.target.checked) state.gridSelection.add(mls); else state.gridSelection.delete(mls);
        e.target.closest('tr').classList.toggle('grid-row-sel', e.target.checked);
        updateGridCommandBar();
      }
    });
  }
  // Command bar: rating buttons (1-5) + attach + clear.
  const rateBtns = $('gridRateBtns');
  if (rateBtns) {
    rateBtns.innerHTML = [1, 2, 3, 4, 5].map(n => `<button type="button" class="grid-rate-btn" data-rate="${n}">${n}★</button>`).join('');
    rateBtns.addEventListener('click', e => { const b = e.target.closest('[data-rate]'); if (b) bulkSetRating(Number(b.dataset.rate)); });
  }
  $('cmdAddNote')?.addEventListener('click', openBulkNote);
  $('cmdAttachPlace')?.addEventListener('click', openBulkAttach);
  $('cmdClearSel')?.addEventListener('click', gridClearSelection);
  $('bulkAttachClose')?.addEventListener('click', closeBulkAttach);
  $('bulkAttachOverlay')?.addEventListener('click', closeBulkAttach);
  $('bulkAttachGo')?.addEventListener('click', () => bulkAttachGo());
  $('bulkNoteClose')?.addEventListener('click', closeBulkNote);
  $('bulkNoteOverlay')?.addEventListener('click', closeBulkNote);
  $('bulkNoteGo')?.addEventListener('click', () => bulkNoteGo());
  $('gridUndoBtn')?.addEventListener('click', () => undoLastBulk());
  // Bulk confirmation gate: explicit Confirm click only; Enter must not confirm.
  $('bulkConfirmOk')?.addEventListener('click', () => resolveBulkConfirm(true));
  $('bulkConfirmCancel')?.addEventListener('click', () => resolveBulkConfirm(false));
  $('bulkConfirmOverlay')?.addEventListener('click', () => resolveBulkConfirm(false));
  $('bulkConfirmModal')?.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
  // Personal column picker (grid header)
  $('gridColsBtn')?.addEventListener('click', e => { e.stopPropagation(); toggleColumnPicker(); });
  $('gridColsMenu')?.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', e => { if (!e.target.closest('.grid-cols-wrap')) closeColumnPicker(); });
  // Export
  $('gridExportBtn')?.addEventListener('click', openExport);
  $('exportClose')?.addEventListener('click', closeExport);
  $('exportOverlay')?.addEventListener('click', closeExport);
  switchView(loadView());  // restore the persisted Map / Combined / List / Grid choice
  updateFilterBadge();     // reflect any restored filters immediately
  $('themeBtn').addEventListener('click', cycleTheme);
  $('settingsBtn').addEventListener('click', openSettings);
  $('settingsClose').addEventListener('click', closeSettings);
  $('settingsOverlay').addEventListener('click', closeSettings);
  $('settingsBack').addEventListener('click', showSettingsMain);
  document.querySelectorAll('.settings-nav-row').forEach(row => {
    row.addEventListener('click', () => showSettingsPage(row.dataset.target, row.dataset.title));
  });
  $('mapCardClose').addEventListener('click', dismissMapCard);
  document.addEventListener('click', e => closeOutsidePanels(e.target));
  $('settingsSelectAll').addEventListener('click', () => { CARD_FIELDS.forEach(f => cardSettings[f.key] = true); saveSettings(); buildSettingsPanel(); applyCardVisibility(); });
  $('settingsSelectNone').addEventListener('click', () => { CARD_FIELDS.forEach(f => { if (f.key !== 'actions') cardSettings[f.key] = false; }); saveSettings(); buildSettingsPanel(); applyCardVisibility(); });
  $('settingsReset').addEventListener('click', () => { localStorage.removeItem(SETTINGS_KEY); cardSettings = loadSettings(); saveSettings(); buildSettingsPanel(); applyCardVisibility(); });
});
