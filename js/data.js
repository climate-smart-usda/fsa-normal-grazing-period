/* ============================================================================
   FSA Normal Grazing Periods · js/data.js
   The data layer: one fetch of the packed web payload, then O(1) lookups.

   ES module, no build step. The only kit dependency is core's fetchJSON (hard
   timeout + non-2xx rejection), so this file is importable under node with the
   kit path rewritten — which is exactly how the smoke test exercises it.

   ── The payload ────────────────────────────────────────────────────────────
   `assets/fsa-normal-grazing-period-web.json`, schema `fsa-ngp-web/1` (FROZEN):

     scalars      schema, generated, license, year0 = 2008, n = 244890
     years        [firstProgramYear, lastProgramYear] — a RANGE, not a list
     dictionaries types[16] · counties[3095] · county_names[] · state_names[]
                  (the three county arrays are index-aligned)
     rows         type[] county[] year[] sy[] ey[] so[] eo[]  — parallel arrays,
                  n entries each, sorted by (type, county, year)

   Three encodings in those rows deserve to be said out loud:

     · `type[i]` and `county[i]` are INDEXES into the dictionaries. The county
       dictionary holds 5-CHARACTER FSA STRINGS ("01001"), and this module
       never parses one as a number — leading zeros are eight whole states, and
       FSA codes are not FIPS codes (kit AGENTS.md §10).
     · `year[i]` is an OFFSET from `year0`. The program year is year0 + year[i].
     · `so[i]` / `eo[i]` are year offsets of the start/end date RELATIVE TO THE
       PROGRAM YEAR. A winter forage type can start in the calendar year before
       its program year (so = −1) and end in the one after (eo = +1). Today's
       data uses {−1, 0} and {−1, 0, +1}; nothing here hardcodes those domains,
       because next year's data may not.

   ── Dates are UTC, always ──────────────────────────────────────────────────
   Every Date in this module is built with Date.UTC and read back through a
   UTC-pinned Intl formatter. NEVER use a local-time getter (getFullYear,
   getMonth, getDate, toLocaleDateString without timeZone) on these values: a
   day-of-year 1 date built at UTC midnight is December 31 of the PREVIOUS YEAR
   for every reader west of Greenwich, which silently shifts a grazing period
   into the wrong program year for most of the United States.
   ========================================================================== */

import { fetchJSON } from 'https://sustainable-fsa.com/style/v0.1.0/core/core.js';

/* ── Constants ───────────────────────────────────────────────────────────── */

/** Default payload location, relative to the app page. */
export const DATA_URL = 'assets/fsa-normal-grazing-period-web.json';

/** The schema this module knows how to read. A mismatch is a hard failure. */
export const SCHEMA = 'fsa-ngp-web/1';

const MS_PER_WEEK = 604800000;

/** One formatter for the whole module — constructing an Intl.DateTimeFormat is
    the expensive half of formatting, and a per-row construction would rebuild
    it 3,000 times per repaint. timeZone: 'UTC' is not optional here (see the
    header). Shape: "Apr 15, 2026". */
const LABEL_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
});

/* ── Module state (built once by initData) ───────────────────────────────── */

let raw = null;            // the parsed payload
let year0 = 0;
let yearList = [];         // every program year, ascending
let typeList = [];         // types dictionary, as shipped (sorted)
let countyList = [];       // counties dictionary — 5-char FSA STRINGS
let typeIndex = new Map(); // type name  → dictionary index
let countyIdx = new Map(); // county id  → dictionary index
let slugToType = new Map();
let typeRanges = [];       // type index → [start, end) row range
let seriesRanges = new Map();  // `${typeIdx}|${countyIdx}` → [start, end)
let yearTypeCache = new Map(); // `${year}|${typeIdx}` → Map<id, Rec>
let seriesCache = new Map();   // `${typeIdx}|${countyIdx}` → Rec[]
let ready = false;

function assertReady(who) {
  if (!ready) {
    throw new Error('[ngp/data] ' + who + '() before initData() resolved.');
  }
}

/* ── Boot ────────────────────────────────────────────────────────────────── */

/**
 * Fetch and index the payload. Idempotent: a second call with the same URL
 * resolves immediately against the already-built indexes.
 *
 * @param {string} [url]
 * @returns {Promise<{schema: string, generated: string, license: string,
 *                    n: number, years: number[], types: string[]}>}
 *          a small metadata summary — the indexes themselves stay private.
 */
export async function initData(url = DATA_URL) {
  if (ready) return meta();

  const payload = await fetchJSON(url);

  if (!payload || payload.schema !== SCHEMA) {
    throw new Error('[ngp/data] unexpected payload schema: expected '
      + JSON.stringify(SCHEMA) + ', got '
      + JSON.stringify(payload && payload.schema));
  }

  const n = payload.n;
  const cols = ['type', 'county', 'year', 'sy', 'ey', 'so', 'eo'];
  for (const key of cols) {
    const col = payload[key];
    if (!Array.isArray(col) || col.length !== n) {
      throw new Error('[ngp/data] column ' + JSON.stringify(key) + ' is not an '
        + 'array of length n=' + n + ' (got ' + (col && col.length) + ').');
    }
  }
  if (!Array.isArray(payload.counties) || !Array.isArray(payload.types)) {
    throw new Error('[ngp/data] payload is missing the types/counties dictionaries.');
  }
  if (payload.county_names.length !== payload.counties.length
      || payload.state_names.length !== payload.counties.length) {
    throw new Error('[ngp/data] county_names/state_names are not aligned with counties.');
  }

  raw = payload;
  year0 = payload.year0;
  typeList = payload.types.slice();
  // String(), not a coercion: the dictionary already holds 5-character strings.
  // This documents the type and makes an accidental numeric id in a future
  // payload fail loudly at the FSA_ID check below instead of quietly.
  countyList = payload.counties.map((id) => String(id));

  typeIndex = new Map(typeList.map((t, i) => [t, i]));
  countyIdx = new Map(countyList.map((id, i) => [id, i]));

  const malformed = countyList.filter((id) => !/^[0-9]{5}$/.test(id));
  if (malformed.length) {
    console.warn('[ngp/data] ' + malformed.length + ' county id(s) are not '
      + '5-character FSA strings — joins to the boundary archives will miss: '
      + malformed.slice(0, 5).join(', '));
  }

  // years[] is a [first, last] RANGE in the payload; expand it to the list the
  // UI actually wants, then check it against what the rows really contain.
  const [firstYear, lastYear] = payload.years;
  yearList = [];
  for (let y = firstYear; y <= lastYear; y++) yearList.push(y);

  buildIndexes(n);

  let minOff = Infinity;
  let maxOff = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = raw.year[i];
    if (y < minOff) minOff = y;
    if (y > maxOff) maxOff = y;
  }
  if (year0 + minOff !== firstYear || year0 + maxOff !== lastYear) {
    console.warn('[ngp/data] declared year range ' + firstYear + '–' + lastYear
      + ' disagrees with the rows (' + (year0 + minOff) + '–' + (year0 + maxOff) + ').');
  }

  buildSlugs();
  ready = true;
  return meta();
}

/** @returns {{schema: string, generated: string, license: string, n: number,
 *             years: number[], types: string[]}} */
export function meta() {
  return {
    schema: raw ? raw.schema : null,
    generated: raw ? raw.generated : null,
    license: raw ? raw.license : null,
    n: raw ? raw.n : 0,
    years: yearList.slice(),
    types: typeList.slice(),
  };
}

/**
 * One pass over the rows recording, for each type and each (type, county), the
 * half-open row range it occupies. The payload is sorted by (type, county,
 * year), so every such group is CONTIGUOUS and a range is all the index a
 * lookup needs — no per-row objects, no per-row Map entries, ~50k small arrays
 * instead of 245k of anything.
 *
 * The contiguity assumption is checked rather than trusted: a re-sorted future
 * payload would otherwise silently truncate every county series.
 */
function buildIndexes(n) {
  typeRanges = [];
  seriesRanges = new Map();
  const types = raw.type;
  const counties = raw.county;
  let lastKey = null;
  let broken = 0;

  for (let i = 0; i < n; i++) {
    const t = types[i];
    const range = typeRanges[t];
    if (range === undefined) typeRanges[t] = [i, i + 1];
    else range[1] = i + 1;

    const key = t + '|' + counties[i];
    const seen = seriesRanges.get(key);
    if (seen === undefined) {
      seriesRanges.set(key, [i, i + 1]);
    } else {
      if (key !== lastKey) broken++;   // group re-opened: rows are not sorted
      seen[1] = i + 1;
    }
    lastKey = key;
  }

  if (broken) {
    console.warn('[ngp/data] ' + broken + ' (type, county) group(s) are not '
      + 'contiguous — the payload is not sorted by (type, county, year) and '
      + 'county series will be wrong.');
  }
}

/** Slug ⇄ type, built once and checked for collisions: two types that slugged
    to the same string would make ?type= ambiguous, and the URL is the app's
    primary state. */
function buildSlugs() {
  slugToType = new Map();
  for (const t of typeList) {
    const slug = typeSlug(t);
    if (slugToType.has(slug)) {
      console.warn('[ngp/data] slug collision on ' + JSON.stringify(slug)
        + ': ' + JSON.stringify(slugToType.get(slug)) + ' and ' + JSON.stringify(t));
      continue;
    }
    slugToType.set(slug, t);
  }
}

/* ── Records ─────────────────────────────────────────────────────────────── */

/**
 * @typedef {object} Rec
 * @property {string} id             5-character FSA county id
 * @property {number} year           PROGRAM year (not a calendar year)
 * @property {string} type           pasture type name
 * @property {Date}   start          UTC midnight of the season start
 * @property {Date}   end            UTC midnight of the season end
 * @property {number} start_yday     day of year 1–366, in the start's own year
 * @property {number} end_yday       day of year 1–366, in the end's own year
 * @property {number} duration_weeks whole weeks from start to end
 * @property {string} startLabel     "Apr 15, 2026"
 * @property {string} endLabel       "Nov 30, 2026"
 */

/**
 * Build the record for row `i`.
 *
 * Date.UTC(year, 0, dayOfYear) is the idiomatic day-of-year constructor: month
 * 0 with a day past 31 rolls forward through the calendar, and it gets leap
 * years right for free (yday 60 is Feb 29 in 2024 and Mar 1 in 2025).
 */
function makeRec(i) {
  const year = year0 + raw.year[i];
  const id = countyList[raw.county[i]];
  const sy = raw.sy[i];
  const ey = raw.ey[i];
  const start = new Date(Date.UTC(year + raw.so[i], 0, sy));
  const end = new Date(Date.UTC(year + raw.eo[i], 0, ey));
  return {
    id,
    year,
    type: typeList[raw.type[i]],
    start,
    end,
    start_yday: sy,
    end_yday: ey,
    // Whole weeks, floored: "33 weeks" reads as a period the reader can count,
    // and a fractional week on a program date is noise.
    duration_weeks: Math.floor((end - start) / MS_PER_WEEK),
    startLabel: LABEL_FMT.format(start),
    endLabel: LABEL_FMT.format(end),
  };
}

/* ── Lookups ─────────────────────────────────────────────────────────────── */

/**
 * Every county with a reported period for one (program year, pasture type).
 * Memoized: the returned Map is the module's own and is handed out by
 * reference — READ IT, never mutate it.
 *
 * @param {number} year program year
 * @param {string} type pasture type name
 * @returns {Map<string, Rec>} keyed by 5-character FSA id (empty when the
 *          combination has no rows, or the type is unknown)
 */
export function getYearType(year, type) {
  assertReady('getYearType');
  const t = typeIndex.get(type);
  if (t === undefined) return new Map();

  const key = year + '|' + t;
  const hit = yearTypeCache.get(key);
  if (hit) return hit;

  const out = new Map();
  const range = typeRanges[t];
  const offset = year - year0;
  if (range) {
    // Scans one type's rows (~15k), not the whole payload (245k).
    for (let i = range[0]; i < range[1]; i++) {
      if (raw.year[i] === offset) out.set(countyList[raw.county[i]], makeRec(i));
    }
  }
  yearTypeCache.set(key, out);
  return out;
}

/**
 * One county's reported periods for one pasture type, every year present in
 * the data, ascending. Years with no reported period are ABSENT rather than
 * null-filled — a gap in this array is a real fact about FSA's reporting, and
 * the consumer (the card's span chart) draws it as a gap.
 *
 * @param {string} id 5-character FSA county id
 * @param {string} type
 * @returns {Rec[]} shared, memoized — read, never mutate
 */
export function getCountySeries(id, type) {
  assertReady('getCountySeries');
  const t = typeIndex.get(type);
  const c = countyIdx.get(String(id));
  if (t === undefined || c === undefined) return [];

  const key = t + '|' + c;
  const hit = seriesCache.get(key);
  if (hit) return hit;

  const range = seriesRanges.get(key);
  const out = [];
  if (range) for (let i = range[0]; i < range[1]; i++) out.push(makeRec(i));
  // Sorted by (type, county, year) upstream, so this is already ascending; the
  // sort is a cheap guarantee for a consumer that reads out[0] as "earliest".
  out.sort((a, b) => a.year - b.year);
  seriesCache.set(key, out);
  return out;
}

/** @returns {number[]} every program year in the data, ascending. */
export function years() {
  assertReady('years');
  return yearList.slice();
}

/** @returns {string[]} the 16 pasture types, in the payload's own sort order. */
export function types() {
  assertReady('types');
  return typeList.slice();
}

/**
 * Type name → URL slug. PURE: it works before initData, because the boot path
 * has to validate a `?type=` param against a slug the moment the URL is read.
 *
 * Lowercase, every run of non-alphanumerics collapsed to one hyphen, hyphens
 * trimmed from both ends. The two pairs that make this worth testing:
 *   "Short Season Small Grains"     → short-season-small-grains
 *   "Short Season Small Grains (1)" → short-season-small-grains-1
 *   "Short Season Fall/Winter Small Grains"
 *                                   → short-season-fall-winter-small-grains
 *
 * @param {string} type
 * @returns {string}
 */
export function typeSlug(type) {
  return String(type)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * URL slug → type name, or null for anything not in the dictionary. Needs the
 * data (the dictionary IS the whitelist), so a boot path that reads `?type=`
 * before initData resolves must hold the raw slug and re-validate here.
 *
 * @param {string} slug
 * @returns {string|null}
 */
export function typeFromSlug(slug) {
  if (!ready) return null;
  if (slug == null) return null;
  return slugToType.get(String(slug).toLowerCase()) || null;
}

/**
 * @param {string} id 5-character FSA county id
 * @returns {{county: string, state: string}|null} null for an id that is not
 *          in the data at all (which is different from an id with no polygon).
 */
export function countyName(id) {
  assertReady('countyName');
  const i = countyIdx.get(String(id));
  if (i === undefined) return null;
  return { county: raw.county_names[i], state: raw.state_names[i] };
}

/** @returns {string[]} every county id in the DATA — including the island
 *  territories, which have no polygon in either boundary archive. */
export function allCountyIds() {
  assertReady('allCountyIds');
  return countyList.slice();
}
