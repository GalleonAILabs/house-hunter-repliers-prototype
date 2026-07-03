const state = { map: null, markers: [], listings: [] };

const $ = (id) => document.getElementById(id);
const money = (v) => v == null ? 'Price hidden' : v.toLocaleString('en-CA', { style: 'currency', currency: currentSource() === 'poc' ? 'CAD' : 'USD', maximumFractionDigits: 0 });
const num = (v, suffix = '') => v == null ? 'n/a' : `${Number(v).toLocaleString()}${suffix}`;

function currentSource() {
  return $('source')?.value || 'poc';
}

function params() {
  const p = new URLSearchParams();
  for (const id of ['q', 'minPrice', 'maxPrice', 'minBeds', 'minBaths', 'minFit', 'resultsPerPage']) {
    const value = $(id).value.trim();
    if (value) p.set(id, value);
  }
  return p;
}

function sortListings(list) {
  const mode = $('sort').value;
  const sorted = [...list];
  const val = (x, k) => x[k] == null ? null : Number(x[k]);
  function cmp(a, b, getter, dir = 1) {
    const av = getter(a), bv = getter(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dir;
  }
  if (mode === 'fit-desc') sorted.sort((a, b) => cmp(a, b, x => x.fit.met, -1));
  if (mode === 'price-asc') sorted.sort((a, b) => cmp(a, b, x => val(x, 'price'), 1));
  if (mode === 'price-desc') sorted.sort((a, b) => cmp(a, b, x => val(x, 'price'), -1));
  if (mode === 'dom-asc') sorted.sort((a, b) => cmp(a, b, x => val(x, 'dom'), 1));
  if (mode === 'sqft-desc') sorted.sort((a, b) => cmp(a, b, x => val(x, 'sqft'), -1));
  if (mode === 'lot-desc') sorted.sort((a, b) => cmp(a, b, x => val(x, 'acres'), -1));
  return sorted;
}

function initMap() {
  state.map = L.map('map', { zoomControl: true }).setView([39.5, -95], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(state.map);
}

function markerColor(item) {
  if (item.fit.met >= 5) return '#16803a';
  if (item.fit.met >= 4) return '#2b67d6';
  if (item.fit.met >= 3) return '#c58900';
  return '#b3261e';
}

function refreshMap(list) {
  state.markers.forEach(m => m.remove());
  state.markers = [];
  const bounds = [];
  for (const item of list) {
    if (item.lat == null || item.lng == null) continue;
    const marker = L.circleMarker([item.lat, item.lng], {
      radius: 9,
      weight: 2,
      color: '#fff',
      fillColor: markerColor(item),
      fillOpacity: 0.9,
    }).addTo(state.map);
    marker.bindPopup(`
      <strong>${escapeHtml(item.address)}</strong><br>
      ${money(item.price)}<br>
      Fit: ${item.fit.label}<br>
      ${num(item.beds)} beds, ${num(item.baths)} baths, ${num(item.sqft, ' sqft')}<br>
      ${item.poc ? `GO: ${escapeHtml(item.poc.go || 'n/a')}<br>Total to Union: ${escapeHtml(item.poc.goTotal || 'n/a')} min` : `DOM: ${num(item.dom)}`}
    `);
    marker._hhItem = item;
    state.markers.push(marker);
    bounds.push([item.lat, item.lng]);
  }
  if (bounds.length) state.map.fitBounds(bounds, { padding: [30, 30] });
  setTimeout(() => state.map.invalidateSize(), 50);
  setTimeout(() => state.map.invalidateSize(), 400);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function tag(text, cls = '') {
  return `<span class="tag ${cls}">${escapeHtml(text)}</span>`;
}

function renderCards(list) {
  const cards = $('cards');
  cards.innerHTML = '';
  const sorted = sortListings(list);
  const tpl = $('cardTemplate');
  for (const item of sorted) {
    const node = tpl.content.cloneNode(true);
    const card = node.querySelector('.card');
    const img = node.querySelector('.photo');
    img.src = item.image || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="450"%3E%3Crect width="100%25" height="100%25" fill="%23ddd"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-family="sans-serif" font-size="24"%3ENo photo%3C/text%3E%3C/svg%3E';
    img.alt = item.address;
    node.querySelector('.address').textContent = item.address;
    node.querySelector('.meta').textContent = [item.propertyType, item.style, item.status].filter(Boolean).join(' · ');
    node.querySelector('.fit').innerHTML = `<strong>${item.fit.label}</strong><span>fit</span>`;
    node.querySelector('.price').textContent = money(item.price);
    const facts = [
      `${num(item.beds)} beds`,
      `${num(item.baths)} baths`,
      `${num(item.sqft, ' sqft')}`,
      `${num(item.acres, ' ac')}`,
    ];
    if (item.poc) {
      facts.push(`${item.poc.goTotal || 'n/a'} min to Union`);
      if (item.poc.markRank) facts.push(`Mark ${item.poc.markRank}★`);
      if (item.poc.katieRank) facts.push(`Katie ${item.poc.katieRank}★`);
      if (item.poc.pit) facts.push(`PIT ${item.poc.pit}`);
    } else {
      facts.push(`${num(item.dom)} DOM`);
      facts.push(`${num(item.imageCount)} photos`);
    }
    node.querySelector('.facts').innerHTML = facts.map(x => tag(x)).join('');
    node.querySelector('.tags').innerHTML = [
      ...item.fit.metLabels.slice(0, 4).map(x => tag('✓ ' + x, 'good')),
      ...item.fit.failedLabels.slice(0, 3).map(x => tag('× ' + x, 'bad')),
    ].join('');
    const insight = node.querySelector('.insight');
    if (item.imageSummary) {
      insight.textContent = item.imageSummary;
    } else {
      insight.remove();
    }
    const dl = node.querySelector('.source');
    const sourceRows = item.poc ? {
      Row: item.poc.row,
      'Nearest GO': item.poc.go,
      'GO drive': item.poc.goMin ? `${item.poc.goMin} min` : '',
      'Train to Union': item.poc.goTrain ? `${item.poc.goTrain} min` : '',
      'Total to Union': item.poc.goTotal ? `${item.poc.goTotal} min` : '',
      'Research doc': item.poc.doc,
      'Listing link': item.poc.link,
    } : {
      MLS: item.mls,
      Brokerage: item.brokerage,
      Agent: item.agent,
      'Original price': money(item.originalPrice),
      Estimate: money(item.estimate),
      Heating: item.heating,
      Class: item.rawClass,
    };
    dl.innerHTML = Object.entries(sourceRows).map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v || 'n/a')}</dd>`).join('');
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
}

async function load() {
  const source = currentSource();
  $('summary').textContent = source === 'poc' ? 'Loading your House Hunter POC data…' : 'Loading Repliers sample data…';
  const endpoint = source === 'poc' ? '/api/poc-listings' : '/api/listings';
  const res = await fetch(endpoint + '?' + params().toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || data.error || 'Load failed');
  state.listings = data.listings;
  if (source === 'poc') {
    $('summary').textContent = `${data.returned} shown from your ${Number(data.sourceCount).toLocaleString()} POC listings.`;
  } else {
    $('summary').textContent = `${data.returned} shown from Repliers page of ${data.pageSize}; ${Number(data.sourceCount).toLocaleString()} sample listings available.`;
  }
  refreshMap(state.listings);
  renderCards(state.listings);
}

function reset() {
  for (const id of ['q', 'minPrice', 'maxPrice', 'minBeds', 'minBaths', 'minFit']) $(id).value = '';
  $('resultsPerPage').value = '60';
  load().catch(showError);
}

function showError(err) {
  console.error(err);
  $('summary').textContent = 'Error: ' + err.message;
}

window.addEventListener('DOMContentLoaded', () => {
  initMap();
  $('load').addEventListener('click', () => load().catch(showError));
  $('reset').addEventListener('click', reset);
  $('source').addEventListener('change', () => load().catch(showError));
  $('sort').addEventListener('change', () => renderCards(state.listings));
  load().catch(showError);
});
