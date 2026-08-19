#!/usr/bin/env node
/* ============================================================================
   FSA Normal Grazing Periods · tools/verify.mjs
   The deploy gate. Boots the app on a local static server and drives every
   route a user has, asserting that each one does the thing it exists to do —
   and that the console stays silent the whole way through.

     node tools/verify.mjs [workspaceRoot]

   Tooling is dev-only, in tools/package.json:

     npm ci --prefix tools
     npx --prefix tools playwright install --with-deps chromium

   ── Adapted from sustainable-fsa/style tools/consumer-verify.mjs ───────────
   That file is a SKELETON with an empty `appAsserts` array and a standing note
   that a run with it empty "proves nothing about what your app is FOR". This
   is that array, filled: ~107 assertions across sixteen sections, each one
   about something this county choropleth is actually for.

   Deltas from the skeleton, and why:

     · THE WORKSPACE ROOT IS SERVED, not the repo, with the app at
       /fsa-normal-grazing-period/. It matches the documented dev command
       (`python3 -m http.server 8000 -d <workspace>`), so a path bug that only
       shows up under a subdirectory deploy shows up here too. Everything the
       app loads from sustainable-fsa.com (the pinned style kit, the two county
       boundary archives) is fetched LIVE over the network — those origins are
       part of the contract, and a run that stubbed them would be verifying a
       different app.

     · THE ASSERTIONS DRIVE THE UI, not the state object. The year moves by
       dispatching `input` on the range; the pasture type by `change` on the
       select; a county opens by a real mouse click at the pixel MapLibre
       projects its centroid to. Where the app's own module API is used at all
       (`ngpContext()`, reached by a dynamic import that hits the page's module
       registry) it is to READ evidence or to reach a county that has no
       polygon to click — never to fake an interaction.

     · CONSOLE-CLEAN IS CHECKED AFTER EVERY STEP, not once at the end, so a
       CSP violation or a caught-and-logged failure is attributed to the
       interaction that caused it. With a meta CSP live this is the check that
       catches a stale anti-flash hash or a directive missing an origin — the
       page still renders, so the failure is otherwise invisible.

     · RENDER EVIDENCE IS `ngpReady`, and that flag means the payload joined
       and the first choropleth paint ran. It is NOT evidence of painted tiles.
       Nothing in CI should read it that way.

   Screenshots of every state land in verify-out/ (gitignored).
   ========================================================================== */
import { createServer } from 'node:http';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/* ══════════════════════════════════════════════════════════════════════════
   CONFIG
   ══════════════════════════════════════════════════════════════════════════ */
const CONFIG = {
  /** Workspace root: tools/ → repo → workspace. Override with argv[1]. */
  root: resolve(process.argv[2]
    || join(dirname(fileURLToPath(import.meta.url)), '..', '..')),

  /** The app, as a server path — a SUBDIRECTORY, which is how it deploys. */
  pagePath: '/fsa-normal-grazing-period/',

  /** The kit ships exactly these two. */
  themes: ['light', 'high-contrast'],

  viewports: {
    wide: { width: 1440, height: 900 },
    compact: { width: 375, height: 720 },
  },

  /** Seeded before load. The first-visit help auto-open fires 350ms after the
      help fetch resolves and would land on top of whichever step is running
      then; it is exercised deliberately in its own assertion instead. */
  initLocalStorage: { 'sfsa-ngp-seen-intro': '1' },

  /** RENDER EVIDENCE. A FUNCTION, never a string: a string predicate is
      eval'd in-page and the meta CSP has no 'unsafe-eval'. */
  renderEvidence: () => document.documentElement.dataset.ngpReady === '1',

  /** ngpReady waits this long: a 5 MB local payload plus a ~2 MB boundary
      archive over the network. Generous, because the failure it catches is
      "never", not "slow". */
  readyMs: 60000,

  /** Extra settle after the evidence fires: the font swap, the legend, the
      map's final frames. */
  settleMs: 2000,

  screenshotDir: resolve(join(dirname(fileURLToPath(import.meta.url)), '..', 'verify-out')),

  /** The county every state-dependent assertion uses. Missoula County, MT:
      data in every program year, and a polygon in BOTH boundary vintages, so
      no assertion below depends on which side of 2015 the slider sits. */
  county: { id: '30063', name: 'Missoula' },

  /** The source id the kit's addCountyLayers creates. Feature state lives
      here, and feature state is how a repaint is proved. */
  sourceId: 'sfsa-counties',
};
/* ══════════════════════════════════════════════════════════════════════════ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.topojson': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const ROOT = CONFIG.root;
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    // Read BEFORE writing headers — the other order commits a 200 and only
    // then finds the file missing, and the catch dies with
    // ERR_HTTP_HEADERS_SENT on an already-sent response.
    const body = await readFile(f);
    res.writeHead(200, {
      'content-type': MIME[extname(f)] || 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}${CONFIG.pagePath}`;

await rm(CONFIG.screenshotDir, { recursive: true, force: true });
await mkdir(CONFIG.screenshotDir, { recursive: true });

const browser = await chromium.launch({
  // A GitHub runner has no GPU; without a software rasterizer MapLibre never
  // gets a WebGL context and ngpReady never fires.
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});

/* ── Reporting ───────────────────────────────────────────────────────────── */

let failures = 0;
let skips = 0;
const results = [];

function check(label, ok, detail = '') {
  results.push({ label, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok || !detail ? '' : ' — ' + detail}`);
  if (!ok) failures++;
}

function skip(label, why) {
  skips++;
  results.push({ label, ok: null, detail: why });
  console.log(`  ○ ${label} — SKIPPED: ${why}`);
}

function section(name) { console.log(`\n${name}`); }

/* ── Session ─────────────────────────────────────────────────────────────── */

/**
 * Open the app in a fresh context and wait for real render evidence.
 *
 * @param {{query?: string, viewport?: object, theme?: string,
 *          storage?: object, permissions?: string[], downloads?: boolean,
 *          requireReady?: boolean}} [opts]
 */
async function open({
  query = '', viewport = CONFIG.viewports.wide, theme = 'light',
  storage = {}, permissions = [], downloads = false, requireReady = true,
  touch = false,
} = {}) {
  const ctx = await browser.newContext({
    viewport,
    acceptDownloads: downloads,
    permissions,
    // hasTouch is what makes `(hover: none)` and `(pointer: coarse)` MATCH. A
    // plain 375px desktop context still reports a fine pointer, so every
    // touch-target rule the kit ships behind `@media (hover: none)` stays
    // inert and a WCAG 2.5.5 measurement taken there is meaningless.
    hasTouch: touch,
    // Not a real origin grant until a page is loaded; Playwright scopes
    // permissions per-origin, so this is set again after goto below.
    baseURL: base,
  });
  await ctx.addInitScript((kv) => {
    for (const [k, v] of Object.entries(kv)) {
      try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ }
    }
  }, { ...CONFIG.initLocalStorage, 'sfsa-theme': theme, ...storage });

  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).split('\n')[0]));
  const downloadList = [];
  page.on('download', (d) => downloadList.push(d));

  await page.goto(base + query, { waitUntil: 'load', timeout: 60000 });
  let ready = true;
  if (requireReady) {
    try {
      await page.waitForFunction(CONFIG.renderEvidence, null, { timeout: CONFIG.readyMs });
    } catch (err) {
      ready = false;
      errors.push('render evidence (ngpReady) never fired: ' + String(err).split('\n')[0]);
    }
  }
  await page.waitForTimeout(CONFIG.settleMs);

  /** Drain the console errors seen so far and report them under `label`. */
  const clean = (label) => {
    const seen = errors.splice(0, errors.length);
    check(`console clean · ${label}`, seen.length === 0,
      seen.slice(0, 3).join(' | ') + (seen.length > 3 ? ` (+${seen.length - 3} more)` : ''));
  };

  const shot = async (name) => {
    await page.screenshot({ path: join(CONFIG.screenshotDir, name + '.png') });
  };

  return { ctx, page, errors, ready, clean, shot, downloads: downloadList };
}

/* ── In-page probes ──────────────────────────────────────────────────────────
   Every one of these reaches the LIVE app module: `js/app.js` is the page's
   entry point, and a dynamic import of the same URL hits the module registry
   and hands back the running instance rather than a second copy. The import is
   a module fetch, so it is `script-src 'self'`; nothing here builds a function
   from a string, which the CSP would (correctly) block. */

/** State + vintage + geometry count, in one round trip. */
const snapshot = (page) => page.evaluate(async () => {
  const app = await import(new URL('js/app.js', document.baseURI).href);
  const c = app.ngpContext();
  return {
    state: c.getState(),
    vintage: c.getVintage(),
    geometryCount: c.getCounties() ? c.getCounties().index.size : 0,
    center: c.getMap().getCenter().toArray(),
    zoom: c.getMap().getZoom(),
  };
});

/**
 * A fingerprint of what the choropleth is actually painting: how many counties
 * carry a color in MapLibre's feature state, and a hash of those colors in
 * geometry order. Two snapshots that differ prove a repaint reached GL; two
 * that match prove it did not.
 */
const paintSignature = (page, sourceId) => page.evaluate(async (src) => {
  const app = await import(new URL('js/app.js', document.baseURI).href);
  const c = app.ngpContext();
  const map = c.getMap();
  let colored = 0;
  let hash = 5381;
  for (const id of c.getCounties().index.keys()) {
    const st = map.getFeatureState({ source: src, id });
    const color = (st && st.color) || '';
    if (color) colored++;
    for (let i = 0; i < color.length; i++) {
      hash = (Math.imul(hash, 33) ^ color.charCodeAt(i)) >>> 0;
    }
  }
  return { colored, hash };
}, sourceId);

/** The paint color of one county, straight out of feature state. */
const colorOf = (page, id, sourceId) => page.evaluate(async ([i, src]) => {
  const app = await import(new URL('js/app.js', document.baseURI).href);
  const st = app.ngpContext().getMap().getFeatureState({ source: src, id: i });
  return (st && st.color) || null;
}, [id, sourceId]);

/** Move the year slider the way a pointer does: set the value, fire `input`. */
const slideYear = (page, year) => page.evaluate((y) => {
  const el = document.getElementById('year-range');
  el.value = String(y);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, year);

/** Two animation frames — the kit coalesces feature-state writes to one flush
    per frame, so a signature read in the same task reads the OLD paint. */
const settleFrames = (page) => page.evaluate(() => new Promise((r) => {
  requestAnimationFrame(() => requestAnimationFrame(r));
}));

/* ══════════════════════════════════════════════════════════════════════════
   1. THE MAIN RUN — light theme, 1440×900, one page, in order.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ Main run — light · 1440×900');

const main = await open({ permissions: ['clipboard-read', 'clipboard-write'] });
{
  const { page, clean, shot } = main;

  check('ngpReady fired (payload joined, first choropleth paint ran)', main.ready);
  clean('boot');
  await shot('01-boot');

  const boot = await snapshot(page);
  check('boot state is the documented default (2026 · Native Pasture · duration)',
    boot.state.year === 2026 && boot.state.type === 'Native Pasture'
      && boot.state.variable === 'duration',
    JSON.stringify(boot.state));
  check('an all-defaults view emits a CLEAN url (no query string)',
    new URL(page.url()).search === '', 'search is ' + new URL(page.url()).search);
  check('boot vintage follows the program year (2026 → dd22)',
    boot.vintage === 'dd22', 'vintage is ' + boot.vintage);

  /* ── 1a. Year slider → repaint ──────────────────────────────────────────
     "The slider moved and the map changed" is the app's core claim. Prove it
     on a county whose duration is KNOWN to differ between the two years, and
     stay on one side of 2015 so a vintage swap cannot be what changed. */
  section('▸ Year slider → repaint');
  const yearProbe = await page.evaluate(async () => {
    const d = await import(new URL('js/data.js', document.baseURI).href);
    const app = await import(new URL('js/app.js', document.baseURI).href);
    const { year, type } = app.ngpContext().getState();
    const ids = [...app.ngpContext().getCounties().index.keys()];
    for (const y of d.years()) {
      if (y === year || y < 2015) continue;   // one vintage only
      const now = d.getYearType(year, type);
      const then = d.getYearType(y, type);
      for (const id of ids) {
        const a = now.get(id);
        const b = then.get(id);
        if (a && b && a.duration_weeks !== b.duration_weeks) {
          return { year: y, id, from: a.duration_weeks, to: b.duration_weeks };
        }
      }
    }
    return null;
  });

  if (!yearProbe) {
    skip('year slider repaints the choropleth',
      'no county changes duration between two dd22 program years — the data '
      + 'cannot support this assertion');
  } else {
    const sigBefore = await paintSignature(page, CONFIG.sourceId);
    const colorBefore = await colorOf(page, yearProbe.id, CONFIG.sourceId);
    await slideYear(page, yearProbe.year);
    await page.waitForTimeout(400);
    await settleFrames(page);
    const sigAfter = await paintSignature(page, CONFIG.sourceId);
    const colorAfter = await colorOf(page, yearProbe.id, CONFIG.sourceId);
    const after = await snapshot(page);

    check(`year slider moved the app to ${yearProbe.year}`,
      after.state.year === yearProbe.year, 'state.year is ' + after.state.year);
    check('the <output> under the thumb tracks the slider',
      (await page.locator('#year-out').textContent()) === String(yearProbe.year));
    check(`county ${yearProbe.id} repainted `
      + `(${yearProbe.from} wk → ${yearProbe.to} wk)`,
      !!colorBefore && !!colorAfter && colorBefore !== colorAfter,
      `feature-state color ${colorBefore} → ${colorAfter}`);
    check('the whole choropleth repainted (feature-state signature changed)',
      sigBefore.hash !== sigAfter.hash,
      `${sigBefore.colored} colored @${sigBefore.hash} → ${sigAfter.colored} @${sigAfter.hash}`);
    check('the year is mirrored into the URL',
      new URL(page.url()).searchParams.get('year') === String(yearProbe.year),
      page.url());
    clean('year slider');
    await shot('02-year-slider');
  }

  /* ── 1b. Pasture type → repaint ─────────────────────────────────────────── */
  section('▸ Pasture type → repaint');
  const typeProbe = await page.evaluate(async () => {
    const d = await import(new URL('js/data.js', document.baseURI).href);
    const app = await import(new URL('js/app.js', document.baseURI).href);
    const { year, type } = app.ngpContext().getState();
    const ids = [...app.ngpContext().getCounties().index.keys()];
    const now = d.getYearType(year, type);
    for (const t of d.types()) {
      if (t === type) continue;
      const other = d.getYearType(year, t);
      if (!other.size) continue;
      for (const id of ids) {
        const a = now.get(id);
        const b = other.get(id);
        if (a && b && a.duration_weeks !== b.duration_weeks) return { type: t, id };
      }
    }
    return null;
  });

  if (!typeProbe) {
    skip('pasture type repaints the choropleth', 'no second type differs on any county');
  } else {
    const sigBefore = await paintSignature(page, CONFIG.sourceId);
    await page.selectOption('#type-select', typeProbe.type);
    await page.waitForTimeout(400);
    await settleFrames(page);
    const sigAfter = await paintSignature(page, CONFIG.sourceId);
    const after = await snapshot(page);
    check(`pasture type select changed the app to ${JSON.stringify(typeProbe.type)}`,
      after.state.type === typeProbe.type, 'state.type is ' + after.state.type);
    check('the choropleth repainted for the new type',
      sigBefore.hash !== sigAfter.hash,
      `${sigBefore.colored} colored @${sigBefore.hash} → ${sigAfter.colored} @${sigAfter.hash}`);
    check('the type is mirrored into the URL as a slug',
      /^[a-z0-9-]+$/.test(new URL(page.url()).searchParams.get('type') || ''),
      page.url());
    clean('type select');
    await shot('03-type-select');
    // Back to the default so the rest of the run reads against known data.
    await page.selectOption('#type-select', 'Native Pasture');
    await page.waitForTimeout(300);
  }

  /* ── 1c. Color-by → aria-pressed + the right legend body ───────────────── */
  section('▸ Color-by buttons → aria-pressed + legend swap');
  for (const [variable, cyclic] of [['start', true], ['end', true], ['duration', false]]) {
    await page.locator('#btn-var-' + variable).click();
    await page.waitForTimeout(300);
    await settleFrames(page);
    const st = await page.evaluate(() => ({
      pressed: Array.from(document.querySelectorAll('.seg-btn[data-variable]'))
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.dataset.variable),
      wheelHidden: document.getElementById('legend-wheel').hidden,
      barHidden: document.getElementById('legend-bar').hidden,
      wheelHasSvg: !!document.querySelector('#legend-wheel svg'),
      key: (document.getElementById('legend-key').textContent || '').trim(),
    }));
    check(`color-by ${variable}: exactly one button is aria-pressed, and it is this one`,
      st.pressed.length === 1 && st.pressed[0] === variable,
      'pressed = ' + JSON.stringify(st.pressed));
    check(`color-by ${variable}: the ${cyclic ? 'month wheel' : 'colorbar'} is the visible legend`,
      st.wheelHidden === !cyclic && st.barHidden === cyclic,
      `#legend-wheel hidden=${st.wheelHidden}, #legend-bar hidden=${st.barHidden}`);
    check(`color-by ${variable}: the text key is present (color is never the only channel)`,
      st.key.length > 40, JSON.stringify(st.key.slice(0, 60)));
    if (cyclic) {
      check('the month wheel is a real drawing, not the placeholder',
        st.wheelHasSvg, '#legend-wheel has no <svg>');
    }
    await shot('04-legend-' + variable);
  }
  clean('color-by buttons');

  /* ── 1d. Drag across 2015 → boundary vintage swap ───────────────────────
     A real drag: several `input` events in a row crossing the line once. The
     app debounces the swap by 250ms for exactly this reason, and the pill it
     shows while the archive is in flight is transient — so the swap is proved
     by the geometry count and the vintage, and the pill is caught if it can
     be. Mixing vintages inside a year would be a data-integrity bug, not a
     cosmetic one (kit county.js: dd17 ≤ 2014, dd22 ≥ 2015). */
  section('▸ Year drag across 2015 → boundary vintage swap');
  {
    const before = await snapshot(page);
    let sawPill = false;
    const pillWatch = page.waitForFunction(
      () => { const n = document.getElementById('app-note');
        return !n.hidden && /boundaries/i.test(n.textContent || ''); },
      null, { timeout: 4000 }).then(() => { sawPill = true; }).catch(() => {});

    for (const y of [2020, 2018, 2016, 2014, 2012]) {
      await slideYear(page, y);
      await page.waitForTimeout(60);
    }
    await pillWatch;
    await page.waitForFunction(() => document.getElementById('app-note').hidden,
      null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);
    await settleFrames(page);

    const after = await snapshot(page);
    check('the drag landed on 2012', after.state.year === 2012,
      'state.year is ' + after.state.year);
    check(`the boundary vintage swapped dd22 → dd17 for a pre-2015 year`,
      before.vintage === 'dd22' && after.vintage === 'dd17',
      `${before.vintage} → ${after.vintage}`);
    check('the geometry really changed under the map '
      + `(${before.geometryCount} → ${after.geometryCount} counties)`,
      after.geometryCount !== before.geometryCount && after.geometryCount > 3000,
      `${before.geometryCount} → ${after.geometryCount}`);
    check('the transient "switching boundaries" pill was shown', sawPill,
      'never saw #app-note say "boundaries" — the swap may have been silent');
    check('the pill was cleared once the swap finished',
      await page.locator('#app-note').isHidden());
    // Against the DATA, not a round number. 2012 Native Pasture has 2,979
    // reporting counties — a hardcoded "> 3000" here passes for the default
    // year and fails for this one, which says nothing about the app.
    const painted = await paintSignature(page, CONFIG.sourceId);
    const expected = await page.evaluate(async () => {
      const d = await import(new URL('js/data.js', document.baseURI).href);
      const app = await import(new URL('js/app.js', document.baseURI).href);
      const c = app.ngpContext();
      const { year, type } = c.getState();
      const idx = c.getCounties().index;
      let n = 0;
      for (const id of d.getYearType(year, type).keys()) if (idx.has(id)) n++;
      return n;
    });
    check('after the swap, every county with data AND a dd17 polygon carries a color',
      painted.colored === expected && expected > 2000,
      `${painted.colored} painted, ${expected} expected`);
    clean('vintage swap');
    await shot('05-vintage-dd17');
  }

  /* ── 1e. County click → card ────────────────────────────────────────────
     A genuine mouse click, at the pixel MapLibre projects the county's
     centroid to — not a call into the app. Clicking blind at the canvas
     centre would be a click on whatever the projection happens to put there. */
  section('▸ County click → detail card');
  {
    const pt = await page.evaluate(async (id) => {
      const app = await import(new URL('js/app.js', document.baseURI).href);
      const county = await import('https://sustainable-fsa.com/style/v0.1.0/county/county.js');
      const c = app.ngpContext();
      const feature = c.getCounties().index.get(id);
      if (!feature) return null;
      const center = county.countyCentroid(feature);
      if (!center) return null;
      const p = c.getMap().project(center);
      const box = document.getElementById('map').getBoundingClientRect();
      return { x: Math.round(box.x + p.x), y: Math.round(box.y + p.y) };
    }, CONFIG.county.id);

    if (!pt) {
      skip('county click opens the card', `no polygon for ${CONFIG.county.id}`);
    } else {
      await page.mouse.click(pt.x, pt.y);
      const opened = await page.waitForFunction(
        () => !document.getElementById('county-card').hidden, null, { timeout: 8000 })
        .then(() => true).catch(() => false);
      check('a click on the county polygon opens the detail card', opened,
        `clicked (${pt.x}, ${pt.y}) and #county-card stayed hidden`);

      const card = await page.evaluate(() => ({
        title: (document.getElementById('card-title').textContent || '').trim(),
        rows: document.querySelectorAll('#card-rows dt').length,
        text: (document.getElementById('card-rows').textContent || '').trim(),
        svg: !!document.querySelector('#card-content .span-figure svg'),
        bars: document.querySelectorAll('#card-content .span-figure svg rect').length,
        figcaption: !!document.querySelector('#card-content figcaption'),
        detailsTable: document.querySelectorAll('#card-content details table tbody tr').length,
      }));
      check('the card names the county it opened',
        card.title.includes(CONFIG.county.name), 'title is ' + JSON.stringify(card.title));
      check('#card-rows is a populated readout, not an empty box',
        card.rows >= 4 && card.text.length > 40, `${card.rows} rows`);
      check('the all-years span chart rendered as an SVG',
        card.svg && card.bars > 0, `svg=${card.svg}, ${card.bars} bar(s)`);
      check('the chart has its accessible twin (figcaption + a table of the same years)',
        card.figcaption && card.detailsTable > 10,
        `figcaption=${card.figcaption}, ${card.detailsTable} table row(s)`);
      check('the county is mirrored into the URL as a 5-CHARACTER STRING',
        new URL(page.url()).searchParams.get('county') === CONFIG.county.id,
        page.url());
      clean('county click');
      await shot('06-card-open');
    }
  }

  /* ── 1f. Escape precedence: dropdown above card ─────────────────────────
     The kit documents one Escape key shared by the two layers (ui/card.js §):
     the combobox takes it first and stops propagation; the card only sees an
     Escape nothing else handled. One press must never close both. */
  section('▸ Escape layering — dropdown above card, dialogs untouched');
  {
    await page.locator('#county-search').fill('Miss');
    await page.waitForSelector('#county-results [role="option"]:not([aria-disabled="true"])',
      { timeout: 5000 });
    const beforeEsc = await page.evaluate(() => ({
      dropdown: !document.getElementById('county-results').hidden,
      card: !document.getElementById('county-card').hidden,
    }));
    check('setup: dropdown and card are both open',
      beforeEsc.dropdown && beforeEsc.card, JSON.stringify(beforeEsc));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const afterFirst = await page.evaluate(() => ({
      dropdown: !document.getElementById('county-results').hidden,
      card: !document.getElementById('county-card').hidden,
      expanded: document.getElementById('county-search').getAttribute('aria-expanded'),
    }));
    check('the FIRST Escape closes the dropdown and leaves the card open',
      !afterFirst.dropdown && afterFirst.card, JSON.stringify(afterFirst));
    check('the combobox reports itself collapsed', afterFirst.expanded === 'false');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const afterSecond = await page.evaluate(() => ({
      card: !document.getElementById('county-card').hidden,
      info: document.getElementById('info-modal').open,
      table: document.getElementById('table-modal').open,
      legendExpanded: document.getElementById('legend-toggle').getAttribute('aria-expanded'),
      legendBodyHidden: document.getElementById('legend-body').hidden,
    }));
    check('the SECOND Escape closes the card', !afterSecond.card);
    check('Escape did not disturb the other layers (both dialogs still shut, '
      + 'legend still expanded)',
      !afterSecond.info && !afterSecond.table && afterSecond.legendExpanded === 'true'
        && !afterSecond.legendBodyHidden, JSON.stringify(afterSecond));
    check('closing the card drops ?county from the URL',
      !new URL(page.url()).searchParams.has('county'), page.url());
    clean('escape layering');
    await shot('07-escape');
  }

  /* ── 1g. Search → Enter → card + camera ─────────────────────────────────── */
  section('▸ Search → Enter → card opens and the camera moves');
  {
    const before = await snapshot(page);
    await page.evaluate(async () => {
      const app = await import(new URL('js/app.js', document.baseURI).href);
      window.__ngpMoved = false;
      app.ngpContext().getMap().once('moveend', () => { window.__ngpMoved = true; });
    });

    await page.locator('#county-search').fill('');
    await page.locator('#county-search').fill('Missoula');
    await page.waitForSelector('#county-results [role="option"]:not([aria-disabled="true"])',
      { timeout: 5000 });
    const rows = await page.evaluate(() => Array.from(
      document.querySelectorAll('#county-results [role="option"]:not([aria-disabled="true"])'))
      .map((li) => li.textContent.trim()));
    check('searching "Missoula" offers a matching county option',
      rows.some((r) => /Missoula/i.test(r)), JSON.stringify(rows.slice(0, 3)));

    await page.keyboard.press('Enter');
    const opened = await page.waitForFunction(
      () => !document.getElementById('county-card').hidden, null, { timeout: 8000 })
      .then(() => true).catch(() => false);
    check('Enter on the top hit opens the card', opened);
    const moved = await page.waitForFunction(() => window.__ngpMoved === true,
      null, { timeout: 15000 }).then(() => true).catch(() => false);
    const after = await snapshot(page);
    const dist = Math.hypot(after.center[0] - before.center[0],
      after.center[1] - before.center[1]);
    check('the camera flew to the county (moveend fired and the centre moved)',
      moved && dist > 1,
      `moveend=${moved}, centre moved ${dist.toFixed(3)}° `
      + `(${before.center.map((n) => n.toFixed(2))} → ${after.center.map((n) => n.toFixed(2))})`);
    check('the card is the searched county',
      (await page.locator('#card-title').textContent()).includes('Missoula'));
    clean('search → enter');
    await shot('08-search-select');
  }

  /* ── 1h. Help modal, rendered from help.md ──────────────────────────────── */
  section('▸ Help modal — rendered from help.md, not the offline fallback');
  {
    await page.locator('#btn-info').click();
    const open = await page.waitForFunction(
      () => document.getElementById('info-modal').open, null, { timeout: 5000 })
      .then(() => true).catch(() => false);
    check('the ? button opens the help dialog', open);
    const help = await page.waitForFunction(
      () => {
        const el = document.querySelector('#info-modal [data-help-content]');
        return !!(el && el.querySelector('h2') && el.querySelector('table'));
      }, null, { timeout: 15000 }).then(() => true).catch(() => false);
    const shape = await page.evaluate(() => {
      const el = document.querySelector('#info-modal [data-help-content]');
      return {
        h2: el ? el.querySelectorAll('h2').length : 0,
        tables: el ? el.querySelectorAll('table').length : 0,
        tableRows: el ? el.querySelectorAll('table tbody tr').length : 0,
        chars: el ? (el.textContent || '').trim().length : 0,
      };
    });
    check('help.md rendered into the modal (an H2 and a table are present, so '
      + 'this is the real help and not the offline fallback paragraph)',
      help && shape.h2 > 0 && shape.tables > 0, JSON.stringify(shape));
    await shot('09-help-modal');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('info-modal').open,
      null, { timeout: 5000 }).catch(() => {});
    check('Escape closes the help dialog and the card underneath survives it',
      !(await page.evaluate(() => document.getElementById('info-modal').open))
        && !(await page.evaluate(() => document.getElementById('county-card').hidden)));
    clean('help modal');
  }

  /* ── 1i. The data table — the a11y twin's escape hatch ──────────────────
     Slide back to the default year first: it is where the payload is fullest
     (3,082 Native Pasture counties in 2026 against 2,979 in 2012), so the
     "more than three thousand rows" claim is testable — and the trip back
     across 2015 exercises the vintage swap in the OTHER direction, which the
     drag above never does. */
  section('▸ Data table dialog');
  {
    await slideYear(page, 2026);
    await page.waitForFunction(() => document.getElementById('app-note').hidden,
      null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);
    const back = await snapshot(page);
    check('sliding back over 2015 swaps the vintage the other way (dd17 → dd22)',
      back.vintage === 'dd22' && back.geometryCount === 3106,
      `${back.vintage}, ${back.geometryCount} polygons`);

    const st = await snapshot(page);
    await page.locator('#btn-table').click();
    const built = await page.waitForFunction(
      () => document.getElementById('table-modal').open
        && document.querySelectorAll('#table-modal-body tbody tr').length > 0,
      null, { timeout: 30000 }).then(() => true).catch(() => false);
    check('the table button opens the dialog and builds the table', built);
    const table = await page.evaluate(() => ({
      rows: document.querySelectorAll('#table-modal-body tbody tr').length,
      caption: (document.getElementById('table-modal-caption').textContent || '').trim(),
      srCaption: (document.querySelector('#table-modal-body table caption') || {}).textContent || '',
      headers: Array.from(document.querySelectorAll('#table-modal-body thead th'))
        .map((th) => th.textContent.trim()),
      scoped: document.querySelectorAll('#table-modal-body thead th[scope="col"]').length,
      rowHeaders: document.querySelectorAll('#table-modal-body tbody th[scope="row"]').length,
      region: document.getElementById('table-modal-body').getAttribute('role'),
      regionLabel: document.getElementById('table-modal-body').getAttribute('aria-label'),
      tabbable: document.getElementById('table-modal-body').tabIndex,
    }));
    const dataRows = await page.evaluate(async () => {
      const d = await import(new URL('js/data.js', document.baseURI).href);
      const app = await import(new URL('js/app.js', document.baseURI).href);
      const { year, type } = app.ngpContext().getState();
      return d.getYearType(year, type).size;
    });
    check('the table holds more than 3,000 county rows', table.rows > 3000,
      table.rows + ' rows');
    check('it is the map\'s DATA, row for row — not a sample and not a summary',
      table.rows === dataRows, `${table.rows} rows vs ${dataRows} records`);
    check('the caption names the program year AND the pasture type',
      table.caption.includes(String(st.state.year)) && table.caption.includes(st.state.type),
      JSON.stringify(table.caption));
    check('the table has a name of its own for table navigation (sr-only <caption>)',
      table.srCaption.trim().length > 0, JSON.stringify(table.srCaption));
    check('every column header is scope="col" and every row has a row header',
      table.scoped === table.headers.length && table.rowHeaders === table.rows,
      `${table.scoped}/${table.headers.length} col, ${table.rowHeaders}/${table.rows} row`);
    check('the scrolling body is keyboard-reachable and named (WCAG 2.1.1)',
      table.region === 'region' && !!table.regionLabel && table.tabbable === 0,
      JSON.stringify({ region: table.region, tabindex: table.tabbable }));
    await shot('10-table-modal');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('table-modal').open,
      null, { timeout: 5000 }).catch(() => {});
    clean('data table');
  }

  /* ── 1j. Share → clipboard ──────────────────────────────────────────────── */
  section('▸ Share → clipboard');
  {
    await page.evaluate(() => navigator.clipboard.writeText('sentinel')).catch(() => {});
    await page.locator('#btn-share').click();
    await page.waitForTimeout(600);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    const here = await page.evaluate(() => location.href);
    check('Share writes the current view URL to the clipboard',
      copied === here, `clipboard ${JSON.stringify(copied)} vs location ${JSON.stringify(here)}`);
    // "Round-trips" has to mean the URL REPRODUCES the view, not that it
    // carries a particular set of keys: the app elides every param that is at
    // its default, so asserting `year` is present fails a view that is legally
    // at 2026. Load the copied link in a clean context and compare.
    const mine = await snapshot(page);
    check('the copied URL keeps the clean-URL discipline (no param at its default)',
      !new URL(copied).searchParams.has('variable')
        && (mine.state.year !== 2026) === new URL(copied).searchParams.has('year'),
      copied);
    const trip = await open({ query: new URL(copied).search });
    const theirs = await snapshot(trip.page);
    check('the copied URL really reproduces the view (year, type, variable, '
      + 'county and camera all survive a reload)',
    theirs.state.year === mine.state.year
        && theirs.state.type === mine.state.type
        && theirs.state.variable === mine.state.variable
        && theirs.state.countyId === mine.state.countyId
        && Math.abs(theirs.center[0] - mine.center[0]) < 0.05
        && Math.abs(theirs.center[1] - mine.center[1]) < 0.05,
    JSON.stringify({ mine: mine.state, theirs: theirs.state }));
    trip.clean('shared-link reload');
    await trip.shot('10b-shared-link-roundtrip');
    await trip.ctx.close();
    clean('share');
  }

  /* ── 1k. A county with data but no polygon ──────────────────────────────
     Computed, never assumed. The obvious candidate is Puerto Rico — but PR IS
     in both boundary archives, so searching for "Adjuntas" would test the
     ordinary path and call it the exceptional one. The geometry-less set is
     therefore derived at runtime: allCountyIds() minus the loaded geometry
     index. It is vintage-dependent (dd17 and dd22 do not hold the same
     footprints), so both are probed before this gives up, and a genuinely
     empty set SKIPS rather than passing vacuously. */
  section('▸ A county with data but no boundary');
  {
    const probe = async () => page.evaluate(async () => {
      const d = await import(new URL('js/data.js', document.baseURI).href);
      const app = await import(new URL('js/app.js', document.baseURI).href);
      const idx = app.ngpContext().getCounties().index;
      const missing = d.allCountyIds().filter((id) => !idx.has(id));
      return {
        vintage: app.ngpContext().getVintage(),
        total: d.allCountyIds().length,
        geometry: idx.size,
        missing: missing.slice(0, 5),
        count: missing.length,
      };
    });

    let orphans = await probe();
    console.log(`    (data ids ${orphans.total}, ${orphans.vintage} polygons `
      + `${orphans.geometry}, ids with no polygon ${orphans.count})`);
    if (!orphans.count) {
      // Cross the 2015 line and look in the other archive before concluding
      // there is nothing to test.
      const other = (await snapshot(page)).state.year >= 2015 ? 2012 : 2026;
      await slideYear(page, other);
      await page.waitForFunction(() => document.getElementById('app-note').hidden,
        null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(500);
      orphans = await probe();
      console.log(`    (retried on ${orphans.vintage}: ${orphans.geometry} polygons, `
        + `${orphans.count} ids with no polygon)`);
    }

    if (!orphans.count) {
      skip('a data-only county says it has no boundary',
        `every one of the ${orphans.total} county ids in the payload has a polygon `
        + `in ${orphans.vintage} — there is no geometry-less id to test`);
    } else {
      const id = orphans.missing[0];
      await page.evaluate(async (i) => {
        const app = await import(new URL('js/app.js', document.baseURI).href);
        app.ngpContext().selectCounty(i);
      }, id);
      await page.waitForTimeout(500);
      const text = await page.locator('#card-rows').textContent();
      check(`county ${id} has data but no polygon — the card SAYS SO rather than `
        + 'showing an empty box',
      /no boundary available/i.test(text), JSON.stringify(text.slice(0, 160)));
      check('it is still findable in the search index',
        await page.evaluate(async (i) => {
          const app = await import(new URL('js/app.js', document.baseURI).href);
          const d = await import(new URL('js/data.js', document.baseURI).href);
          const nm = d.countyName(i);
          if (!nm) return false;
          const input = document.getElementById('county-search');
          input.value = nm.county;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 200));
          return Array.from(document.querySelectorAll(
            '#county-results [role="option"]:not([aria-disabled="true"])'))
            .some((li) => li.textContent.includes(i));
        }, id));
      await shot('11-no-boundary');
      clean('data-only county');
    }
  }

  await main.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   2. DEEP LINK — every param honoured on load.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ Deep link ?county=30063&year=2012&type=native-pasture&variable=start');
{
  const s = await open({
    query: '?county=30063&year=2012&type=native-pasture&variable=start',
  });
  check('deep-linked page reaches ngpReady', s.ready);
  const st = await s.page.evaluate(() => ({
    cardOpen: !document.getElementById('county-card').hidden,
    title: (document.getElementById('card-title').textContent || '').trim(),
    slider: document.getElementById('year-range').value,
    output: (document.getElementById('year-out').textContent || '').trim(),
    type: document.getElementById('type-select').value,
    pressed: Array.from(document.querySelectorAll('.seg-btn[data-variable]'))
      .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.variable),
    wheelHidden: document.getElementById('legend-wheel').hidden,
    barHidden: document.getElementById('legend-bar').hidden,
    helpOpen: document.getElementById('info-modal').open,
  }));
  const snap = await snapshot(s.page);
  check('the card is open on load, on the linked county',
    st.cardOpen && st.title.includes('Missoula'), JSON.stringify(st.title));
  check('the slider AND its output are at 2012',
    st.slider === '2012' && st.output === '2012', JSON.stringify(st));
  check('the pasture-type slug resolved to its dictionary name',
    st.type === 'Native Pasture', JSON.stringify(st.type));
  check('start is the pressed color-by button and the WHEEL is the visible legend',
    st.pressed.length === 1 && st.pressed[0] === 'start'
      && st.wheelHidden === false && st.barHidden === true, JSON.stringify(st));
  check('the pre-2015 year booted straight onto dd17 boundaries (no mixing)',
    snap.vintage === 'dd17', 'vintage is ' + snap.vintage);
  check('a deep link suppresses the first-visit help tour',
    !st.helpOpen);
  check('the choropleth painted for the deep-linked view',
    (await paintSignature(s.page, CONFIG.sourceId)).colored > 2000);
  s.clean('deep link');
  await s.shot('12-deep-link');
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   3. ?export= — the headless poster path.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ ?export=light — headless PNG export');
{
  // A stored theme the export must NOT overwrite: the param forces `light`
  // with persist:false, and a job that rewrote a visitor's preference would be
  // a silent, permanent side effect.
  const s = await open({
    query: '?export=light',
    theme: 'high-contrast',
    downloads: true,
    requireReady: true,
  });
  check('the export page reaches ngpReady before exporting', s.ready);

  const stamped = await s.page.waitForFunction(
    () => document.documentElement.dataset.ngpExported === '1'
      || document.documentElement.dataset.ngpExportError === '1',
    null, { timeout: 120000 }).then(() => true).catch(() => false);
  const flags = await s.page.evaluate(() => ({
    exported: document.documentElement.dataset.ngpExported || null,
    error: document.documentElement.dataset.ngpExportError || null,
    theme: document.documentElement.dataset.theme,
    stored: (() => { try { return localStorage.getItem('sfsa-theme'); } catch (e) { return 'unavailable'; } })(),
  }));
  check('?export= stamps a completion flag rather than hanging', stamped,
    'neither ngpExported nor ngpExportError appeared inside 120s');
  check('the run SUCCEEDED (ngpExported=1, no ngpExportError)',
    flags.exported === '1' && flags.error === null, JSON.stringify(flags));
  check('?export=light forced the light theme for the render',
    flags.theme === 'light', 'data-theme is ' + flags.theme);
  check('?export= did NOT rewrite the visitor\'s stored theme',
    flags.stored === 'high-contrast',
    'sfsa-theme in localStorage is ' + JSON.stringify(flags.stored));

  await s.page.waitForTimeout(1500);
  check('exactly one file was downloaded', s.downloads.length === 1,
    s.downloads.length + ' download(s)');
  if (s.downloads.length) {
    const dl = s.downloads[0];
    const name = dl.suggestedFilename();
    const path = await dl.path();
    const bytes = path ? await readFile(path) : Buffer.alloc(0);
    const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50
      && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d
      && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
    check('the download is named for the view it holds '
      + '(fsa-ngp_<year>_<type-slug>_<variable>.png)',
      /^fsa-ngp_\d{4}_[a-z0-9-]+_(start|end|duration)\.png$/.test(name), name);
    check('the file really is a PNG (magic bytes 89 50 4E 47 0D 0A 1A 0A)', png,
      'first bytes: ' + [...bytes.slice(0, 8)].map((b) => b.toString(16)).join(' '));
    check('the poster is a poster, not a blank canvas (> 100 KB)',
      bytes.length > 100 * 1024, Math.round(bytes.length / 1024) + ' KB');
  }
  s.clean('export run');
  await s.shot('13-export');
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   4. HIGH-CONTRAST THEME — the second of the kit's two.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ High-contrast theme');
{
  const s = await open({ theme: 'high-contrast', query: '?theme=high-contrast' });
  check('high-contrast reaches ngpReady', s.ready);
  check('the theme is applied to <html>',
    (await s.page.evaluate(() => document.documentElement.dataset.theme)) === 'high-contrast');
  check('the choropleth painted in high contrast',
    (await paintSignature(s.page, CONFIG.sourceId)).colored > 2000);
  // Before the toggle below, or the file named "high-contrast" holds a light
  // -theme page and the screenshot set quietly stops being evidence.
  await s.shot('14-high-contrast');
  const toggled = await s.page.evaluate(async () => {
    document.getElementById('btn-theme').click();
    await new Promise((r) => setTimeout(r, 300));
    return {
      theme: document.documentElement.dataset.theme,
      pressed: document.getElementById('btn-theme').getAttribute('aria-pressed'),
      label: document.getElementById('btn-theme').getAttribute('aria-label'),
    };
  });
  check('the theme toggle flips the theme and its own accessible state',
    toggled.theme === 'light' && toggled.pressed === 'false'
      && /high-contrast/i.test(toggled.label || ''), JSON.stringify(toggled));
  s.clean('high-contrast');
  await s.shot('14b-toggled-back-to-light');
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   5. COMPACT 375×720 — the phone.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ Compact 375×720 (touch)');
{
  const s = await open({ viewport: CONFIG.viewports.compact, touch: true });
  const { page } = s;
  check('compact reaches ngpReady', s.ready);
  check('the context really is a coarse-pointer one (so the kit\'s '
    + '@media (hover: none) touch sizing is live)',
  await page.evaluate(() => window.matchMedia('(hover: none)').matches
    && window.matchMedia('(pointer: coarse)').matches));
  check('the page does not scroll horizontally at 375px',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    await page.evaluate(() => `scrollWidth ${document.documentElement.scrollWidth} > `
      + `innerWidth ${window.innerWidth}`));
  check('the search input is collapsed behind its toggle at 375px',
    !(await page.locator('#county-search').isVisible()));
  await s.shot('15-compact-boot');

  // Open a county: at this width the kit's theme docks .sfsa-card as a bottom
  // sheet (theme §6 COMPACT). Everything below is about whether it actually
  // docks — and whether the close button can be TAPPED, which is the only
  // close route a touch user has.
  await page.evaluate(async (id) => {
    const app = await import(new URL('js/app.js', document.baseURI).href);
    app.ngpContext().selectCounty(id);
  }, CONFIG.county.id);
  await page.waitForFunction(() => !document.getElementById('county-card').hidden,
    null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  await s.shot('16-compact-card');

  const sheet = await page.evaluate(() => {
    const card = document.getElementById('county-card');
    const btn = document.getElementById('card-close');
    const r = btn.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      card: { top: Math.round(cr.top), bottom: Math.round(cr.bottom), height: Math.round(cr.height) },
      viewportH: window.innerHeight,
      computedTop: getComputedStyle(card).top,
      hitTag: hit ? (hit.id ? '#' + hit.id : hit.tagName.toLowerCase()
        + (hit.className ? '.' + String(hit.className).split(' ')[0] : '')) : null,
      hitInsideCard: !!(hit && card.contains(hit)),
      btnBox: { w: Math.round(r.width), h: Math.round(r.height) },
      sheetVar: getComputedStyle(document.documentElement).getPropertyValue('--sheet-h').trim(),
    };
  });
  check('the county card DOCKS to the bottom edge as a sheet at 375px',
    Math.abs(sheet.card.bottom - sheet.viewportH) <= 2,
    `card occupies y ${sheet.card.top}–${sheet.card.bottom} of a ${sheet.viewportH}px `
    + `viewport (computed top: ${sheet.computedTop}) — it is anchored to the TOP, `
    + `not docked. --sheet-h is stamped at ${sheet.sheetVar} regardless, which `
    + 'lifts the bottom corner controls and the toast by the height of a sheet '
    + 'that is not there');
  check('the card\'s close button is hit-testable (the only close route a touch '
    + 'user has)', sheet.hitInsideCard,
    `elementFromPoint at the button centre returns ${sheet.hitTag}, which is not `
    + 'inside the card — the button is covered');
  check('the close button meets the kit\'s 44px touch target (WCAG 2.5.5)',
    sheet.btnBox.w >= 44 && sheet.btnBox.h >= 44,
    `${sheet.btnBox.w}×${sheet.btnBox.h}px`);

  /* Every other interactive control on the phone, measured against the size
     the KIT's own @media (hover: none) block promises for it — not against a
     flat 40, which would fail `.sfsa-panel-toggle` for being exactly the
     36×36 the kit deliberately sets it to two lines below the 44px dismiss
     rule. A design-system decision is not this app's defect; the measurement
     is printed either way so a reader can disagree with the kit in the open.
     (36×36 still clears WCAG 2.5.8 Target Size (Minimum), 24×24 at AA; the
     40/44 numbers here are the house's 2.5.5-AAA convention.) */
  const targets = await page.evaluate(() => {
    const contract = [
      ['.nav-btn, .seg-btn', 40],
      ['#type-select', 40],
      ['.card-close, .modal-close', 44],
      ['.sfsa-combobox input[type="search"]', 40],
      ['#year-range', 40],
      ['.sfsa-panel-toggle', 36],
    ];
    const out = [];
    for (const [sel, min] of contract) {
      for (const el of document.querySelectorAll(sel)) {
        if (!el.getClientRects().length) continue;
        const r = el.getBoundingClientRect();
        out.push({
          id: el.id || String(el.className).split(' ')[0],
          w: Math.round(r.width), h: Math.round(r.height), min,
        });
      }
    }
    return out;
  });
  const undersized = targets.filter((m) => m.w < m.min || m.h < m.min);
  console.log('    touch targets: '
    + targets.map((m) => `${m.id} ${m.w}×${m.h}`).join(', '));
  check('every visible control meets the touch size the kit promises it '
    + '(40px controls, 44px dismiss, 36px panel toggle)',
  undersized.length === 0,
  undersized.map((m) => `${m.id} ${m.w}×${m.h} < ${m.min}`).join(', '));

  s.clean('compact');
  await s.ctx.close();
}

/* ── Done ────────────────────────────────────────────────────────────────── */

await browser.close();
server.close();

const passed = results.filter((r) => r.ok === true).length;
console.log('\n' + '─'.repeat(72));
console.log(`  ${passed} passed · ${failures} failed · ${skips} skipped`);
if (failures) {
  console.log('\n  FAILED:');
  for (const r of results.filter((x) => x.ok === false)) {
    console.log(`    ✗ ${r.label}`);
    if (r.detail) console.log(`        ${r.detail}`);
  }
}
console.log(`\n  Screenshots: ${CONFIG.screenshotDir}`);
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
