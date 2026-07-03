// ─── Card field definitions ───────────────────────────────────────────────────
// key: CSS class suffix and settings key
// label: shown in settings panel
// defaultOn: true = on by default
// pocOnly: true = only shown when data source = poc
const CARD_FIELDS = [
  { key: 'price',     label: 'Price',                 defaultOn: true  },
  { key: 'commute',   label: 'GO commute',             defaultOn: true,  pocOnly: true },
  { key: 'stats',     label: 'Beds / baths / sqft / lot', defaultOn: true  },
  { key: 'financial', label: 'Monthly PIT + closing',  defaultOn: true,  pocOnly: true },
  { key: 'ratings',   label: 'Mark & Katie ratings',   defaultOn: true,  pocOnly: true },
  { key: 'fit',       label: 'Fit score tags',          defaultOn: true  },
  { key: 'features',  label: 'Features',               defaultOn: true,  pocOnly: true },
  { key: 'comments',  label: 'Comments',               defaultOn: false, pocOnly: true },
  { key: 'actions',   label: 'Action buttons',         defaultOn: true  },
];

const SETTINGS_KEY = 'hh_card_fields_v1';

// ─── State ────────────────────────────────────────────────────────────────────
const state = { map: null, markers: [], listings: [] };
let cardSettings = loadSettings();

// ─── Utilities ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const e = (s) => String(s || '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money = (v, curr = 'CAD') => v == null ? '' : Number(v).toLocaleString('en-CA', { style: 'currency', currency: curr, maximumFractionDigits: 0 });
const num = (v, suffix = '') => v == null || v === '' ? '' : `${Number(v).toLocaleString()}${suffix}`;
const stars = (n) => n ? '★'.repeat(Math.min(5, Number(n))) + '☆'.repeat(Math.max(0, 5 - Number(n))) : '';

function currentSource() { return $('source')?.value || 'poc'; }

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const out = {};
    for (const f of CARD_FIELDS) {
      out[f.key] = f.key in saved ? saved[f.key] : f.defaultOn;
    }
    return out;
  } catch { return Object.fromEntries(CARD_FIELDS.map(f => [f.key, f.defaultOn])); }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(cardSettings));
}

function fieldVisible(key) {
  if (!cardSettings[key]) return false;
  const def = CARD_FIELDS.find(f => f.key === key);
  if (def?.pocOnly && currentSource() !== 'poc') return false;
  return true;
}

// ─── Settings panel ───────────────────────────────────────────────────────────
function buildSettingsPanel() {
  const container = $('settingsFields');
  container.innerHTML = '';
  for (const f of CARD_FIELDS) {
    if (f.pocOnly && currentSource() !== 'poc') continue;
    const label = document.createElement('label');
    label.className = 'settings-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = cardSettings[f.key] !== false;
    cb.dataset.key = f.key;
    cb.addEventListener('change', () => {
      cardSettings[f.key] = cb.checked;
      saveSettings();
      applyCardVisibility();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + f.label));
    container.appendChild(label);
  }
}

function applyCardVisibility() {
  for (const f of CARD_FIELDS) {
    const show = fieldVisible(f.key);
    document.querySelectorAll('.cf-' + f.key).forEach(el => {
      el.style.display = show ? '' : 'none';
    });
  }
}

function openSettings() {
  buildSettingsPanel();
  $('settingsDrawer').hidden = false;
  $('settingsOverlay').hidden = false;
}

function closeSettings() {
  $('settingsDrawer').hidden = true;
  $('settingsOverlay').hidden = true;
}

// ─── Map ──────────────────────────────────────────────────────────────────────
function initMap() {
  state.map = L.map('map', { zoomControl: true }).setView([44.0, -79.5], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(state.map);
}

function markerColor(item) {
  const fit = item.fit?.met ?? 0;
  if (item.status && /reject/i.test(item.status)) return '#999';
  if (fit >= 7) return '#16803a';
  if (fit >= 5) return '#2b67d6';
  if (fit >= 4) return '#c58900';
  return '#b3261e';
}

function refreshMap(list) {
  state.markers.forEach(m => m.remove());
  state.markers = [];
  const bounds = [];
  for (const item of list) {
    if (item.lat == null || item.lng == null) continue;
    const marker = L.circleMarker([item.lat, item.lng], {
      radius: 9, weight: 2, color: '#fff',
      fillColor: markerColor(item), fillOpacity: 0.9,
    }).addTo(state.map);
    const goLine = item.goTotal ? ` · ${item.goTotal} min to Union` : '';
    marker.bindPopup(
      `<strong>${e(item.address)}</strong><br>` +
      `${money(item.price)} · Fit ${item.fit.label}${goLine}<br>` +
      `${num(item.beds)} beds, ${num(item.baths)} baths, ${num(item.sqft, ' sqft')}`
    );
    marker._hhItem = item;
    state.markers.push(marker);
    bounds.push([item.lat, item.lng]);
  }
  if (bounds.length) state.map.fitBounds(bounds, { padding: [30, 30] });
  setTimeout(() => state.map.invalidateSize(), 50);
  setTimeout(() => state.map.invalidateSize(), 400);
}

// ─── Cards ────────────────────────────────────────────────────────────────────
function tag(text, cls = '') {
  return `<span class="tag ${cls}">${e(text)}</span>`;
}

function renderCards(list) {
  const cards = $('cards');
  cards.innerHTML = '';
  const sorted = sortListings(list);
  const tpl = $('cardTemplate');
  for (const item of sorted) {
    const node = tpl.content.cloneNode(true);
    const poc = item.poc || null;

    // Photo
    const img = node.querySelector('.photo');
    img.src = item.image || '';
    img.alt = item.address;
    if (!item.image) node.querySelector('.card-photo-wrap').style.display = 'none';

    // Status badge
    const badge = node.querySelector('.card-status-badge');
    if (item.status && item.status !== 'New' && item.status !== 'POC') {
      badge.textContent = item.status;
      badge.className = 'card-status-badge ' + (/reject/i.test(item.status) ? 'badge-rejected' : 'badge-active');
    }

    // Address + meta
    node.querySelector('.address').textContent = item.address;
    const metaParts = [];
    if (poc) {
      if (item.beds) metaParts.push(item.beds + ' beds');
    } else {
      if (item.propertyType) metaParts.push(item.propertyType);
      if (item.style) metaParts.push(item.style);
    }
    node.querySelector('.meta').textContent = metaParts.join(' · ');

    // Fit badge
    const fit = item.fit;
    const fitBadge = node.querySelector('.fit-badge');
    fitBadge.innerHTML = `<strong>${e(fit.label)}</strong><span>fit</span>`;
    fitBadge.className = 'fit-badge' + (fit.met >= 7 ? ' fit-green' : fit.met >= 5 ? ' fit-blue' : fit.met >= 4 ? ' fit-amber' : ' fit-red');

    // Price
    node.querySelector('.card-price').textContent = money(item.price);

    // Commute (POC)
    if (poc) {
      const goStation = item.brokerage || '';
      const goMin = num(item.goMin, ' min drive');
      const goTrain = poc.goTrain ? num(poc.goTrain, ' min train') : '';
      const goTotal = poc.goTotal ? `${num(poc.goTotal, ' min total to Union')}` : '';
      node.querySelector('.card-commute').innerHTML =
        `<span class="commute-station">${e(goStation)}</span>` +
        `<span class="commute-detail">${[goMin, goTrain, goTotal].filter(Boolean).join(' · ')}</span>`;
    }

    // Stats
    const statsEl = node.querySelector('.card-stats');
    const statTags = [
      item.beds && tag(item.beds + ' beds'),
      item.baths && tag(item.baths + ' baths'),
      item.sqft && tag(num(item.sqft) + ' sqft'),
      item.acres && tag(num(item.acres, ' ac')),
      !poc && item.dom && tag(num(item.dom) + ' DOM'),
    ].filter(Boolean);
    statsEl.innerHTML = statTags.join('');

    // Financial (POC)
    if (poc) {
      const finEl = node.querySelector('.card-financial');
      const pitVal = item.pitNum ? money(item.pitNum) : (item.pit || '');
      const dueVal = item.dueClosing || '';
      finEl.innerHTML = [
        pitVal && `<span class="fin-label">Monthly PIT</span><span class="fin-value">${e(pitVal)}</span>`,
        dueVal && `<span class="fin-label">Due at closing</span><span class="fin-value">${e(dueVal)}</span>`,
      ].filter(Boolean).map(s => `<div class="fin-row">${s}</div>`).join('');
    }

    // Ratings (POC)
    if (poc) {
      const markR = item.markRank;
      const katieR = item.katieRank;
      const ratEl = node.querySelector('.card-ratings');
      const rows = [];
      if (markR) rows.push(`<span class="rating-who">Mark</span><span class="rating-stars">${stars(markR)}</span>`);
      if (katieR) rows.push(`<span class="rating-who">Katie</span><span class="rating-stars">${stars(katieR)}</span>`);
      if (rows.length) ratEl.innerHTML = rows.map(r => `<div class="rating-row">${r}</div>`).join('');
      else ratEl.style.display = 'none';
    }

    // Fit tags (fails)
    const failedTags = (fit.failedLabels || []).slice(0, 4).map(x => tag('× ' + x, 'bad')).join('');
    node.querySelector('.card-fit-tags').innerHTML = failedTags || '';

    // Features (POC)
    if (poc && item.features) {
      node.querySelector('.card-features').innerHTML =
        (item.features || '').split(',').map(f => tag(f.trim())).join('');
    }

    // Comments (POC)
    if (poc) {
      const commEl = node.querySelector('.card-comments');
      const parts = [];
      if (item.markComments) parts.push(`<p class="comment-line"><span class="comment-who">Mark:</span> ${e(item.markComments.split('|').pop().replace(/^\d{4}-\d{2}-\d{2}: /, '').trim())}</p>`);
      if (item.katieComments) parts.push(`<p class="comment-line"><span class="comment-who">Katie:</span> ${e(item.katieComments.split('|').pop().replace(/^\d{4}-\d{2}-\d{2}: /, '').trim())}</p>`);
      if (item.realtorComments) parts.push(`<p class="comment-line"><span class="comment-who">Anees:</span> ${e(item.realtorComments.split('|').pop().replace(/^\d{4}-\d{2}-\d{2}: /, '').trim())}</p>`);
      commEl.innerHTML = parts.join('') || '';
      if (!parts.length) commEl.style.display = 'none';
    }

    // Actions
    const linkBtn = node.querySelector('.card-link-btn');
    const docBtn = node.querySelector('.card-doc-btn');
    if (poc?.link) { linkBtn.href = poc.link; } else { linkBtn.style.display = 'none'; }
    if (poc?.doc) { docBtn.href = poc.doc; } else { docBtn.style.display = 'none'; }

    node.querySelector('.show-map').addEventListener('click', () => {
      const marker = state.markers.find(m => m._hhItem === item);
      if (marker) {
        state.map.setView(marker.getLatLng(), 13);
        marker.openPopup();
        document.querySelector('.map-panel').scrollIntoView({ behavior: 'smooth' });
      }
    });

    cards.appendChild(node);
  }
  applyCardVisibility();
}

// ─── Sort ─────────────────────────────────────────────────────────────────────
function sortListings(list) {
  const mode = $('sort').value;
  const sorted = [...list];
  function cmp(a, b, getter, dir = 1) {
    const av = getter(a), bv = getter(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dir;
  }
  if (mode === 'fit-desc')      sorted.sort((a, b) => cmp(a, b, x => x.fit.met, -1));
  if (mode === 'price-asc')     sorted.sort((a, b) => cmp(a, b, x => x.price, 1));
  if (mode === 'price-desc')    sorted.sort((a, b) => cmp(a, b, x => x.price, -1));
  if (mode === 'go-asc')        sorted.sort((a, b) => cmp(a, b, x => x.poc?.goTotal ?? x.dom, 1));
  if (mode === 'sqft-desc')     sorted.sort((a, b) => cmp(a, b, x => x.sqft, -1));
  if (mode === 'lot-desc')      sorted.sort((a, b) => cmp(a, b, x => x.acres, -1));
  if (mode === 'markrank-desc') sorted.sort((a, b) => cmp(a, b, x => x.markRank ? Number(x.markRank) : null, -1));
  return sorted;
}

// ─── Load ─────────────────────────────────────────────────────────────────────
function filterParams() {
  const p = new URLSearchParams();
  for (const id of ['q', 'minPrice', 'maxPrice', 'minBeds', 'minBaths', 'minFit', 'resultsPerPage']) {
    const v = $(id)?.value.trim();
    if (v) p.set(id, v);
  }
  return p;
}

async function load() {
  const source = currentSource();
  $('summary').textContent = source === 'poc' ? 'Loading your POC data…' : 'Loading Repliers sample data…';
  $('sourcePill').textContent = source === 'poc' ? 'POC' : 'Repliers';
  const endpoint = source === 'poc' ? '/api/poc-listings' : '/api/listings';
  const res = await fetch(endpoint + '?' + filterParams().toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || data.error || 'Load failed');

  // Apply status filter client-side
  const sf = $('filterStatus')?.value || '';
  let listings = data.listings;
  if (sf === 'active') listings = listings.filter(x => !/reject/i.test(x.status || ''));
  if (sf === 'rejected') listings = listings.filter(x => /reject/i.test(x.status || ''));

  state.listings = listings;
  $('summary').textContent = source === 'poc'
    ? `${listings.length} shown from your ${data.sourceCount} POC listings.`
    : `${listings.length} shown. ${Number(data.sourceCount).toLocaleString()} Repliers sample listings available.`;

  // Centre map on Ontario for POC, US for Repliers sample
  if (source === 'poc') {
    state.map.setView([44.0, -79.5], 7);
  } else {
    state.map.setView([39.5, -95], 4);
  }

  refreshMap(state.listings);
  renderCards(state.listings);
}

function reset() {
  for (const id of ['q', 'minPrice', 'maxPrice', 'minBeds', 'minBaths', 'minFit', 'filterStatus']) {
    const el = $(id);
    if (el) el.value = el.tagName === 'SELECT' ? '' : '';
  }
  $('resultsPerPage').value = '60';
  load().catch(showError);
}

function showError(err) {
  console.error(err);
  $('summary').textContent = 'Error: ' + err.message;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  $('load').addEventListener('click', () => load().catch(showError));
  $('reset').addEventListener('click', reset);
  $('source').addEventListener('change', () => { buildSettingsPanel(); load().catch(showError); });
  $('sort').addEventListener('change', () => renderCards(state.listings));
  $('settingsBtn').addEventListener('click', openSettings);
  $('settingsClose').addEventListener('click', closeSettings);
  $('settingsOverlay').addEventListener('click', closeSettings);
  $('settingsSelectAll').addEventListener('click', () => {
    CARD_FIELDS.forEach(f => { cardSettings[f.key] = true; });
    saveSettings(); buildSettingsPanel(); applyCardVisibility();
  });
  $('settingsSelectNone').addEventListener('click', () => {
    CARD_FIELDS.forEach(f => { if (f.key !== 'actions') cardSettings[f.key] = false; });
    saveSettings(); buildSettingsPanel(); applyCardVisibility();
  });
  $('settingsReset').addEventListener('click', () => {
    localStorage.removeItem(SETTINGS_KEY);
    cardSettings = loadSettings();
    saveSettings(); buildSettingsPanel(); applyCardVisibility();
  });
  load().catch(showError);
});
