/* Dry Earth: three maps about drought.
   Plain JavaScript + MapLibre GL JS, no build step. All data is read from ./data. */
(() => {
  'use strict';

  // ── Set these two for your own page ────────────────────────────────────────
  const AUTHOR = 'Aigul Bekbayeva';     
  const REPO_URL = 'https://github.com/AigulBekbayeva/dry_earth';  

  // ── Colours ────────────────────────────────────────────────────────────────
  // The map is dark, so every ramp runs dark → bright: the brighter, the more of the thing.
  const C = { ocean: '#0e2630', land: '#2a3a41', graticule: '#1d3c48' };

  const PRECIP = {
    breaks: [25, 100, 250, 500, 1000, 2000],
    colors: ['#fff0b8', '#edc65a', '#c4ae62', '#8a9a6b', '#4f7f6e', '#2b6464', '#1f5560'],
    labels: ['Under 25 mm', '25–100', '100–250', '250–500', '500–1,000', '1,000–2,000', 'Over 2,000 mm'],
  };
  const ARID = {
    breaks: [0.05, 0.2, 0.5, 0.65],
    colors: ['#fff0b8', '#edc65a', '#b5a867', '#5f8a70', '#1f5560'],
    labels: ['Hyper-arid', 'Arid', 'Semi-arid', 'Dry sub-humid', 'Humid'],
    ranges: ['under 0.05', '0.05–0.2', '0.2–0.5', '0.5–0.65', 'over 0.65'],
  };
  const CHANGE = {
    breaks: [-6, -3, -1, 1, 3, 6, 10],
    colors: ['#ffc56b', '#d98a3d', '#8f6a4f', '#4e5a5e', '#3f7f88', '#3fa3ad', '#6fd0d6', '#c4f3f1'],
  };
  const M3 = {
    score: { title: 'Overlap score, 0–100', breaks: [25, 35, 45, 60], unit: '',
      colors: ['#2f3554', '#5a3f78', '#96448f', '#d6569a', '#ffb0c8'],
      note: 'All three ingredients combined. Bright countries are high on every one of them.' },
    D: { title: 'Drought frequency, % of 12-month periods', breaks: [5, 8, 12, 19], unit: '%',
      colors: ['#3a3428', '#6b5632', '#a67c3a', '#dda347', '#ffd98a'],
      note: 'How often a year\'s rain fell more than 20% short of normal, 1979–2010.' },
    P: { title: 'Population density, people per km²', breaks: [25, 60, 100, 150], unit: '',
      colors: ['#27384f', '#34587f', '#4b7fb0', '#78aedd', '#c2e2ff'],
      note: 'People per square kilometre of land, latest World Bank figure.' },
    A: { title: 'Employment in agriculture, % of all jobs', breaks: [5, 10, 25, 40], unit: '%',
      colors: ['#26402f', '#356b45', '#4f9a5b', '#86c77a', '#d2f2b0'],
      note: 'Share of working people whose job is in farming, herding, forestry or fishing.' },
  };
  const INGREDIENT_INK = { D: '#b5791f', P: '#3e6fa3', A: '#3f8a4d' };   // bar colours on the light panel

  const SCEN = {
    ssp126: { code: 'SSP1-2.6', text: 'Emissions fall to net zero after 2050. About 1.8 °C above pre-industrial levels by 2100.' },
    ssp245: { code: 'SSP2-4.5', text: 'Emissions stay near today\'s level until mid-century. About 2.7 °C above pre-industrial levels by 2100.' },
    ssp370: { code: 'SSP3-7.0', text: 'Emissions roughly double by 2100. About 3.6 °C above pre-industrial levels by 2100.' },
    ssp585: { code: 'SSP5-8.5', text: 'Emissions roughly double by 2050. About 4.4 °C above pre-industrial levels by 2100.' },
  };

  const HOME = { 1: [18, 18], 2: [5, 24], 3: [58, 14] };
  const GRID_W = 2160, GRID_H = 1080;

  // ── State ──────────────────────────────────────────────────────────────────
  const state = { map: 1, m1: 'precip', scen: 'ssp245', m3: 'score', region: 'MED', projection: 'globe' };
  const data = {};
  let map, grid, markers = { 1: [], 3: [] }, hoverId = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtInt = n => Math.round(n).toLocaleString('en-US');
  const signed = (n, d = 1) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d);
  const listAnd = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  const classOf = (v, breaks) => { let k = 0; while (k < breaks.length && v >= breaks[k]) k++; return k; };
  const stepExpr = (input, breaks, colors) => {
    const e = ['step', input, colors[0]];
    breaks.forEach((b, i) => e.push(b, colors[i + 1]));
    return e;
  };

  // ── Start ──────────────────────────────────────────────────────────────────
  const fromHash = () => { const m = /^#0?([123])$/.exec(location.hash); return m ? +m[1] : null; };
  state.map = fromHash() || 1;

  init().catch(err => {
    console.error(err);
    const s = $('#status');
    s.hidden = false;
    s.textContent = location.protocol === 'file:'
      ? 'The map data could not be loaded because this page was opened as a file. Serve the folder instead: run "python -m http.server" in it and open http://localhost:8000.'
      : 'The map data could not be loaded. Check your connection and reload the page.';
  });

  async function init() {
    map = new maplibregl.Map({
      container: 'map',
      center: HOME[state.map],
      zoom: homeZoom(HOME[state.map][1]),
      minZoom: 0.4,
      maxZoom: 7,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      style: {
        version: 8,
        projection: { type: 'globe' },
        sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 4, 0.35, 6, 0] },
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': C.ocean } }],
      },
    });
    window.dryEarthMap = map;   // handy in the browser console
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();

    const json = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
    const [m1, m2, m3, regions, countries, img] = await Promise.all([
      json('data/map01.json'), json('data/map02.json'), json('data/map03.json'),
      json('data/regions.geojson'), json('data/countries.geojson'), loadImage('data/dryness.png'),
      new Promise(res => map.once('load', res)),
    ]);
    Object.assign(data, { m1, m2, m3, regions, countries });
    data.regionById = Object.fromEntries(regions.features.map(f => [f.properties.id, f.properties]));

    grid = decodeGrid(img);
    addLayers();
    buildPanel();
    bindControls();
    bindMapEvents();
    showMap(state.map, false);
    $('#status').hidden = true;
    map.once('idle', () => { document.documentElement.dataset.ready = '1'; });
  }

  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(src)); i.src = src; });
  }

  // ── Map 01 raster ──────────────────────────────────────────────────────────
  // dryness.png stores numbers, not colours: R,G = precipitation in mm (16 bit), B = aridity index × 100.
  function decodeGrid(img) {
    const c = document.createElement('canvas');
    c.width = GRID_W; c.height = GRID_H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, GRID_W, GRID_H).data;
    const precip = new Uint16Array(GRID_W * GRID_H), arid = new Uint8Array(GRID_W * GRID_H);
    for (let i = 0, k = 0; i < precip.length; i++, k += 4) { precip[i] = px[k] * 256 + px[k + 1]; arid[i] = px[k + 2]; }
    return { precip, arid };
  }

  // Colour the grid and warp it from a lat/lon grid to Web Mercator, which is what MapLibre drapes on the globe.
  function paintGrid(kind) {
    const N = GRID_W, out = document.createElement('canvas');
    out.width = N; out.height = N;
    const ctx = out.getContext('2d'), im = ctx.createImageData(N, N), d = im.data;
    const spec = kind === 'precip' ? PRECIP : ARID;
    const rgb = spec.colors.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
    const lut = new Uint8Array(kind === 'precip' ? 65536 : 256);
    if (kind === 'precip') { for (let v = 0; v < 65535; v++) lut[v] = classOf(v, spec.breaks); lut[65535] = 255; }
    else { for (let v = 0; v < 255; v++) lut[v] = classOf(v / 100, spec.breaks); lut[255] = 255; }
    const src = kind === 'precip' ? grid.precip : grid.arid;
    for (let y = 0; y < N; y++) {
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / N))) * 180 / Math.PI;
      const row = Math.min(GRID_H - 1, Math.max(0, Math.floor((90 - lat) / 180 * GRID_H))) * GRID_W;
      for (let x = 0, k = y * N * 4; x < N; x++, k += 4) {
        const cls = lut[src[row + x]];
        if (cls === 255) continue;
        const c = rgb[cls];
        d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255;
      }
    }
    ctx.putImageData(im, 0, 0);
    return out;
  }

  function gridAt(lng, lat) {
    const x = ((Math.floor((lng + 180) / 360 * GRID_W) % GRID_W) + GRID_W) % GRID_W;
    const y = Math.min(GRID_H - 1, Math.max(0, Math.floor((90 - lat) / 180 * GRID_H)));
    const p = grid.precip[y * GRID_W + x], a = grid.arid[y * GRID_W + x];
    return { precip: p === 65535 ? null : p, arid: a === 255 ? null : a / 100 };
  }

  // ── Layers ─────────────────────────────────────────────────────────────────
  function graticule() {
    const lines = [];
    for (let lon = -180; lon < 180; lon += 30) { const l = []; for (let lat = -85; lat <= 85; lat += 2.5) l.push([lon, lat]); lines.push(l); }
    for (let lat = -60; lat <= 60; lat += 30) { const l = []; for (let lon = -180; lon <= 180; lon += 2.5) l.push([lon, lat]); lines.push(l); }
    return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } };
  }

  function hatchImage() {
    const s = 16, c = document.createElement('canvas');
    c.width = s; c.height = s;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = 'rgba(6,19,24,0.5)';
    ctx.lineWidth = 2;
    for (const o of [-s, 0, s]) { ctx.beginPath(); ctx.moveTo(o, s); ctx.lineTo(o + s, 0); ctx.stroke(); }
    return ctx.getImageData(0, 0, s, s);
  }

  function addLayers() {
    const world = [[-180, 85.0511], [180, 85.0511], [180, -85.0511], [-180, -85.0511]];
    map.addImage('hatch', hatchImage(), { pixelRatio: 2 });

    map.addSource('graticule', { type: 'geojson', data: graticule() });
    map.addSource('land', { type: 'geojson', data: 'data/land.geojson' });
    map.addSource('ocean', { type: 'geojson', data: 'data/ocean.geojson' });
    map.addSource('lakes', { type: 'geojson', data: 'data/lakes.geojson' });
    map.addSource('countries', { type: 'geojson', data: data.countries });
    map.addSource('regions', { type: 'geojson', data: data.regions });
    map.addSource('precip', { type: 'canvas', canvas: paintGrid('precip'), coordinates: world, animate: false });
    map.addSource('aridity', { type: 'canvas', canvas: paintGrid('aridity'), coordinates: world, animate: false });
    // A thin band on the Mercator edge: MapLibre stretches it over the pole, where the raster cannot reach.
    map.addSource('polecap', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon',
      coordinates: [[[-180, -84.9], [-180, -86], [180, -86], [180, -84.9], [-180, -84.9]]] } } });

    const add = (l, group) => { l.metadata = { group }; map.addLayer(l); };
    add({ id: 'graticule', type: 'line', source: 'graticule', paint: { 'line-color': C.graticule, 'line-width': 0.6 } }, 0);
    add({ id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': C.land, 'fill-antialias': false } }, 0);
    add({ id: 'polecap-base', type: 'fill', source: 'polecap', paint: { 'fill-color': C.land, 'fill-antialias': false } }, 0);

    add({ id: 'm1-precip', type: 'raster', source: 'precip', paint: { 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } }, 1);
    add({ id: 'm1-aridity', type: 'raster', source: 'aridity', paint: { 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } }, 1);
    add({ id: 'm1-polecap', type: 'fill', source: 'polecap',
      paint: { 'fill-color': PRECIP.colors[classOf(data.m1.pole_mm, PRECIP.breaks)], 'fill-antialias': false } }, 1);

    add({ id: 'm2-fill', type: 'fill', source: 'regions', paint: { 'fill-color': C.land, 'fill-antialias': false } }, 2);
    add({ id: 'm2-hatch', type: 'fill', source: 'regions', paint: { 'fill-pattern': 'hatch' } }, 2);

    add({ id: 'm3-fill', type: 'fill', source: 'countries', paint: { 'fill-color': C.land, 'fill-antialias': false } }, 3);

    add({ id: 'ocean', type: 'fill', source: 'ocean', paint: { 'fill-color': C.ocean } }, 0);
    add({ id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': C.ocean } }, 0);
    add({ id: 'borders', type: 'line', source: 'countries',
      paint: { 'line-color': 'rgba(6,19,24,0.5)', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 5, 1] } }, 0);
    add({ id: 'coast', type: 'line', source: 'land',
      paint: { 'line-color': 'rgba(223,232,228,0.35)', 'line-width': 0.6 } }, 0);

    add({ id: 'm2-lines', type: 'line', source: 'regions', paint: { 'line-color': 'rgba(223,232,228,0.55)', 'line-width': 0.8 } }, 2);
    add({ id: 'm2-selected', type: 'line', source: 'regions', filter: ['==', ['get', 'id'], ''],
      paint: { 'line-color': '#ffffff', 'line-width': 2.4 } }, 2);
    add({ id: 'm3-triple-case', type: 'line', source: 'countries', filter: ['==', ['get', 'triple'], 1],
      layout: { 'line-join': 'round' }, paint: { 'line-color': '#061318', 'line-width': 4.5 } }, 3);
    add({ id: 'm3-triple', type: 'line', source: 'countries', filter: ['==', ['get', 'triple'], 1],
      layout: { 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 1.8 } }, 3);

    add({ id: 'hover', type: 'line', source: 'countries', filter: ['==', ['id'], -1],
      layout: { 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 1.4 } }, 0);
    add({ id: 'country-hit', type: 'fill', source: 'countries', paint: { 'fill-opacity': 0 } }, 0);
    add({ id: 'region-hit', type: 'fill', source: 'regions', paint: { 'fill-opacity': 0 } }, 2);

    // place labels
    for (const d of data.m1.deserts) {
      if (d.name === 'Sahara (whole)') continue;
      markers[1].push(placeMarker(d.name.replace(', Egypt', ''), d.lon, d.lat));
    }
    for (const t of data.m3.top.filter(t => t.triple)) markers[3].push(placeMarker(t.name, t.lon, t.lat));
  }

  function placeMarker(text, lon, lat) {
    const el = document.createElement('div');
    el.className = 'place';
    el.textContent = text;
    return new maplibregl.Marker({ element: el, anchor: 'left', offset: [-3, 0] }).setLngLat([lon, lat]);
  }

  // ── Switching maps and layers ──────────────────────────────────────────────
  function showMap(n, move = true) {
    state.map = n;
    $$('.tabs button').forEach(b => {
      const on = +b.dataset.map === n;
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
    });
    $$('.story').forEach(s => { s.hidden = s.id !== 'story-' + n; });
    if (location.hash !== '#0' + n) history.replaceState(null, '', '#0' + n);

    for (const l of map.getStyle().layers) {
      const g = l.metadata && l.metadata.group;
      if (g) map.setLayoutProperty(l.id, 'visibility', g === n ? 'visible' : 'none');
    }
    map.setLayoutProperty('country-hit', 'visibility', n === 2 ? 'none' : 'visible');
    map.setPaintProperty('borders', 'line-color', n === 2 ? 'rgba(6,19,24,0.28)' : 'rgba(6,19,24,0.5)');
    for (const k of [1, 3]) markers[k].forEach(m => (k === n ? m.addTo(map) : m.remove()));

    if (n === 1) applyM1();
    if (n === 2) applyM2();
    if (n === 3) applyM3();
    setHover(null);
    hideTooltip();
    if (move) goHome();
    $('.panel').scrollTop = 0;
  }

  function applyM1() {
    map.setLayoutProperty('m1-precip', 'visibility', state.m1 === 'precip' ? 'visible' : 'none');
    map.setLayoutProperty('m1-aridity', 'visibility', state.m1 === 'aridity' ? 'visible' : 'none');
    map.setLayoutProperty('m1-polecap', 'visibility', state.m1 === 'precip' ? 'visible' : 'none');
    setSeg('m1-layer', state.m1);
    $$('#story-1 [data-note]').forEach(p => { p.hidden = p.dataset.note !== state.m1; });
    renderM1Legend();
  }

  function applyM2() {
    const s = state.scen;
    map.setPaintProperty('m2-fill', 'fill-color', stepExpr(['get', s + '_pr'], CHANGE.breaks, CHANGE.colors));
    map.setFilter('m2-hatch', ['<', ['get', s + '_agree'], 80]);
    map.setFilter('m2-selected', ['==', ['get', 'id'], state.region]);
    setSeg('m2-scen', s);
    const n = data.m2.n_models[s].pr;
    $('#m2-scen-note').textContent = `${SCEN[s].code}. ${SCEN[s].text} ${n} models.`;
    renderM2Lede();
    renderM2Legend();
    renderM2Rank();
    renderChart();
  }

  function applyM3() {
    const k = state.m3, spec = M3[k];
    map.setPaintProperty('m3-fill', 'fill-color',
      ['case', ['==', ['get', 'status'], 'rated'], stepExpr(['get', k], spec.breaks, spec.colors), C.land]);
    setSeg('m3-layer', k);
    $('#m3-layer-note').textContent = spec.note;
    renderM3Legend();
  }

  function setSeg(name, value) {
    $$(`[data-control="${name}"] button`).forEach(b => {
      const on = b.dataset.value === value;
      b.setAttribute('aria-checked', on);
      b.tabIndex = on ? 0 : -1;
    });
  }

  // ── Camera ─────────────────────────────────────────────────────────────────
  function homeZoom(lat) {
    const el = $('#map'), w = el.clientWidth || 900, h = el.clientHeight || 700;
    if (state.projection === 'mercator') return Math.max(0.4, Math.log2(w / 512));
    // 136 px: apparent globe diameter at zoom 0 on the equator (measured; includes the perspective shrink)
    return Math.log2(0.86 * Math.min(w, h) * Math.cos(lat * Math.PI / 180) / 136);
  }
  function go(center, zoom) {
    const opt = { center, zoom, bearing: 0, pitch: 0 };
    if (reducedMotion) map.jumpTo(opt); else map.flyTo({ ...opt, duration: 1400, essential: true });
  }
  function goHome() {
    const c = state.projection === 'mercator' ? [10, 20] : HOME[state.map];
    go(c, homeZoom(c[1]));
  }
  function goPlace(lon, lat, zoom) {
    go([lon, lat], Math.max(zoom, homeZoom(lat) + 0.2));
  }

  // ── Panel ──────────────────────────────────────────────────────────────────
  function buildPanel() {
    const { m1, m2, m3 } = data;
    const fill = (k, v) => $$(`[data-fill="${k}"]`).forEach(e => { e.textContent = v; });
    const s = m1.precip_share_land;
    fill('m1-lt250', Math.round(s[0] + s[1] + s[2]) + '%');
    fill('m1-lt25', Math.round(s[0]) + '%');
    const nm = Object.values(m2.n_models).map(v => v.pr);
    fill('m2-models', `${Math.min(...nm)} to ${Math.max(...nm)}`);
    fill('m3-triple', listAnd(m3.triple));
    fill('m3-triple-pop', (m3.pop_triple / 1e9).toFixed(1) + ' billion');
    fill('m3-n', m3.n_rated);

    // Map 01 lists
    const maxD = Math.max(...m1.deserts.map(d => d.mean_mm));
    $('#m1-deserts').className = 'rows rows-2';
    $('#m1-deserts').innerHTML = m1.deserts.map((d, i) => `<li><button data-i="${i}">
      <span class="r-name">${esc(d.name)}</span>
      <span class="bar"><i style="width:${Math.max(2, d.mean_mm / maxD * 100)}%"></i></span>
      <span class="r-val">${fmtInt(d.mean_mm)} <span class="r-sub">mm</span></span></button></li>`).join('');
    $('#m1-deserts').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const d = m1.deserts[+b.dataset.i];
      goPlace(d.lon, d.lat, d.name.startsWith('Sahara') ? 2.6 : 3.6);
    });
    const dry = m1.countries.slice(0, 10), maxC = Math.max(...dry.map(d => d.mean_mm));
    $('#m1-countries').className = 'rows rows-2';
    $('#m1-countries').innerHTML = dry.map((d, i) => `<li><button data-i="${i}">
      <span class="r-name">${esc(d.name)}</span>
      <span class="bar"><i style="width:${Math.max(2, d.mean_mm / maxC * 100)}%"></i></span>
      <span class="r-val">${fmtInt(d.mean_mm)} <span class="r-sub">mm</span></span></button></li>`).join('');
    $('#m1-countries').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const d = dry[+b.dataset.i];
      goPlace(d.lon, d.lat, 3.4);
    });

    // Map 02 ranking: clicks
    $('#m2-rank').className = 'rows rows-rank';
    $('#m2-rank').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      selectRegion(b.dataset.id, true);
    });

    // Map 03 ranking
    const key = `<span style="color:${INGREDIENT_INK.D}">■</span> drought <span style="color:${INGREDIENT_INK.P}">■</span> people <span style="color:${INGREDIENT_INK.A}">■</span> farming`;
    $('#story-3 .block-note').insertAdjacentHTML('beforeend', `<br>${key}`);
    const top = m3.top.slice(0, 12);
    $('#m3-rank').className = 'rows rows-score';
    $('#m3-rank').innerHTML = top.map((t, i) => `<li><button data-i="${i}">
      <span class="r-n">${i + 1}</span>
      <span class="r-name">${esc(t.name)}</span>
      <span class="tri" role="img" aria-label="Drought ${Math.round(t.rD * 100)}th percentile, people ${Math.round(t.rP * 100)}th, farming ${Math.round(t.rA * 100)}th">
        ${['D', 'P', 'A'].map(k => `<span class="bar"><i style="width:${t['r' + k] * 100}%;background:${INGREDIENT_INK[k]}"></i></span>`).join('')}
      </span>
      <span class="r-val">${Math.round(t.score)}</span></button></li>`).join('');
    $('#m3-rank').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const t = top[+b.dataset.i];
      goPlace(t.lon, t.lat, 3.2);
    });

    if (AUTHOR) { const a = $('#credit-author'); a.textContent = AUTHOR; a.hidden = false; }
    if (REPO_URL) $('#repo-link').href = REPO_URL + '#readme';
  }

  function renderM1Legend() {
    const precip = state.m1 === 'precip';
    const spec = precip ? PRECIP : ARID;
    const shares = precip ? data.m1.precip_share_land : data.m1.aridity_share_land_excl_antarctica;
    const max = Math.max(...shares);
    const rows = spec.labels.map((lab, i) => `
      <span class="sw" style="background:${spec.colors[i]}"></span>
      <span>${lab}${precip ? '' : ` <span class="legend-pct">${spec.ranges[i]}</span>`}</span>
      <span class="legend-bar"><i style="width:${shares[i] / max * 100}%"></i></span>
      <span class="legend-pct">${shares[i].toFixed(0)}%</span>`).join('');
    $('#m1-legend').innerHTML = `
      <p class="legend-title">${precip ? 'Precipitation a year' : 'Aridity index (precipitation ÷ evaporative demand)'}</p>
      <div class="legend-rows">${rows}</div>
      <p class="legend-note">Bars: share of the world's land in each class${precip ? '' : ', Antarctica not included'}.</p>`;
  }

  function strip(colors, ticks, left, right) {
    const n = colors.length;
    return `<div class="strip" style="display:grid;grid-template-columns:repeat(${n},1fr);gap:2px">
        ${colors.map(c => `<span style="height:14px;background:${c};border-radius:2px"></span>`).join('')}
      </div>
      <div style="position:relative;height:16px;font-size:12px;color:var(--on-dark-2)">
        ${ticks.map((t, i) => `<span style="position:absolute;left:${(i + 1) / n * 100}%;transform:translateX(-50%);top:2px">${t}</span>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-top:1px"><span>${left}</span><span>${right}</span></div>`;
  }

  function renderM2Legend() {
    $('#m2-legend').innerHTML = `
      <p class="legend-title">Change in yearly rainfall by 2041–2060, %</p>
      ${strip(CHANGE.colors, CHANGE.breaks.map(b => signed(b, 0)), 'Drier', 'Wetter')}
      <div class="legend-extra">
        <span class="sw hatch" style="background-color:#4e5a5e"></span><span>Models split: fewer than 80% agree on the direction</span>
      </div>`;
  }

  function renderM3Legend() {
    const spec = M3[state.m3];
    $('#m3-legend').innerHTML = `
      <p class="legend-title">${spec.title}</p>
      ${strip(spec.colors, spec.breaks.map(b => fmtInt(b)), 'Lower', 'Higher')}
      <div class="legend-extra">
        <span class="sw outline"></span><span>In the upper 40% on all three ingredients</span>
        <span class="sw" style="background:${C.land};outline:1px solid rgba(255,255,255,.25)"></span><span>Not rated: no data, or smaller than 5,000 km²</span>
      </div>`;
  }

  function renderM2Lede() {
    const s = state.scen;
    const drying = data.regions.features.map(f => f.properties).filter(p => p[s + '_pr'] < 0)
      .sort((a, b) => a[s + '_pr'] - b[s + '_pr']);
    const firm = drying.filter(p => p[s + '_agree'] >= 80), soft = drying.filter(p => p[s + '_agree'] < 80).slice(0, 4);
    const THE = ['MED', 'CAR', 'SAH', 'SAM', 'RAR', 'RFE', 'TIB', 'ARP'];
    const name = p => (THE.includes(p.id) ? 'the ' : '') + p.name;
    let t = firm.length
      ? `By the 2050s, <b>${firm.length} of ${data.regions.features.length}</b> regions lose rainfall in at least four out of five climate models: ${listAnd(firm.map(name))}. `
      : `By the 2050s, no region loses rainfall in at least four out of five climate models on this pathway. `;
    if (soft.length) t += `${listAnd(soft.map(name))} lean${soft.length === 1 ? 's' : ''} the same way with less agreement. `;
    t += 'Most other regions gain rain, yet all of them warm, and warmer air takes more water back from soil and crops.';
    t = t.charAt(0).toUpperCase() + t.slice(1);
    $('#story-2 .lede').innerHTML = t.replace(/\. the /g, '. The ');
  }

  function renderM2Rank() {
    const s = state.scen, lim = 15;
    const rows = data.regions.features.map(f => f.properties).sort((a, b) => a[s + '_pr'] - b[s + '_pr']).slice(0, 10);
    const pos = v => (Math.max(-lim, Math.min(lim, v)) + lim) / (2 * lim) * 100;
    $('#m2-rank').innerHTML = rows.map(p => {
      const med = p[s + '_pr'], lo = p[s + '_p10'], hi = p[s + '_p90'];
      return `<li><button data-id="${p.id}" ${p.id === state.region ? 'aria-current="true"' : ''}>
        <span class="r-name" title="${esc(p.name)}">${esc(p.name)}</span>
        <span class="interval" role="img" aria-label="Model range ${signed(lo)} to ${signed(hi)} percent">
          <span class="rng" style="left:${pos(lo)}%;width:${pos(hi) - pos(lo)}%"></span>
          <span class="zero" style="left:50%"></span>
          <span class="med" style="left:${pos(med)}%;background:${med < 0 ? 'var(--dry)' : 'var(--wet)'}"></span>
        </span>
        <span class="r-val ${med < 0 ? 'neg' : 'pos'}">${signed(med)}%</span></button></li>`;
    }).join('');
  }

  function selectRegion(id, fly) {
    state.region = id;
    map.setFilter('m2-selected', ['==', ['get', 'id'], id]);
    renderM2Rank();
    renderChart();
    if (fly) { const p = data.regionById[id]; goPlace(p.lon, p.lat, 2.2); }
  }

  // ── Map 02 chart: one region's rainfall trajectory ─────────────────────────
  function renderChart() {
    const p = data.regionById[state.region], tr = data.m2.traj[state.region][state.scen], yrs = data.m2.centres;
    $('#m2-chart-title').textContent = `${p.name}: rainfall through 2050`;
    const W = 384, H = 190, m = { l: 34, r: 50, t: 12, b: 24 };
    const lo = Math.min(0, ...tr.p10), hi = Math.max(0, ...tr.p90);
    const stepY = [1, 2, 5, 10, 20, 50].find(s => (hi - lo) / s <= 5) || 50;
    const y0 = Math.floor(lo / stepY) * stepY, y1 = Math.ceil(hi / stepY) * stepY;
    const x = v => m.l + (v - yrs[0]) / (yrs[yrs.length - 1] - yrs[0]) * (W - m.l - m.r);
    const y = v => m.t + (y1 - v) / (y1 - y0) * (H - m.t - m.b);
    const line = a => a.map((v, i) => `${i ? 'L' : 'M'}${x(yrs[i]).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const band = line(tr.p90) + tr.p10.map((v, i) => [x(yrs[i]), y(v)]).reverse().map(q => `L${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('') + 'Z';
    const end = tr.med[tr.med.length - 1], ink = end < 0 ? 'var(--dry)' : 'var(--wet)';
    let g = '';
    for (let v = y0; v <= y1 + 1e-9; v += stepY)
      g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? 'var(--ink-3)' : 'var(--rule)'}" stroke-width="1"/>
            <text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${signed(v, 0)}${v === y1 ? '%' : ''}</text>`;
    for (const t of [1980, 2000, 2020, 2040]) g += `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${t}</text>`;
    const bx0 = x(2004.5) - 3;
    $('#m2-chart').innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(p.name)}: change in yearly rainfall, ${signed(end)} percent by 2041–2060 in the middle model">
        ${g}
        <path d="${band}" fill="${ink}" opacity="0.16"/>
        <path d="${line(tr.med)}" fill="none" stroke="${ink}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${bx0 + 3}" cy="${y(0)}" r="3" fill="var(--paper)" stroke="var(--ink-3)" stroke-width="1.5"/>
        <circle cx="${x(2050)}" cy="${y(end)}" r="4" fill="${ink}" stroke="var(--paper)" stroke-width="2"/>
        <text x="${x(2050) + 8}" y="${y(end) + 4}" style="font-size:13px;font-weight:700;fill:var(--ink)">${signed(end)}%</text>
        <g class="cross" visibility="hidden">
          <line y1="${m.t}" y2="${H - m.b}" stroke="var(--ink)" stroke-width="1"/>
          <circle r="4" fill="${ink}" stroke="var(--paper)" stroke-width="2"/>
        </g>
        <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>
      </svg><div class="tip" hidden></div>`;
    const svg = $('#m2-chart svg'), cross = $('.cross', svg), tip = $('#m2-chart .tip');
    const move = e => {
      const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(yrs.length - 1, Math.round((px - m.l) / (W - m.l - m.r) * (yrs.length - 1))));
      const cx = x(yrs[i]), cy = y(tr.med[i]);
      cross.setAttribute('visibility', 'visible');
      $('line', cross).setAttribute('x1', cx); $('line', cross).setAttribute('x2', cx);
      $('circle', cross).setAttribute('cx', cx); $('circle', cross).setAttribute('cy', cy);
      tip.hidden = false;
      tip.innerHTML = `${yrs[i] - 9}–${yrs[i] + 10}: <b>${signed(tr.med[i])}%</b><br>models ${signed(tr.p10[i])} to ${signed(tr.p90[i])}%`;
      const tx = Math.max(70, Math.min(r.width - 70, cx / W * r.width));
      tip.style.left = tx + 'px';
      tip.style.top = (Math.min(y(tr.p90[i]), cy) / H * r.height - 8) + 'px';
    };
    const hit = $('.hit', svg);
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  }

  // ── Controls ───────────────────────────────────────────────────────────────
  function bindControls() {
    const arrows = (group, sel) => group.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const bs = $$(sel, group), i = bs.indexOf(document.activeElement);
      const j = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + bs.length) % bs.length;
      bs[j].focus(); bs[j].click(); e.preventDefault();
    });
    $$('.tabs button').forEach(b => b.addEventListener('click', () => showMap(+b.dataset.map)));
    arrows($('.tabs'), 'button');
    window.addEventListener('hashchange', () => { const n = fromHash(); if (n && n !== state.map) showMap(n); });

    const seg = (name, fn) => {
      const g = $(`[data-control="${name}"]`);
      g.addEventListener('click', e => { const b = e.target.closest('button'); if (b) fn(b.dataset.value); });
      arrows(g, 'button');
    };
    seg('m1-layer', v => { state.m1 = v; applyM1(); hideTooltip(); });
    seg('m2-scen', v => { state.scen = v; applyM2(); hideTooltip(); });
    seg('m3-layer', v => { state.m3 = v; applyM3(); hideTooltip(); });
    seg('projection', v => {
      state.projection = v;
      map.setProjection({ type: v });
      setSeg('projection', v);
      goHome();
    });
    setSeg('projection', state.projection);

    $('#btn-zoom-in').addEventListener('click', () => map.zoomIn());
    $('#btn-zoom-out').addEventListener('click', () => map.zoomOut());
    $('#btn-home').addEventListener('click', goHome);
  }

  // ── Hover and click on the map ─────────────────────────────────────────────
  function setHover(id) {
    if (id === hoverId) return;
    hoverId = id;
    map.setFilter('hover', ['==', ['id'], id == null ? -1 : id]);
  }

  function bindMapEvents() {
    const probe = e => {
      if (state.map === 2) {
        const f = map.queryRenderedFeatures(e.point, { layers: ['region-hit'] })[0];
        if (!f || !gridLand(e.lngLat)) { hideTooltip(); return null; }
        showTooltip(e.point, tipRegion(f.properties));
        return f;
      }
      const f = map.queryRenderedFeatures(e.point, { layers: ['country-hit'] })[0];
      if (state.map === 1) {
        const v = gridAt(e.lngLat.lng, e.lngLat.lat);
        if (v.precip == null) { hideTooltip(); setHover(null); return null; }
        setHover(f ? f.id : null);
        showTooltip(e.point, tipDryness(v, f && f.properties, e.lngLat));
        return f;
      }
      if (!f) { hideTooltip(); setHover(null); return null; }
      setHover(f.id);
      showTooltip(e.point, tipCountry(f.properties));
      return f;
    };
    map.on('mousemove', probe);
    map.on('click', e => {
      const f = probe(e);
      if (state.map === 2 && f) selectRegion(f.properties.id, false);
    });
    map.on('movestart', hideTooltip);
    map.getCanvas().addEventListener('mouseleave', () => { hideTooltip(); setHover(null); });
    map.getCanvas().style.cursor = 'crosshair';
  }

  // Is this point on land? The raster grid doubles as a land mask (regions also cover sea).
  function gridLand(ll) {
    const v = gridAt(ll.lng, ll.lat);
    return v.precip != null;
  }

  function tipDryness(v, country, ll) {
    const pc = classOf(v.precip, PRECIP.breaks);
    const where = country ? country.name : `${Math.abs(ll.lat).toFixed(1)}°${ll.lat < 0 ? 'S' : 'N'}, ${Math.abs(ll.lng).toFixed(1)}°${ll.lng < 0 ? 'W' : 'E'}`;
    let h = `<div class="t-name">${esc(where)}</div>
      <div class="t-big">${v.precip < 1 ? 'Under 1' : fmtInt(v.precip)} <small>mm a year here</small></div>
      <div class="t-row"><span><i class="t-key" style="background:${PRECIP.colors[pc]}"></i>Class</span><b>${PRECIP.labels[pc].replace('Under', 'under').replace('Over', 'over')}${/mm/.test(PRECIP.labels[pc]) ? '' : ' mm'}</b></div>`;
    if (v.arid != null) {
      const ac = classOf(v.arid, ARID.breaks);
      h += `<div class="t-row"><span><i class="t-key" style="background:${ARID.colors[ac]}"></i>Aridity index</span><b>${v.arid >= 2.5 ? 'over 2.5' : v.arid.toFixed(2)}, ${ARID.labels[ac].toLowerCase()}</b></div>`;
    } else {
      h += `<div class="t-note">Antarctica: coarse satellite-era estimate (GPCP), no aridity index.</div>`;
    }
    return h;
  }

  function tipRegion(p) {
    const s = state.scen, med = p[s + '_pr'], n = p[s + '_n'];
    const dry = Math.round(p[s + '_dry_models'] / 100 * n);
    const cls = classOf(med, CHANGE.breaks);
    return `<div class="t-name">${esc(p.name)}</div>
      <div class="t-big">${signed(med)}% <small>rainfall by 2041–2060</small></div>
      <div class="t-row"><span><i class="t-key" style="background:${CHANGE.colors[cls]}"></i>Range of models</span><b>${signed(p[s + '_p10'])} to ${signed(p[s + '_p90'])}%</b></div>
      <div class="t-row"><span>Models projecting less rain</span><b>${dry} of ${n}</b></div>
      <div class="t-row"><span>Warming since 1995–2014</span><b>${signed(p[s + '_tas'])} °C</b></div>
      <div class="t-row"><span>Rainfall today</span><b>${fmtInt(p.obs_mm)} mm a year</b></div>
      ${p[s + '_agree'] < 80 ? '<div class="t-note">Models split on the direction here.</div>' : ''}
      <div class="t-note">Select to chart this region.</div>`;
  }

  function tipCountry(p) {
    const val = (k, v) => v == null ? 'no data' : k === 'P' ? fmtInt(v) + ' per km²' : (+v).toFixed(v < 10 ? 1 : 0) + '%';
    const row = (k, label) => `<div class="t-row"><span><i class="t-key" style="background:${INGREDIENT_INK[k]}"></i>${label}</span><b>${val(k, p[k])}</b></div>`;
    let head;
    if (p.status === 'rated') {
      const cls = classOf(p.score, M3.score.breaks);
      head = `<div class="t-big">${Math.round(p.score)} <small>of 100, overlap score</small></div>`;
      if (p.triple) head += `<div class="t-note">In the upper 40% on all three ingredients.</div>`;
      void cls;
    } else {
      head = `<div class="t-note">${p.status === 'small' ? 'Not rated: too small for the rainfall grid.' : 'Not rated: no population or employment data.'}</div>`;
    }
    return `<div class="t-name">${esc(p.name)}</div>${head}
      ${row('D', 'Drought frequency')}${row('P', 'Population density')}${row('A', 'Jobs in agriculture')}`;
  }

  function showTooltip(pt, html) {
    const t = $('#tooltip'), st = $('.stage');
    t.innerHTML = html;
    t.hidden = false;
    const w = t.offsetWidth, h = t.offsetHeight, W = st.clientWidth, H = st.clientHeight;
    let x = pt.x + 16, y = pt.y + 16;
    if (x + w > W - 8) x = pt.x - w - 16;
    if (y + h > H - 8) y = pt.y - h - 16;
    t.style.left = Math.max(8, x) + 'px';
    t.style.top = Math.max(8, y) + 'px';
  }
  function hideTooltip() { $('#tooltip').hidden = true; }
})();
