/* ============================================================================
   FSA Normal Grazing Periods · js/app.js
   The application core: state, URL, map, controls, legend, county card.

   ES module, no build step. Everything shared comes from the Sustainable FSA
   house-style kit; everything app-specific comes from ./data.js and ./color.js.
   Two vendored globals must already exist when this module runs
   (window.maplibregl, window.topojson) — index.html loads them as classic
   scripts, which is why an ES module here is always second.

   ── State model ────────────────────────────────────────────────────────────
   The URL is the primary state (HOUSE-STYLE §4). Read once at boot with
   precedence URL > localStorage(sfsa-ngp-*) > defaults, every value validated
   against a whitelist — a stored value gets exactly the same suspicion as a
   URL one, because another version of this app (or another app on the origin)
   may have written it. State is mirrored back on every mutation and on map
   moveend, and a view that is entirely at defaults emits a CLEAN url with no
   query string at all.

     ?year   2008–2026            ?lng ?lat ?zoom  camera (all three or none)
     ?type   pasture-type slug    ?theme  light | high-contrast
     ?variable start|end|duration ?kbd    off (disables the / shortcut)
     ?county 5-character FSA id   ?export (N-W4)

   ── What this file does NOT do ─────────────────────────────────────────────
   The month-wheel legend, the county card's span chart, the on-demand data
   table and the branded PNG export are N-W4's, and they are wired through the
   documented seam at the bottom of this file — see `===== N-W4 FEATURES =====`.
   ========================================================================== */

import {
  createLiveRegion, getTheme, initCollapsible, initSearchCollapse,
  initThemeToggle, lsGet, lsSet, reducedMotion, replaceUrlState, showToast,
  urlParams,
} from 'https://sustainable-fsa.com/style/v0.1.0/core/core.js';
import {
  COMPOSITE_BOUNDS, addFitControl, addNavigation, cameraParamsIfDefault,
  createCompositeMap, installZoomFloor,
} from 'https://sustainable-fsa.com/style/v0.1.0/map/map.js';
import {
  addCountyLayers, countyCentroid, initCountyTooltip, loadCounties,
  searchItems, vintageForYear,
} from 'https://sustainable-fsa.com/style/v0.1.0/county/county.js';
import { initSearchBox } from 'https://sustainable-fsa.com/style/v0.1.0/ui/search.js';
import { initDetailCard } from 'https://sustainable-fsa.com/style/v0.1.0/ui/card.js';
import { colorbar } from 'https://sustainable-fsa.com/style/v0.1.0/ui/legend.js';
import { initHelpModal } from 'https://sustainable-fsa.com/style/v0.1.0/ui/help.js';

import {
  allCountyIds, countyName, getYearType, initData, typeFromSlug, typeSlug,
  types, years,
} from './data.js';
import { NO_DATA, VARIABLES, loadRamps, ramps } from './color.js';

/* ── Constants ───────────────────────────────────────────────────────────── */

/** Program-year bounds. They match index.html's slider and the frozen payload;
    boot re-checks them against data.js years() once the data has landed. */
const YEAR_MIN = 2008;
const YEAR_MAX = 2026;

const DEFAULTS = Object.freeze({
  year: YEAR_MAX,
  type: 'Native Pasture',
  variable: 'duration',
});

/** localStorage keys. Everything app-owned is `sfsa-ngp-*` (kit AGENTS.md);
    the theme is the kit's own `sfsa-theme`, deliberately shared org-wide, and
    this app never writes it directly — initThemeToggle does. */
const LS = Object.freeze({
  year: 'sfsa-ngp-year',
  type: 'sfsa-ngp-type',
  variable: 'sfsa-ngp-variable',
  legend: 'sfsa-ngp-legend',
  seenIntro: 'sfsa-ngp-seen-intro',
});

/** A well-formed FSA county key: five digits, leading zeros intact. County ids
    are STRINGS from end to end — no parse, no arithmetic, ever. */
const FSA_ID_RE = /^[0-9]{5}$/;

/** How long the year slider must rest before a boundary-vintage swap starts.
    Dragging 2016 → 2010 crosses the 2015 line once, not six times. */
const VINTAGE_DEBOUNCE_MS = 250;

/* ── Element handles ─────────────────────────────────────────────────────── */

const $ = (sel) => document.querySelector(sel);

const els = {
  main: $('#main'),
  map: $('#map'),
  note: $('#app-note'),
  year: $('#year-range'),
  yearOut: $('#year-out'),
  type: $('#type-select'),
  segs: Array.from(document.querySelectorAll('.seg-btn[data-variable]')),
  searchWrap: $('#search-wrap'),
  search: $('#county-search'),
  results: $('#county-results'),
  btnSearchToggle: $('#btn-search-toggle'),
  btnTable: $('#btn-table'),
  btnExport: $('#btn-export'),
  btnShare: $('#btn-share'),
  btnTheme: $('#btn-theme'),
  btnInfo: $('#btn-info'),
  legendPanel: $('#legend-panel'),
  legendToggle: $('#legend-toggle'),
  legendBody: $('#legend-body'),
  legendWheel: $('#legend-wheel'),
  legendBar: $('#legend-bar'),
  legendKey: $('#legend-key'),
  card: $('#county-card'),
  cardTitle: $('#card-title'),
  cardClose: $('#card-close'),
  cardRows: $('#card-rows'),
  cardContent: $('#card-content'),
  tooltip: $('#tooltip'),
  infoModal: $('#info-modal'),
  tableModal: $('#table-modal'),
};

/** Controls that mean nothing until the data has loaded. Disabled through boot
    and re-enabled together; the theme and help buttons are deliberately not in
    this list, because they work with or without data. */
const dataControls = [
  els.year, els.type, ...els.segs, els.search, els.btnSearchToggle,
  els.btnTable, els.btnExport, els.btnShare,
];

/* ── Live state ──────────────────────────────────────────────────────────── */

const state = {
  year: DEFAULTS.year,
  type: DEFAULTS.type,
  variable: DEFAULTS.variable,
  countyId: null,
  theme: getTheme(),
};

let params = urlParams();
let kbdEnabled = true;
let pendingTypeSlug = null;   // held until the type dictionary exists

let map = null;
let mapLoaded = null;         // resolves on the map's own 'load' event
let fitOpts = null;
let counties = null;          // the decoded vintage in use
let handle = null;            // addCountyLayers() handle
let zoomFloor = null;
let vintage = null;           // 'dd17' | 'dd22'
let vintageTimer = null;
let searchCtl = null;
let searchCollapseCtl = null;
let cardCtl = null;
let bar = null;               // kit colorbar handle for #legend-bar
let live = null;
let booted = false;

/* ── The status pill ─────────────────────────────────────────────────────── */

/**
 * Show the pill over the map. role="status" on the element means every message
 * here is also announced, so this is the app's one channel for "what is
 * happening" — keep the wording a sentence, not a code.
 *
 * @param {string} text
 * @param {{tone?: 'info'|'error', retry?: (() => void)|null}} [opts]
 */
function note(text, { tone = 'info', retry = null } = {}) {
  els.note.replaceChildren();
  const span = document.createElement('span');
  span.textContent = text;
  els.note.appendChild(span);
  if (retry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-btn';
    btn.textContent = 'Retry';
    btn.addEventListener('click', () => { clearNote(); retry(); });
    els.note.appendChild(btn);
  }
  els.note.dataset.tone = tone;
  els.note.hidden = false;
}

function clearNote() {
  els.note.hidden = true;
  els.note.replaceChildren();
  delete els.note.dataset.tone;
}

/** A failure the user can do something about: pill + Retry + a toast, because
    the pill sits over the map and a user looking at the navbar can miss it. */
function failNote(text, retry) {
  note(text, { tone: 'error', retry });
  showToast(text, 5000);
}

/* ── URL + persistence ───────────────────────────────────────────────────── */

/**
 * Read the boot state: URL param > localStorage > default, each validated.
 *
 * The pasture type is the one value that cannot be finished here — the
 * dictionary of valid types arrives with the payload — so its slug is parked
 * in `pendingTypeSlug` and resolved in applyPendingType() once data.js is up.
 */
function readInitialState() {
  params = urlParams();

  // ?kbd=off is an accessibility opt-out (WCAG 2.1.4) and is NOT persisted:
  // it rides the URL so a user who needs it can bookmark it.
  kbdEnabled = params.get('kbd') !== 'off';

  const rawYear = params.get('year') ?? lsGet(LS.year);
  // Number() on a PROGRAM YEAR, never on a county id.
  const year = Number(rawYear);
  if (Number.isInteger(year) && year >= YEAR_MIN && year <= YEAR_MAX) state.year = year;

  const rawVar = (params.get('variable') ?? lsGet(LS.variable) ?? '').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(VARIABLES, rawVar)) state.variable = rawVar;

  const rawType = params.get('type') ?? lsGet(LS.type);
  pendingTypeSlug = rawType == null ? null : String(rawType).toLowerCase();

  // A selection is not a preference: it comes from the URL only.
  const rawCounty = params.get('county');
  if (rawCounty != null && FSA_ID_RE.test(rawCounty)) state.countyId = rawCounty;

  state.theme = getTheme();   // already validated + stamped by the anti-flash boot
}

/** Resolve `pendingTypeSlug` against the real dictionary. Anything unknown —
    a hand-edited URL, a type retired from the payload, a stale stored value —
    falls back to the default rather than blanking the map. */
function applyPendingType() {
  if (pendingTypeSlug) {
    const resolved = typeFromSlug(pendingTypeSlug);
    if (resolved) state.type = resolved;
    else console.warn('[ngp] unknown pasture type ' + JSON.stringify(pendingTypeSlug)
      + ' — falling back to ' + JSON.stringify(DEFAULTS.type));
  }
  pendingTypeSlug = null;
}

/**
 * Mirror the whole view into the query string.
 *
 * Named for what it means to the app (push this state into the URL); it uses
 * the kit's replaceUrlState, i.e. history.replaceState, ON PURPOSE. This is
 * also called on every map `moveend`, and a real history.pushState there would
 * turn one pan across the country into forty back-button steps. The house
 * convention is one history entry per page visit, with the URL always current.
 */
function pushState() {
  const p = {};
  if (state.year !== DEFAULTS.year) p.year = String(state.year);
  if (state.type !== DEFAULTS.type) p.type = typeSlug(state.type);
  if (state.variable !== DEFAULTS.variable) p.variable = state.variable;
  if (state.countyId) p.county = state.countyId;
  // Camera params are emitted only when the camera has been moved off the
  // default fit, so an untouched view keeps a clean URL.
  if (map) Object.assign(p, cameraParamsIfDefault(map, { bounds: COMPOSITE_BOUNDS, fitOpts }));
  if (state.theme !== 'light') p.theme = state.theme;
  if (!kbdEnabled) p.kbd = 'off';
  replaceUrlState(p);
}

function persist() {
  lsSet(LS.year, String(state.year));
  lsSet(LS.type, typeSlug(state.type));
  lsSet(LS.variable, state.variable);
}

/* ── Painting ────────────────────────────────────────────────────────────── */

/**
 * Repaint the choropleth for the current (year, type, variable).
 *
 * The kit coalesces the actual feature-state writes to one flush per animation
 * frame, so calling this from a dragged slider is cheap on the GL side; the
 * cost here is one Map of ~3,000 colors, and data.js memoizes the lookup
 * behind it.
 */
function recolor() {
  if (!handle) return;
  const spec = VARIABLES[state.variable];
  const recs = getYearType(state.year, state.type);

  const colors = new Map();
  for (const [id, rec] of recs) colors.set(id, spec.scale(rec[spec.field]));

  // Ids with data but no polygon in this vintage are REPORTED, not swallowed:
  // the island territories are in neither boundary archive, and anything else
  // showing up here would be a broken join.
  const unmatched = handle.recolor(colors);
  announceRender(colors.size - unmatched.length, unmatched.length);

  // The card is a readout of the same (year, type) as the map.
  if (state.countyId) fillCard(state.countyId);
}

/** The always-on half of the a11y twin: a short summary of what the canvas is
    showing right now (HOUSE-STYLE §5.2). The on-demand table is the other
    half, and it is N-W4's. */
function announceRender(shown, missingGeometry) {
  if (!live) return;
  const total = allCountyIds().length;
  const label = VARIABLES[state.variable].label.toLowerCase();
  let msg = state.year + ' ' + state.type + ': ' + shown.toLocaleString('en-US')
    + ' of ' + total.toLocaleString('en-US') + ' counties shown, colored by ' + label + '.';
  if (missingGeometry > 0) {
    msg += ' ' + missingGeometry.toLocaleString('en-US')
      + ' more have data but no county boundary to draw.';
  }
  live.announce(msg);
}

/* ── Legend ──────────────────────────────────────────────────────────────── */

/** Plain-language meaning of the active ramp. This is the redundancy channel
    that makes the map legible in grayscale, to a CVD reader, and to a screen
    reader — it is not decoration, and it is never optional. */
function legendKeyText() {
  if (state.variable === 'duration') {
    return 'Dark counties graze for a few weeks; light counties graze most of '
      + 'the year. Counties with no reported period are gray.';
  }
  const which = state.variable === 'start' ? 'begins' : 'ends';
  return 'Color is the point in the calendar where the grazing period ' + which
    + ', read against the months around the wheel. The scale wraps, so late '
    + 'December and early January are neighboring colors. Counties with no '
    + 'reported period are gray.';
}

/** Swap the legend body between the cyclic wheel (start/end) and the linear
    colorbar (duration), and refresh the text key. */
function syncLegend() {
  const cyclic = VARIABLES[state.variable].cyclic;
  els.legendWheel.hidden = !cyclic;
  els.legendBar.hidden = cyclic;
  els.legendKey.textContent = legendKeyText();
  if (bar && !cyclic) {
    bar.update(undefined, { noData: { color: NO_DATA(), label: 'No reported grazing period' } });
  }
  notifyLegend();   // N-W4 seam: the wheel repaints for the new variable
}

function buildLegend() {
  bar = colorbar(els.legendBar, ramps().duration, {
    ticks: [
      { at: 0, label: '0 wk' },
      { at: 0.5, label: '26 wk' },
      { at: 1, label: '52 wk' },
    ],
    noData: { color: NO_DATA(), label: 'No reported grazing period' },
  });
  syncLegend();
}

/* ── The county card ─────────────────────────────────────────────────────── */

function addRow(dl, term, value, isNote) {
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value;
  if (isNote) dd.className = 'card-note';
  dl.append(dt, dd);
}

/**
 * Fill the card for one county at the CURRENT year/type/variable. Three cases,
 * and all three are stated in words rather than implied by an empty box:
 * a reported period, a county with no period this year, and a county that is
 * in the data but has no polygon in either boundary archive.
 */
function fillCard(id) {
  const nm = countyName(id);
  const geo = counties && counties.index.has(id);
  els.cardTitle.textContent = nm ? nm.county + ', ' + nm.state : id;

  const dl = els.cardRows;
  dl.replaceChildren();
  addRow(dl, 'FSA county code', id);
  addRow(dl, 'Pasture type', state.type);

  const rec = getYearType(state.year, state.type).get(id);
  if (rec) {
    addRow(dl, 'Season start', rec.startLabel);
    addRow(dl, 'Season end', rec.endLabel);
    addRow(dl, 'Duration', rec.duration_weeks + (rec.duration_weeks === 1 ? ' week' : ' weeks'));
  } else {
    addRow(dl, state.year + ' grazing period',
      'No data for ' + state.type + ' in ' + state.year + '.', true);
  }
  if (!geo) {
    addRow(dl, 'Boundary',
      'No boundary available to display — this county is not in the '
      + (vintage || 'current') + ' FSA boundary archive.', true);
  }
}

/**
 * Open a county: select it on the map, fill the card, and optionally fly to it.
 *
 * @param {string} id 5-character FSA county id
 * @param {{fly?: boolean}} [opts]
 */
function selectCounty(id, { fly = false } = {}) {
  if (!FSA_ID_RE.test(String(id))) return;
  state.countyId = String(id);

  if (handle) handle.setSelected(state.countyId);
  fillCard(state.countyId);
  if (cardCtl) cardCtl.open();

  const feature = counties && counties.index.get(state.countyId);
  if (fly && feature) {
    const center = countyCentroid(feature);
    if (center) {
      const camera = { center, zoom: Math.max(map.getZoom(), 5) };
      // Reduced motion means no ANIMATION, not no navigation: the county still
      // comes into view, it just arrives without the flight. Read live, per
      // WCAG 2.3.3 — the user can flip the OS setting mid-session.
      if (reducedMotion()) map.jumpTo(camera);
      else map.flyTo({ ...camera, speed: 1.2 });
    }
  }

  notifyCountySelected(state.countyId);
  pushState();
}

/* ── Search ──────────────────────────────────────────────────────────────── */

/**
 * Rows for the combobox: every county in the current vintage's geometry, PLUS
 * every id that is in the data but has no polygon. A search that silently
 * omits the island territories tells the user they do not exist.
 */
function buildSearchItems() {
  const extras = [];
  for (const id of allCountyIds()) {
    if (counties.index.has(id)) continue;
    const nm = countyName(id);
    extras.push({ id, label: nm ? nm.county + ', ' + nm.state : id, code: id });
  }
  return searchItems(counties, extras);
}

/* ── Controls ────────────────────────────────────────────────────────────── */

function setControlsEnabled(on) {
  for (const el of dataControls) if (el) el.disabled = !on;
}

function setYear(next) {
  const year = Number(next);
  if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) return;
  if (year === state.year) return;
  state.year = year;
  els.year.value = String(year);
  els.yearOut.textContent = String(year);
  persist();
  pushState();

  const want = vintageForYear(year);
  if (want === vintage) {
    recolor();
    return;
  }
  // Crossing the 2015 line: debounce, because a dragged slider crosses it once
  // per drag and not once per frame.
  clearTimeout(vintageTimer);
  note(want === 'dd17'
    ? 'Switching to pre-2015 county boundaries…'
    : 'Switching to 2015-and-later county boundaries…');
  vintageTimer = setTimeout(() => swapVintage(want), VINTAGE_DEBOUNCE_MS);
}

async function swapVintage(want) {
  try {
    const next = await loadCounties(want);
    // The user may have dragged back across the line while this was in flight.
    if (vintageForYear(state.year) !== want) return;
    vintage = want;
    counties = next;
    handle.swapVintage(next);
    // The handle drops a selection whose polygon is gone; the DATA for that
    // county is still real, so the card stays open and says so.
    if (state.countyId) {
      if (next.index.has(state.countyId)) handle.setSelected(state.countyId);
      fillCard(state.countyId);
    }
    if (searchCtl) searchCtl.refresh(buildSearchItems());
    recolor();
    clearNote();
  } catch (err) {
    console.error('[ngp] boundary swap failed', err);
    failNote('Could not load the county boundaries for ' + state.year + '.',
      () => swapVintage(want));
  }
}

function setType(next) {
  if (next === state.type) return;
  state.type = next;
  els.type.value = next;
  persist();
  pushState();
  recolor();
}

function setVariable(next) {
  if (!Object.prototype.hasOwnProperty.call(VARIABLES, next)) return;
  state.variable = next;
  // aria-pressed IS the styling source of truth (HOUSE-STYLE §5.7): the CSS
  // keys off it, so the accessible state cannot drift from the visual one.
  for (const btn of els.segs) {
    btn.setAttribute('aria-pressed', String(btn.dataset.variable === next));
  }
  persist();
  pushState();
  syncLegend();
  recolor();
}

function populateTypeSelect() {
  const frag = document.createDocumentFragment();
  for (const t of types()) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    frag.appendChild(opt);
  }
  els.type.replaceChildren(frag);
  els.type.value = state.type;
}

async function share() {
  const url = new URL(location.href);
  // ?kbd is the SHARER's input preference, not part of the view.
  url.searchParams.delete('kbd');
  try {
    if (!navigator.clipboard) throw new Error('no clipboard API');
    await navigator.clipboard.writeText(url.href);
    showToast('Link copied — it reproduces exactly this view.');
  } catch (err) {
    console.warn('[ngp] clipboard write failed', err);
    showToast('Could not copy automatically — the address bar holds this exact view.', 5000);
  }
}

/** `/` focuses the county search. A single-character shortcut, so it needs an
    opt-out (WCAG 2.1.4): ?kbd=off disables it entirely, and the param rides
    every URL rewrite so it survives a session. */
function onDocumentKeyDown(e) {
  if (!kbdEnabled || e.key !== '/') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && t.closest && t.closest('input, select, textarea, [contenteditable]')) return;
  e.preventDefault();
  if (searchCollapseCtl && searchCollapseCtl.isCollapsed()) searchCollapseCtl.open();
  else els.search.focus();
}

function wireControls() {
  // The slider fires `input` on every pixel of a drag; throttle to one repaint
  // per frame. The <output> updates immediately either way, so the number
  // under the thumb never lags the thumb.
  let yearRaf = 0;
  els.year.addEventListener('input', () => {
    els.yearOut.textContent = els.year.value;
    if (yearRaf) return;
    yearRaf = requestAnimationFrame(() => {
      yearRaf = 0;
      setYear(els.year.value);
    });
  });

  els.type.addEventListener('change', () => setType(els.type.value));

  for (const btn of els.segs) {
    btn.addEventListener('click', () => setVariable(btn.dataset.variable));
  }

  els.btnShare.addEventListener('click', share);

  initThemeToggle({
    button: els.btnTheme,
    onChange: (theme) => {
      state.theme = theme;
      // GL paints cannot read CSS custom properties: a theme flip that only
      // swaps data-theme leaves the whole map painted in the old palette.
      if (handle) handle.applyThemePaints();
      syncLegend();          // the no-data chip is a token too
      pushState();
    },
  });

  initCollapsible({
    toggle: els.legendToggle,
    body: els.legendBody,
    storageKey: LS.legend,
    autoCollapseOnCompact: true,
    // The kit maintains aria-expanded; the LABEL has to invert with the action
    // or a collapsed panel still offers to "collapse legend" (§5.7).
    onChange: (collapsed) => {
      els.legendToggle.setAttribute('aria-label', collapsed ? 'Expand legend' : 'Collapse legend');
    },
  });

  document.addEventListener('keydown', onDocumentKeyDown);
}

/* ── Boot ────────────────────────────────────────────────────────────────── */

async function boot() {
  // The two vendored globals are a hard requirement, and the failure mode
  // without this check is a blank cream rectangle plus a ReferenceError five
  // frames deep in a callback.
  if (!window.maplibregl || !window.topojson) {
    note('This map could not start: the MapLibre GL and topojson-client '
      + 'libraries did not load.', { tone: 'error', retry: () => location.reload() });
    return;
  }

  readInitialState();
  els.year.value = String(state.year);
  els.yearOut.textContent = String(state.year);
  for (const btn of els.segs) {
    btn.setAttribute('aria-pressed', String(btn.dataset.variable === state.variable));
  }

  live = createLiveRegion();
  vintage = vintageForYear(state.year);

  const created = createCompositeMap({
    // The ELEMENT, not a selector: MapLibre resolves a string container with
    // document.getElementById, so '#map' throws "Container '#map' not found."
    container: els.map,
    bounds: COMPOSITE_BOUNDS,
    params,
  });
  map = created.map;
  fitOpts = created.fitOpts;

  // Zoom + fit go TOP-LEFT so both right-hand corners stay free for the app's
  // own surfaces (card top-right, legend bottom-right). The fit control fuses
  // into the navigation group in whichever corner it is told.
  addNavigation(map, { position: 'top-left' });
  addFitControl(map, {
    bounds: COMPOSITE_BOUNDS,
    fitOpts,
    position: 'top-left',
    onBeforeFit: () => { if (cardCtl && cardCtl.isOpen()) cardCtl.close(); },
  });
  // COMPOSITE_BOUNDS, not counties.bounds, for the fit control, the zoom floor
  // AND the clean-URL default check — deliberately one framing for the whole
  // session. The two vintages share a bbox to four decimal places, and a
  // per-vintage framing would make "the default camera" mean something
  // different either side of 2015, so the same URL would be clean in one year
  // and carry ?lng&lat&zoom in another.
  zoomFloor = installZoomFloor(map, { bounds: COMPOSITE_BOUNDS, fitOpts });

  mapLoaded = new Promise((resolve) => map.once('load', resolve));
  map.on('moveend', () => { if (booted) pushState(); });

  wireControls();

  // Wired BEFORE the data load, deliberately: "About this map" is exactly what
  // someone reaches for when the map failed to load, and help.md is a separate
  // fetch that has nothing to do with the payload.
  initHelpModal({
    dialog: els.infoModal,
    trigger: els.btnInfo,
    url: 'help.md',
    // No fallbackHTML: index.html already ships the offline paragraph inside
    // [data-help-content], and help.js leaves existing markup alone when the
    // fetch fails.
    firstVisitKey: LS.seenIntro,
    // Someone sent to a specific view does not need the tour.
    suppressAutoOpen: ['year', 'type', 'variable', 'county', 'lng', 'export']
      .some((k) => params.has(k)),
  });

  await loadAndRender();
}

/**
 * The retryable half of boot: fetch, join, draw, and hand the controls over.
 *
 * Split from boot() because the Retry button has to be able to re-run it. Only
 * the map itself is created in boot(), and creating a second map in the same
 * container is a hard error — so a failure here rewinds to exactly this point
 * and no further. Every fetch behind it is idempotent (the kit's boundary cache
 * evicts rejected promises, initData/loadRamps no-op once loaded).
 */
async function loadAndRender() {
  if (booted) return;   // success happens once; Retry only re-runs a FAILED attempt
  setControlsEnabled(false);
  els.main.setAttribute('aria-busy', 'true');
  note('Loading county boundaries and grazing periods…');

  let payloads;
  try {
    payloads = await Promise.all([loadCounties(state.year), initData(), loadRamps()]);
  } catch (err) {
    console.error('[ngp] boot failed', err);
    els.main.removeAttribute('aria-busy');
    failNote('Could not load the map data. Check your connection and try again.',
      loadAndRender);
    return;
  }
  counties = payloads[0];

  applyPendingType();
  populateTypeSelect();

  // The slider's range is authored in the HTML; the payload is the authority.
  const yearList = years();
  const first = yearList[0];
  const last = yearList[yearList.length - 1];
  if (String(first) !== els.year.min || String(last) !== els.year.max) {
    console.warn('[ngp] slider range ' + els.year.min + '–' + els.year.max
      + ' does not match the data (' + first + '–' + last + '); using the data.');
    els.year.min = String(first);
    els.year.max = String(last);
    if (state.year < first || state.year > last) {
      state.year = last;
      els.year.value = String(last);
      els.yearOut.textContent = String(last);
      vintage = vintageForYear(state.year);
    }
  }

  await mapLoaded;
  zoomFloor.refresh();   // cameraForBounds needs a laid-out container

  handle = addCountyLayers(map, counties);
  buildLegend();
  recolor();

  searchCtl = initSearchBox({
    input: els.search,
    dropdown: els.results,
    items: buildSearchItems(),
    renderRow(item, i, li) {
      const name = document.createElement('span');
      name.textContent = item.label;
      const code = document.createElement('span');
      code.className = 'option-sub';
      code.textContent = item.code;
      li.append(name, code);
    },
    onSelect: (item) => {
      els.search.value = item.label;
      if (searchCollapseCtl) searchCollapseCtl.close({ restoreFocus: false });
      selectCounty(item.id, { fly: true });
    },
    announce: live.announce,
  });

  searchCollapseCtl = initSearchCollapse({
    wrap: els.searchWrap,
    toggle: els.btnSearchToggle,
    input: els.search,
    onClose: () => { if (searchCtl) searchCtl.close(); },
  });

  cardCtl = initDetailCard({
    card: els.card,
    closeBtn: els.cardClose,
    onClose: () => {
      state.countyId = null;
      if (handle) handle.setSelected(null);
      notifyCountySelected(null);
      pushState();
    },
  });

  initCountyTooltip(map, handle, {
    element: els.tooltip,
    render(feature, id) {
      const nm = counties.names.get(id) || countyName(id);
      const rec = getYearType(state.year, state.type).get(id);
      return {
        name: nm ? nm.county + ', ' + nm.state : id,
        sub: id,
        val: rec
          ? tooltipValue(rec)
          : 'No data for ' + state.type + ' in ' + state.year,
      };
    },
    onClick: (id) => selectCounty(id),
  });

  setControlsEnabled(true);
  els.main.removeAttribute('aria-busy');
  clearNote();
  booted = true;
  pushState();
  // A boot marker for the export/screenshot jobs and the audit harness: the
  // map is drawn, the data is joined, and the controls are live.
  document.documentElement.dataset.ngpReady = '1';

  if (state.countyId) {
    // A deep link that also carries a camera has already framed the view — do
    // not fly away from the framing the sharer chose.
    selectCounty(state.countyId, { fly: !params.has('lng') });
  }

  initTableSeam();
  initExportSeam();

  // Warm the other boundary vintage while the browser is idle, so the first
  // slide across 2015 does not stall on a 2 MB fetch.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => {
    loadCounties(vintage === 'dd17' ? 'dd22' : 'dd17')
      .catch((err) => console.warn('[ngp] prefetch of the other vintage failed', err));
  });
}

/** The tooltip's value line: the same number the card shows, for the active
    variable. The tooltip is aria-hidden decoration — this content reaches AT
    through the live region and the card. */
function tooltipValue(rec) {
  if (state.variable === 'start') return 'Starts ' + rec.startLabel;
  if (state.variable === 'end') return 'Ends ' + rec.endLabel;
  return rec.duration_weeks + (rec.duration_weeks === 1 ? ' week' : ' weeks');
}

/* ============================================================================
   ===== N-W4 FEATURES ========================================================

   Everything below is the seam for the second front-end pass. Nothing here
   implements a feature; it is the set of hooks those features plug into, live
   and tested, so wiring them is an import plus a call rather than surgery on
   this file.

   FILES N-W4 ADDS
     js/legend-wheel.js  the cyclic month-wheel legend  → renders into #legend-wheel
     js/card-content.js  the all-years span chart + table → renders into #card-content
     js/table-view.js    the on-demand data table        → renders into #table-modal-body
     js/export.js        branded PNG export              → wraps the kit's ui/export.js

   THE CONTEXT OBJECT
     `ngpContext()` hands a feature everything it needs WITHOUT importing this
     module back (app.js is the entry point; a feature importing it would make
     the module graph cyclic). Call it inside the feature's init.

   DATA + COLOR
     Import ./data.js and ./color.js directly — both are module-level
     singletons, already initialised by the time any hook below can fire, so a
     feature calls getCountySeries()/cyclicColor() without going through here.

   THE SUBSCRIPTIONS
     onCountySelected(fn)  fn(id | null) on every open AND on close
     onLegendChange(fn)    fn({variable, cyclic, ramps}) whenever the legend
                           body should be repainted (variable or theme change)
     Both return an unsubscribe function and fire nothing retroactively; call
     the feature's own render once after subscribing if it needs a first paint.

   WIRING — LANDED. All four modules exist and are wired in the two functions
   at the bottom of this block, which loadAndRender() already calls by name:

     initTableSeam()   the three in-page features (wheel, card content, table)
     initExportSeam()  the PNG export and the `?export=` hook

   Each feature subscribes for itself and renders once if it has already missed
   its first event (a deep-linked ?county= is selected before the seam runs).
   ========================================================================== */

/* The feature modules. `import` is a top-level declaration and is hoisted, so
   these sit with the code they serve rather than at the head of a file that
   otherwise has nothing to do with them. */
import { initLegendWheel } from './legend-wheel.js';
import { initCardContent } from './card-content.js';
import { initTableView } from './table-view.js';
import { initExport } from './export.js';

const countySubs = new Set();
const legendSubs = new Set();

/**
 * Subscribe to county selection. Fires with the 5-character FSA id on open and
 * with null on close.
 * @param {(id: string|null) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onCountySelected(fn) {
  countySubs.add(fn);
  return () => countySubs.delete(fn);
}

/**
 * Subscribe to legend-affecting changes: the color-by variable and the theme.
 * @param {(info: {variable: string, cyclic: boolean, label: string,
 *                 ramps: {cyclic: string[], duration: string[]},
 *                 noData: string}) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onLegendChange(fn) {
  legendSubs.add(fn);
  return () => legendSubs.delete(fn);
}

function notifyCountySelected(id) {
  for (const fn of countySubs) {
    try { fn(id); } catch (err) { console.error('[ngp] county subscriber failed', err); }
  }
}

function notifyLegend() {
  if (!legendSubs.size) return;
  const spec = VARIABLES[state.variable];
  const info = {
    variable: state.variable,
    cyclic: spec.cyclic,
    label: spec.label,
    ramps: ramps(),
    noData: NO_DATA(),
  };
  for (const fn of legendSubs) {
    try { fn(info); } catch (err) { console.error('[ngp] legend subscriber failed', err); }
  }
}

/**
 * Everything a feature module needs, as one frozen snapshot of accessors. The
 * getters are functions, not values, because `map`, `handle` and `counties`
 * are all replaced during a session (vintage swap) and a captured reference
 * would go stale.
 *
 * @returns {object}
 */
export function ngpContext() {
  return Object.freeze({
    // Live state — a copy, so a feature cannot mutate the app's state object.
    getState: () => ({ ...state }),
    getVintage: () => vintage,
    // Map internals.
    getMap: () => map,
    getHandle: () => handle,
    getCounties: () => counties,
    getBounds: () => COMPOSITE_BOUNDS,
    getFitOpts: () => fitOpts,
    // App actions.
    selectCounty,
    setYear,
    setType,
    setVariable,
    announce: (text) => { if (live) live.announce(text); },
    toast: showToast,
    note,
    clearNote,
    // Subscriptions.
    onCountySelected,
    onLegendChange,
    // Elements the features own.
    els: {
      legendWheel: els.legendWheel,
      cardContent: els.cardContent,
      tableModal: els.tableModal,
    },
  });
}

/**
 * The three in-page features: the month wheel, the card's span chart + table
 * twin, and the on-demand data table.
 *
 * Still named initTableSeam because loadAndRender() above calls it by that
 * name and this block is the only part of the file the feature pass touches —
 * the name is the seam, not the contents. It runs at the very end of the boot
 * sequence, in the same task as buildLegend() and the first recolor(), so the
 * wheel replaces its placeholder before anything is painted.
 */
function initTableSeam() {
  const ctx = ngpContext();

  // Build-once: the wheel is the same picture for `start` and `end` (one
  // cyclic ramp) and data ramps do not theme-swap, so update() is a no-op the
  // subscription keeps honest. app.js still owns whether the wheel is SHOWN.
  const wheel = initLegendWheel({ container: els.legendWheel, ramps: ramps() });
  onLegendChange((info) => wheel.update(info));

  // Subscribes to onCountySelected itself, and watches #card-rows for the
  // year/type changes this file fires no event for — see card-content.js.
  initCardContent({ container: els.cardContent, ctx });

  initTableView({
    button: els.btnTable,
    dialog: els.tableModal,
    captionEl: $('#table-modal-caption'),
    bodyEl: $('#table-modal-body'),
    ctx,
  });
}

/**
 * The branded PNG export, plus the `?export=` convention: a URL param that
 * forces a theme and triggers the export path so poster generation stays
 * headless-scriptable (HOUSE-STYLE §4). `params` is this module's already-read
 * query string, handed over rather than re-parsed.
 */
function initExportSeam() {
  initExport({ button: els.btnExport, ctx: ngpContext(), params });
}

/* ── Go ──────────────────────────────────────────────────────────────────── */

boot().catch((err) => {
  console.error('[ngp] unhandled boot failure', err);
  failNote('Something went wrong starting this map.', () => location.reload());
});
