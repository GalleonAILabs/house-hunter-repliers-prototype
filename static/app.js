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


const CARD_FIELDS = [
  { key: 'price',     label: 'Price',                     desc: 'Asking price',                      defaultOn: true  },
  { key: 'commute',   label: 'GO commute',                desc: 'Station, drive time, total to Union', defaultOn: true,  pocOnly: true },
  { key: 'stats',     label: 'Beds / baths / sqft / lot', desc: 'Key property stats',                 defaultOn: true  },
  { key: 'financial', label: 'Monthly PIT + closing',     desc: 'Monthly payment and due at closing', defaultOn: true,  pocOnly: true },
  { key: 'ratings',   label: 'Ratings',                   desc: 'Mark and Katie star ratings',        defaultOn: true,  pocOnly: true },
  { key: 'fit',       label: 'Fit score tags',            desc: 'What the property fails on',         defaultOn: true  },
  { key: 'features',  label: 'Features',                  desc: 'Loft, home office, shop, etc.',      defaultOn: true,  pocOnly: true },
  { key: 'comments',  label: 'Latest comments',           desc: 'Most recent note per person',        defaultOn: false, pocOnly: true },
  { key: 'actions',   label: 'Action buttons',            desc: 'View listing, research doc, map',    defaultOn: true  },
];
const SETTINGS_KEY = 'hh_card_fields_v1';

// ─── State ────────────────────────────────────────────────────────────────────
const state = { map: null, markers: [], listings: [], activeView: 'map' };
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
function buildSettingsPanel() {
  const container = $('settingsFields');
  container.innerHTML = '';
  CARD_FIELDS.filter(f => !f.pocOnly || currentSource() === 'poc').forEach(f => {
    const label = document.createElement('label');
    label.className = 'settings-row';
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: cardSettings[f.key] !== false });
    cb.dataset.key = f.key;
    cb.addEventListener('change', () => { cardSettings[f.key] = cb.checked; saveSettings(); applyCardVisibility(); });
    const text = document.createElement('div');
    text.innerHTML = `<div>${esc(f.label)}</div><div class="field-desc">${esc(f.desc)}</div>`;
    label.append(cb, text);
    container.appendChild(label);
  });
}

function applyCardVisibility() {
  CARD_FIELDS.forEach(f => {
    const show = fieldVisible(f.key);
    document.querySelectorAll('.cf-' + f.key).forEach(el => el.style.display = show ? '' : 'none');
  });
}

function openSettings() { buildSettingsPanel(); $('settingsDrawer').hidden = false; $('settingsOverlay').hidden = false; }
function closeSettings() { $('settingsDrawer').hidden = true; $('settingsOverlay').hidden = true; }

// ─── View toggle ──────────────────────────────────────────────────────────────
function switchView(view) {
  state.activeView = view;
  $('viewMap').hidden = view !== 'map';
  $('viewList').hidden = view !== 'list';
  $('btnMap').classList.toggle('active', view === 'map');
  $('btnList').classList.toggle('active', view === 'list');
  if (view === 'map') {
    // Use rAF to ensure the element is visible and has real dimensions before invalidating
    requestAnimationFrame(() => {
      state.map?.invalidateSize({ animate: false });
    });
  }
}

// ─── Map ──────────────────────────────────────────────────────────────────────
function initMap() {
  const mapEl = document.getElementById('map');

  state.map = L.map('map', {
    zoomControl: true,
    tap: !L.Browser.mobile
  }).setView([44.0, -79.5], 7);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(state.map);

  state.map.on('click', () => closeMapCard());

  // ResizeObserver catches ongoing size changes
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      state.map.invalidateSize({ animate: false });
    });
    ro.observe(mapEl);
  }

  // Mobile tile split fix: ResizeObserver only fires on CHANGES, not initial render.
  // On mobile Chrome, flex layout can take extra frames to resolve. We need explicit
  // invalidateSize calls at multiple points to catch the initial layout.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      state.map.invalidateSize({ animate: false });
    });
  });

  // Fallback for slow mobile layouts
  setTimeout(() => state.map.invalidateSize({ animate: false }), 100);
  setTimeout(() => state.map.invalidateSize({ animate: false }), 300);

  // Final check when map declares itself ready
  state.map.whenReady(() => {
    state.map.invalidateSize({ animate: false });
  });
}

function markerColor(item) {
  if (/reject/i.test(item.status || '')) return '#aaa';
  const m = item.fit?.met ?? 0;
  if (m >= 7) return '#16803a';
  if (m >= 5) return '#2b67d6';
  if (m >= 4) return '#c58900';
  return '#b3261e';
}

function refreshMap(list) {
  state.markers.forEach(m => m.remove());
  state.markers = [];
  closeMapCard();
  const bounds = [];
  list.forEach(item => {
    if (item.lat == null || item.lng == null) return;
    const marker = L.circleMarker([item.lat, item.lng], {
      radius: 10, weight: 2, color: '#fff',
      fillColor: markerColor(item), fillOpacity: 0.92,
    }).addTo(state.map);
    marker.on('click', e => { L.DomEvent.stopPropagation(e); showMapCard(item); });
    marker._hhItem = item;
    state.markers.push(marker);
    bounds.push([item.lat, item.lng]);
  });
  if (bounds.length) state.map.fitBounds(bounds, { padding: [40, 40] });
  requestAnimationFrame(() => state.map?.invalidateSize({ animate: false }));
}

// ─── Map card popup ───────────────────────────────────────────────────────────
function showMapCard(item) {
  const inner = $('mapCardInner');
  inner.innerHTML = '';
  const tpl = $('cardTemplate');
  const node = tpl.content.cloneNode(true);
  populateCard(node, item);
  // In map card, "show on map" button not useful — remove it
  node.querySelector('.show-map')?.remove();
  inner.appendChild(node);
  applyCardVisibility();
  $('mapCard').hidden = false;
  // Zoom to pin
  state.map.setView([item.lat, item.lng], Math.max(state.map.getZoom(), 12));
}

function closeMapCard() { $('mapCard').hidden = true; }

// ─── Card builder ─────────────────────────────────────────────────────────────
function tag(text, cls = '') { return `<span class="tag ${cls}">${esc(text)}</span>`; }

function populateCard(node, item) {
  const poc = item.poc || null;

  // Photo
  const img = node.querySelector('.photo');
  img.src = item.image || '';
  img.alt = item.address;
  if (!item.image) node.querySelector('.card-photo-wrap').style.display = 'none';

  // Status badge
  const badge = node.querySelector('.card-status-badge');
  const st = (item.status || '').toLowerCase();
  if (st && st !== 'new' && st !== 'poc') {
    badge.textContent = item.status;
    badge.className = 'card-status-badge ' +
      (/reject/i.test(st) ? 'badge-rejected' : /short/i.test(st) ? 'badge-shortlist' : 'badge-reviewing');
  }

  // Address + meta
  node.querySelector('.address').textContent = item.address;
  node.querySelector('.meta').textContent = [item.beds && item.beds + ' beds', item.propertyType !== 'House Hunter POC' && item.propertyType].filter(Boolean).join(' · ');

  // Fit badge
  const fit = item.fit;
  const fb = node.querySelector('.fit-badge');
  fb.innerHTML = `<strong>${esc(fit.label)}</strong><span>fit</span>`;
  fb.className = 'fit-badge ' + (fit.met >= 7 ? 'fit-green' : fit.met >= 5 ? 'fit-blue' : fit.met >= 4 ? 'fit-amber' : 'fit-red');

  // Price
  node.querySelector('.card-price').textContent = money(item.price);

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

  // Stats
  const statTags = [
    item.beds && tag(String(item.beds) + ' beds'),
    item.baths && tag(num(item.baths) + ' baths'),
    item.sqft && tag(num(item.sqft) + ' sqft'),
    item.acres && tag(num(item.acres, ' ac')),
    !poc && item.dom && tag(num(item.dom) + ' DOM'),
    !poc && item.imageCount && tag(num(item.imageCount) + ' photos'),
  ].filter(Boolean);
  node.querySelector('.card-stats').innerHTML = statTags.join('');

  // Financial
  if (poc) {
    const pitVal = item.pitNum ? money(item.pitNum) : (item.pit || '');
    const dueVal = item.dueClosing || '';
    node.querySelector('.card-financial').innerHTML = [
      pitVal  && `<div class="fin-row"><span class="fin-label">Monthly PIT</span><span class="fin-value">${esc(pitVal)}</span></div>`,
      dueVal  && `<div class="fin-row"><span class="fin-label">Due at closing</span><span class="fin-value">${esc(dueVal)}</span></div>`,
    ].filter(Boolean).join('');
  }

  // Ratings
  if (poc) {
    const rows = [
      item.markRank  && `<div class="rating-row"><span class="rating-who">Mark</span><span class="rating-stars">${stars(item.markRank)}</span></div>`,
      item.katieRank && `<div class="rating-row"><span class="rating-who">Katie</span><span class="rating-stars">${stars(item.katieRank)}</span></div>`,
    ].filter(Boolean);
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

  // Comments
  if (poc) {
    const lastLine = s => s ? s.split('|').pop().replace(/^\d{4}-\d{2}-\d{2}: /, '').trim() : '';
    const rows = [
      item.markComments    && `<div class="comment-line"><span class="comment-who">Mark</span>${esc(lastLine(item.markComments))}</div>`,
      item.katieComments   && `<div class="comment-line"><span class="comment-who">Katie</span>${esc(lastLine(item.katieComments))}</div>`,
      item.realtorComments && `<div class="comment-line"><span class="comment-who">Anees</span>${esc(lastLine(item.realtorComments))}</div>`,
    ].filter(Boolean);
    const el = node.querySelector('.card-comments');
    if (rows.length) el.innerHTML = rows.join('');
    else el.style.display = 'none';
  }

  // Actions
  const linkBtn = node.querySelector('.card-link-btn');
  const docBtn  = node.querySelector('.card-doc-btn');
  if (poc?.link) linkBtn.href = poc.link; else linkBtn.style.display = 'none';
  if (poc?.doc)  docBtn.href  = poc.doc;  else docBtn.style.display = 'none';

  // Show on map (list view only — switches to map view and shows card)
  const showMapBtn = node.querySelector('.show-map');
  if (showMapBtn) {
    showMapBtn.addEventListener('click', () => {
      switchView('map');
      const marker = state.markers.find(m => m._hhItem === item);
      if (marker) {
        state.map.setView(marker.getLatLng(), 13);
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
  if (mode === 'fit-desc')      s.sort((a,b) => cmp(a,b, x => x.fit.met, -1));
  if (mode === 'price-asc')     s.sort((a,b) => cmp(a,b, x => x.price, 1));
  if (mode === 'price-desc')    s.sort((a,b) => cmp(a,b, x => x.price, -1));
  if (mode === 'go-asc')        s.sort((a,b) => cmp(a,b, x => x.poc?.goTotal ?? x.dom, 1));
  if (mode === 'sqft-desc')     s.sort((a,b) => cmp(a,b, x => x.sqft, -1));
  if (mode === 'lot-desc')      s.sort((a,b) => cmp(a,b, x => x.acres, -1));
  if (mode === 'markrank-desc') s.sort((a,b) => cmp(a,b, x => x.markRank ? +x.markRank : null, -1));
  return s;
}

// ─── Load ─────────────────────────────────────────────────────────────────────
function filterParams() {
  const p = new URLSearchParams();
  ['q','minPrice','maxPrice','minBeds','minBaths','minFit','resultsPerPage'].forEach(id => {
    const v = $(id)?.value.trim();
    if (v) p.set(id, v);
  });
  return p;
}

async function load() {
  const source = currentSource();
  $('summary').textContent = source === 'poc' ? 'Loading your POC data…' : 'Loading Repliers sample data…';
  $('sourcePill').textContent = source === 'poc' ? 'POC' : 'Repliers';
  const res = await fetch((source === 'poc' ? '/api/poc-listings' : '/api/listings') + '?' + filterParams());
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || data.error || 'Load failed');
  const sf = $('filterStatus')?.value || '';
  let listings = data.listings;
  if (sf === 'active')   listings = listings.filter(x => !/reject/i.test(x.status || ''));
  if (sf === 'rejected') listings = listings.filter(x => /reject/i.test(x.status || ''));
  state.listings = listings;
  const summaryText = source === 'poc'
    ? `${listings.length} of ${data.sourceCount} POC listings`
    : `${listings.length} shown · ${Number(data.sourceCount).toLocaleString()} Repliers sample available`;
  if ($('summary'))     $('summary').textContent = summaryText;
  if ($('summaryList')) $('summaryList').textContent = summaryText;
  if (source === 'poc') state.map?.setView([44.0, -79.5], 7);
  else state.map?.setView([39.5, -95], 4);
  refreshMap(listings);
  renderCards(listings);
}

function reset() {
  ['q','minPrice','maxPrice','minBeds','minBaths','minFit','filterStatus'].forEach(id => { const el=$(id); if(el) el.value=''; });
  $('resultsPerPage').value = '60';
  load().catch(showError);
}
function showError(err) { console.error(err); $('summary').textContent = 'Error: ' + err.message; }

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadTheme();

  // Double rAF: defers map init until after browser layout AND first paint.
  // On Android Chrome, Leaflet reads container size synchronously at init.
  // Without this, the container reports 0px height even with correct CSS,
  // causing the tile split. Two rAF calls guarantee real pixel dimensions.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      initMap();
      load().catch(showError);
    });
  });

  $('load').addEventListener('click', () => load().catch(showError));
  $('reset').addEventListener('click', reset);
  $('source').addEventListener('change', () => { buildSettingsPanel(); load().catch(showError); });
  $('sort')?.addEventListener('change', e => { syncSort(e.target.value); renderCards(state.listings); refreshMap(state.listings); });
  $('sortList')?.addEventListener('change', e => { syncSort(e.target.value); renderCards(state.listings); });
  $('btnMap').addEventListener('click', () => switchView('map'));
  $('btnList').addEventListener('click', () => switchView('list'));
  $('themeBtn').addEventListener('click', cycleTheme);
  $('settingsBtn').addEventListener('click', openSettings);
  $('settingsClose').addEventListener('click', closeSettings);
  $('settingsOverlay').addEventListener('click', closeSettings);
  $('mapCardClose').addEventListener('click', closeMapCard);
  $('settingsSelectAll').addEventListener('click', () => { CARD_FIELDS.forEach(f => cardSettings[f.key] = true); saveSettings(); buildSettingsPanel(); applyCardVisibility(); });
  $('settingsSelectNone').addEventListener('click', () => { CARD_FIELDS.forEach(f => { if (f.key !== 'actions') cardSettings[f.key] = false; }); saveSettings(); buildSettingsPanel(); applyCardVisibility(); });
  $('settingsReset').addEventListener('click', () => { localStorage.removeItem(SETTINGS_KEY); cardSettings = loadSettings(); saveSettings(); buildSettingsPanel(); applyCardVisibility(); });
});
