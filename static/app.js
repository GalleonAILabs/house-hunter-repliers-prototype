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
  { key: 'ratings',   label: 'Ratings',                   desc: 'Per-person star ratings',            defaultOn: true  },
  { key: 'fit',       label: 'Fit score tags',            desc: 'What the property fails on',         defaultOn: true  },
  { key: 'features',  label: 'Features',                  desc: 'Loft, home office, shop, etc.',      defaultOn: true,  pocOnly: true },
  { key: 'comments',  label: 'Latest comments',           desc: 'Most recent note per person',        defaultOn: false },
  { key: 'feedbackActions', label: 'Rate / note / reject controls', desc: 'Record your feedback as the selected actor', defaultOn: true },
  { key: 'actions',   label: 'Action buttons',            desc: 'View listing, research doc, map',    defaultOn: true  },
];
const SETTINGS_KEY = 'hh_card_fields_v1';

// ─── Actor identity (D3/D11 auth, "I am" selector) ─────────────────────────────
// Shared-secret deterrent, not real security — visible in browser JS by
// design; see tasks/plan.md D3/D11 for the accepted tradeoff. Fetched from
// GET /api/config on startup (that one endpoint is deliberately unprotected
// so the frontend can bootstrap it) rather than hardcoded, so app.js and
// .env can't drift out of sync.
let APP_TOKEN = null;
const WHO_KEY = 'hh_who_am_i';
const authHeaders = () => ({ 'X-App-Token': APP_TOKEN });

async function loadConfig() {
  const res = await fetch('/api/config');
  const data = await res.json();
  APP_TOKEN = data.auth_token;
}

// ─── State ────────────────────────────────────────────────────────────────────
const state = { map: null, markers: [], rawListings: [], listings: [], activeView: 'map', people: [], activePerson: null, feedback: {}, openMapItem: null, source: 'poc', sourceCount: 0 };
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
}

function setActivePerson(id) {
  state.activePerson = id || null;
  if (state.activePerson) localStorage.setItem(WHO_KEY, String(state.activePerson));
  else localStorage.removeItem(WHO_KEY);
  applyFiltersAndRender();
  if (state.openMapItem) showMapCard(state.openMapItem);
}

// ─── Per-person rating/consensus filters (dynamic, one row per person) ────────
// Checkboxes, OR'd within a person: check 3★+4★+5★ to replicate an old
// "3+ stars" filter. No boxes checked = that person's filter is ignored.
const PERSON_FILTER_OPTIONS = [
  { value: 'not_rated', label: 'Not rated', title: 'Not rated yet' },
  { value: '1', label: '1★', title: '1 star' },
  { value: '2', label: '2★', title: '2 stars' },
  { value: '3', label: '3★', title: '3 stars' },
  { value: '4', label: '4★', title: '4 stars' },
  { value: '5', label: '5★', title: '5 stars' },
  { value: 'said_no', label: 'Said no', title: 'Said no' },
];

function personFilterCbId(personId, value) { return `personFilter_${personId}_${value}`; }

function buildPersonFilters() {
  const container = $('personFilters');
  if (!container) return;
  container.innerHTML = state.people.map(p => `
    <div class="person-filter-block">
      <div class="person-filter-name">${esc(p.name)}</div>
      ${PERSON_FILTER_OPTIONS.map(o => `
        <label class="chip" title="${esc(o.title)}">
          <input type="checkbox" id="${personFilterCbId(p.id, o.value)}" data-person-id="${p.id}" data-value="${o.value}" />
          ${esc(o.label)}
        </label>
      `).join('')}
    </div>
  `).join('');
  container.querySelectorAll('input[type=checkbox]').forEach(cb => {
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

function matchesStatusFilter(listingId, value) {
  if (!value || !state.activePerson) return true; // no-op without an active actor
  const f = personFeedbackFor(listingId, state.activePerson);
  const saidNo = f?.status === 'rejected';
  if (value === 'active') return !saidNo;
  if (value === 'rejected') return saidNo;
  return true;
}

// ─── Keyword search (live, client-side, no Apply needed) ─────────────────────
function matchesKeyword(item, keyword) {
  if (!keyword) return true;
  const feedbackList = state.feedback[item.mls] || [];
  const hay = [
    item.address, item.city, item.state, item.propertyType, item.style,
    item.brokerage, item.goStation, item.features,
    ...feedbackList.map(f => f.note), ...feedbackList.map(f => f.research_note),
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(keyword);
}

// ─── Numeric range helpers (PIT / due-at-closing, client-side only — POC-only fields) ──
function matchesRange(value, minId, maxId) {
  const min = numericFieldValue(minId);
  const max = numericFieldValue(maxId);
  if (!min && !max) return true;
  if (value == null) return false; // an active min/max can't match an unknown value
  if (min && value < Number(min)) return false;
  if (max && value > Number(max)) return false;
  return true;
}

function filterByFeedback(listings) {
  const statusVal = $('filterStatus')?.value || '';
  const keyword = ($('q')?.value || '').trim().toLowerCase();
  const personFilters = state.people.map(p => ({ id: p.id, values: checkedValuesFor(p.id) }));
  return listings.filter(item => {
    if (!matchesStatusFilter(item.mls, statusVal)) return false;
    if (!matchesKeyword(item, keyword)) return false;
    if (!matchesRange(item.pitNum, 'minPit', 'maxPit')) return false;
    if (!matchesRange(item.dueNum, 'minDue', 'maxDue')) return false;
    return personFilters.every(pf => matchesPersonFilter(item.mls, pf.id, pf.values));
  });
}

function applyFiltersAndRender() {
  state.listings = filterByFeedback(state.rawListings);
  refreshMap(state.listings);
  renderCards(state.listings);
  const summaryText = state.source === 'poc'
    ? `${state.listings.length} of ${state.sourceCount} POC listings`
    : `${state.listings.length} shown · ${Number(state.sourceCount).toLocaleString()} Repliers sample available`;
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
    renderCards(state.listings);
    if (state.openMapItem === item) showMapCard(item);
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

  const noteToggle = document.createElement('button');
  noteToggle.type = 'button';
  noteToggle.className = 'secondary fb-btn';
  noteToggle.textContent = '📝 Note';
  const noteBox = document.createElement('div');
  noteBox.className = 'feedback-compose';
  noteBox.hidden = true;
  const noteInput = document.createElement('textarea');
  noteInput.placeholder = 'Add a note…';
  noteInput.value = mine.note || '';
  const noteSave = document.createElement('button');
  noteSave.type = 'button';
  noteSave.textContent = 'Save note';
  noteSave.addEventListener('click', () => {
    const note = noteInput.value.trim();
    if (!note) return;
    submitFeedback(item, 'note', { note }, statusEl);
  });
  noteBox.append(noteInput, noteSave);
  noteToggle.addEventListener('click', () => { noteBox.hidden = !noteBox.hidden; });

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
  const alreadyRequested = mine.status === 'research_requested';
  if (alreadyRequested) researchBtn.classList.add('fb-btn-requested');
  researchBtn.textContent = alreadyRequested ? '✅ Requested' : '🔍 Research';
  researchBtn.addEventListener('click', () => {
    // Placeholder until the real research agent is wired in — the note
    // captures the actual question so it's not lost once that lands.
    const question = prompt('What should the research agent look into for this property?');
    if (!question || !question.trim()) return;
    submitFeedback(item, 'research_request', { note: question.trim() }, statusEl);
  });

  const btnRow = document.createElement('div');
  btnRow.className = 'feedback-btn-row';
  btnRow.append(noteToggle, rejectToggle, researchBtn);

  container.append(starsLabel, starsRow, btnRow, noteBox, rejectBox, statusEl);
}

// ─── View toggle ──────────────────────────────────────────────────────────────
function switchView(view) {
  state.activeView = view;
  $('viewMap').hidden = view !== 'map';
  $('viewList').hidden = view !== 'list';
  $('btnMap').classList.toggle('active', view === 'map');
  $('btnList').classList.toggle('active', view === 'list');
  if (view === 'map') requestAnimationFrame(() => state.map?.invalidateSize({ animate: false }));
}

// ─── Map, same pattern as the working POC: #map is 100% of the page ───────────
function initMap() {
  state.map = L.map('map', { zoomControl: true }).setView([44.0, -79.5], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 19
  }).addTo(state.map);
  state.map.on('click', () => { closeMapCard(); closeFilters(); });
  window.addEventListener('resize', () => state.map?.invalidateSize({ animate: false }));
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
    marker.on('click', e => { L.DomEvent.stopPropagation(e); showMapCard(item); closeFilters(); });
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
  state.openMapItem = item;
  // Zoom to pin
  state.map.setView([item.lat, item.lng], Math.max(state.map.getZoom(), 12));
}

function closeMapCard() { $('mapCard').hidden = true; state.openMapItem = null; }

function closeFilters() {
  const fb = $('filterbox');
  if (fb) fb.open = false;
}

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

  // Ratings — dynamic per person (D9), replaces hardcoded Mark/Katie
  {
    const feedbackList = state.feedback[item.mls] || [];
    const rows = feedbackList
      .filter(f => f.rating != null || f.status)
      .map(f => {
        const statusTag = f.status ? ` <span class="tag${f.status === 'rejected' ? ' bad' : ''}">${esc(f.status)}</span>` : '';
        return `<div class="rating-row"><span class="rating-who">${esc(f.person_name)}</span><span class="rating-stars">${stars(f.rating)}</span>${statusTag}</div>`;
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

  // Comments — dynamic per person (D9), replaces hardcoded Mark/Katie/Anees
  {
    const feedbackList = state.feedback[item.mls] || [];
    const rows = [
      ...feedbackList.filter(f => f.note).map(f =>
        `<div class="comment-line"><span class="comment-who">${esc(f.person_name)}</span>${esc(f.note)}</div>`),
      ...feedbackList.filter(f => f.research_note).map(f =>
        `<div class="comment-line"><span class="comment-who">${esc(f.person_name)} (research)</span>${esc(f.research_note)}</div>`),
    ];
    const el = node.querySelector('.card-comments');
    if (rows.length) el.innerHTML = rows.join('');
    else el.style.display = 'none';
  }

  // Feedback actions (D7/D12) — shared control set for List cards and Map popups
  buildFeedbackActions(node, item);

  // Actions
  const linkBtn = node.querySelector('.card-link-btn');
  const docBtn  = node.querySelector('.card-doc-btn');
  if (poc?.link) linkBtn.href = poc.link; else linkBtn.style.display = 'none';
  if (poc?.doc) {
    docBtn.href = poc.doc;
    docBtn.textContent = 'Research doc';
  } else {
    // Repliers listings have no research doc yet — fall back to a Drive search.
    docBtn.href = 'https://drive.google.com/drive/search?q=' + encodeURIComponent(item.address || '');
    docBtn.textContent = 'Search Drive';
  }

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
  // Note: minBaths/maxBaths can be decimal (step=0.5) — read directly, not
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
  return p;
}

async function load() {
  const source = currentSource();
  $('summary').textContent = source === 'poc' ? 'Loading your POC data…' : 'Loading Repliers sample data…';
  $('sourcePill').textContent = source === 'poc' ? 'POC' : 'Repliers';
  const res = await fetch((source === 'poc' ? '/api/poc-listings' : '/api/listings') + '?' + filterParams());
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || data.error || 'Load failed');
  state.rawListings = data.listings;
  state.source = source;
  state.sourceCount = data.sourceCount;
  state.feedback = await fetchFeedback(state.rawListings.map(x => x.mls));
  if (source === 'poc') state.map?.setView([44.0, -79.5], 7);
  else state.map?.setView([39.5, -95], 4);
  applyFiltersAndRender();
}

function reset() {
  ['q','minPrice','maxPrice','minBeds','maxBeds','minBaths','maxBaths','minPit','maxPit','minDue','maxDue','minFit','filterStatus']
    .forEach(id => { const el=$(id); if(el) { el.value=''; delete el.dataset.raw; } });
  $('resultsPerPage').value = '60';
  state.people.forEach(p => {
    PERSON_FILTER_OPTIONS.forEach(o => { const cb = $(personFilterCbId(p.id, o.value)); if (cb) cb.checked = false; });
  });
  load().catch(showError);
}
function showError(err) { console.error(err); $('summary').textContent = 'Error: ' + err.message; }

// ─── Init ─────────────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

window.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  initMap();
  ['minPrice', 'maxPrice', 'minPit', 'maxPit', 'minDue', 'maxDue'].forEach(wirePriceInput);
  loadConfig()
    .then(() => {
      loadPeople().then(applyFiltersAndRender);
      return load();
    })
    .catch(showError);
  $('whoAmI').addEventListener('change', e => setActivePerson(Number(e.target.value) || null));
  $('load').addEventListener('click', () => load().catch(showError));
  $('reset').addEventListener('click', reset);
  $('filterStatus')?.addEventListener('change', applyFiltersAndRender);
  $('q')?.addEventListener('input', debounce(applyFiltersAndRender, 150));
  $('minPit')?.addEventListener('change', applyFiltersAndRender);
  $('maxPit')?.addEventListener('change', applyFiltersAndRender);
  $('minDue')?.addEventListener('change', applyFiltersAndRender);
  $('maxDue')?.addEventListener('change', applyFiltersAndRender);
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
