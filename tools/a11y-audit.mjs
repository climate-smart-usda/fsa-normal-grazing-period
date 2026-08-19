#!/usr/bin/env node
/* ============================================================================
   FSA Normal Grazing Periods · tools/a11y-audit.mjs
   Axe over the app in BOTH themes at TWO viewports and in SIX interaction
   states. Serious/critical violations fail the run — the kit's rule (AGENTS.md
   §6: "the axe workflow failing on serious/critical is a hard stop, not a flake
   to re-run") applies to consumers too.

     node tools/a11y-audit.mjs [workspaceRoot]

   Tooling is dev-only and lives in tools/package.json (the repo-root
   package.json stays gitignored, per the kit's zero-dependency inheritance):

     npm ci --prefix tools
     npx --prefix tools playwright install --with-deps chromium

   ── Adapted from sustainable-fsa/style tools/a11y-audit.mjs ────────────────
   Deltas from the kit's version, all forced by what this app IS:

     · THE WORKSPACE ROOT IS SERVED, not this repo. The app references nothing
       outside its own directory except absolute https URLs, so serving the
       repo alone would work — but the documented dev workflow is
       `python3 -m http.server 8000 -d <workspace>` with the app at
       /fsa-normal-grazing-period/, and an audit that serves a different
       geometry than the humans do is an audit of a different page. Pass a
       different root as argv[1] if the checkout sits somewhere else.

     · ngpReady IS A GATE HERE. The kit's demo degrades to an error note when
       the boundary fetch or WebGL is missing and audits the rest of the page
       anyway; this app IS the map, and four of the six states below cannot be
       reached before the data has landed. A run that never sees ngpReady is
       reported as a failure rather than as a thin pass. Note what the flag
       proves: the data loaded and the first choropleth paint ran. It is NOT
       evidence of painted tiles, and nothing in CI should read it that way.

     · SIX STATES PER COMBO, not two. The kit probes the combobox because its
       listbox does not exist until something is typed. Every floating surface
       in this app has the same property — the card, the two <dialog>s and the
       dropdown are all absent or [hidden] at rest, so a rest-only audit covers
       the navbar and a WebGL rectangle. The states:

         rest           the page as it boots
         help           the help <dialog>, rendered from help.md
         search-matches the listbox with real option rows
         search-empty   a query that matches nothing — the listbox's only child
                        is then an info row, and while that row was
                        role="presentation" this was aria-required-children
                        (critical) in all four combos
         card           a county selected, the detail card open over the map
         table          the data-table <dialog>, ~3,000 rows of markup

     · Violations are merged by rule id ACROSS states and each is reported with
       the states it fired in, so a rule that fires everywhere reads as one
       finding and a rule that only fires with the table open is obvious.

   The chromium GL flags are the kit's: a GitHub runner has no GPU, and without
   a software rasterizer MapLibre never gets a context, ngpReady never fires,
   and the run fails for a reason that has nothing to do with accessibility.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

/** Default: the workspace root, two levels up from this file (tools/ → repo →
    workspace). */
const root = resolve(process.argv[2]
  || join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const PAGE = '/fsa-normal-grazing-period/';
const THEMES = ['light', 'high-contrast'];
const VIEWPORTS = [
  { name: 'wide', width: 1440, height: 900 },
  { name: 'narrow', width: 375, height: 720 },
];

/** ngpReady waits this long. The payload is 5 MB local plus a ~2 MB boundary
    archive over the network; 60s is generous on purpose, because the failure
    it exists to catch is "never", not "slow". */
const READY_MS = 60000;
/** After ngpReady: the font swap, the legend, the map's first frames. */
const SETTLE_MS = 1500;

/** Seeded before load. `sfsa-ngp-seen-intro` suppresses the first-visit help
    auto-open, which would otherwise land on top of the "rest" state 350ms in
    and make that state a coin flip. The help modal is audited deliberately,
    two states below. */
const INIT_LS = { 'sfsa-ngp-seen-intro': '1' };

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

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    // Read BEFORE writing headers: the other order commits a 200 and only then
    // discovers the file is missing, so the catch tries to send 404 headers on
    // an already-sent response and the harness dies with ERR_HTTP_HEADERS_SENT.
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  // A GitHub runner has no GPU. Without a software rasterizer MapLibre fails
  // to get a WebGL context and ngpReady never fires.
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});

/**
 * Select a county through the app's own API rather than by clicking a polygon.
 *
 * app.js is the page's entry point and exports ngpContext(); a dynamic import
 * of the SAME url hits the module registry and returns the instance the page is
 * running, not a second copy. Clicking the canvas instead would make this state
 * depend on where a projection happens to put a shape at 375px.
 *
 * The import is a real module fetch, so it is `script-src 'self'` — allowed by
 * the page's meta CSP. Nothing here builds a function from a string: there is
 * no 'unsafe-eval', and `new Function` inside the page would be blocked.
 */
function selectCounty(page, id) {
  return page.evaluate(async (countyId) => {
    const mod = await import(new URL('js/app.js', document.baseURI).href);
    mod.ngpContext().selectCounty(countyId);
  }, id);
}

/* ── The six states ───────────────────────────────────────────────────────
   Each `enter` leaves the page in the state; each `exit` puts it back. They
   run in order inside one page, so the exits matter: a card left open under
   the table dialog would make the last state a compound of two.

   A state that cannot be reached is reported as `:unavailable` and the axe
   pass still runs — the probe is extra reach, not the gate. */
const STATES = [
  {
    name: 'rest',
    async enter() { /* as booted */ },
    async exit() {},
  },
  {
    name: 'help',
    async enter(page) {
      await page.locator('#btn-info').click();
      await page.waitForFunction(() => document.getElementById('info-modal').open,
        null, { timeout: 5000 });
      // help.md is a separate fetch; auditing the offline fallback paragraph
      // instead of the real help would audit four sentences and call it a page.
      await page.waitForFunction(
        () => !!document.querySelector('#info-modal [data-help-content] table'),
        null, { timeout: 10000 });
    },
    async exit(page) {
      await page.evaluate(() => document.getElementById('info-modal').close());
    },
  },
  {
    name: 'search-matches',
    async enter(page) {
      await openSearch(page);
      await page.locator('#county-search').fill('a');
      await page.waitForSelector('#county-results [role="option"]:not([aria-disabled="true"])',
        { timeout: 5000 });
    },
    async exit(page) { await clearSearch(page); },
  },
  {
    name: 'search-empty',
    async enter(page) {
      await openSearch(page);
      await page.locator('#county-search').fill('zzzzzzzz');
      await page.waitForSelector('#county-results [role="option"][aria-disabled="true"]',
        { timeout: 5000 });
    },
    async exit(page) { await clearSearch(page); },
  },
  {
    name: 'card',
    async enter(page) {
      // Missoula County, MT — a county with data in every year and a polygon in
      // both vintages, so this state is the same state on every run.
      await selectCounty(page, '30063');
      await page.waitForFunction(() => !document.getElementById('county-card').hidden,
        null, { timeout: 5000 });
      await page.waitForSelector('#card-content .span-figure svg', { timeout: 5000 });
    },
    // Escape, not a click on #card-close: at 375px that button is not
    // hit-testable (tools/verify.mjs owns that assertion — see the compact
    // section there), and an audit that hung for 30s on a known layout defect
    // would be reporting it in the wrong place and in the wrong way.
    async exit(page) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('county-card').hidden,
        null, { timeout: 5000 });
    },
  },
  {
    name: 'table',
    async enter(page) {
      await page.locator('#btn-table').click();
      await page.waitForFunction(
        () => document.getElementById('table-modal').open
          && document.querySelectorAll('#table-modal-body tbody tr').length > 100,
        null, { timeout: 20000 });
    },
    async exit(page) {
      await page.evaluate(() => document.getElementById('table-modal').close());
    },
  },
];

/** The search input is collapsed behind a toggle below 640px. */
async function openSearch(page) {
  const input = page.locator('#county-search');
  if (!(await input.isVisible())) {
    await page.locator('#btn-search-toggle').click({ timeout: 3000 });
    await input.waitFor({ state: 'visible', timeout: 3000 });
  }
}

async function clearSearch(page) {
  await page.locator('#county-search').fill('');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('county-results').hidden,
    null, { timeout: 3000 }).catch(() => {});
}

/* ── Run ──────────────────────────────────────────────────────────────────── */

const rows = [];
let failed = false;

for (const theme of THEMES) {
  for (const vp of VIEWPORTS) {
    const label = `${theme} · ${vp.name} ${vp.width}×${vp.height}`;
    // @axe-core/playwright requires a page created from an explicit context.
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
    });
    // The theme goes in through localStorage, where the anti-flash boot looks
    // second (after ?theme=). Seeding it audits the returning-visitor path, and
    // it runs before first paint, so nothing flashes.
    await context.addInitScript((kv) => {
      for (const [k, v] of Object.entries(kv)) {
        try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ }
      }
    }, { ...INIT_LS, 'sfsa-theme': theme });

    const page = await context.newPage();
    const consoleErrors = [];
    /* AXE'S OWN CSP NOISE, filtered out on purpose.
       axe-core applies `style` ATTRIBUTES to the nodes it measures, and this
       page ships a meta CSP with no 'unsafe-inline' in style-src — so every
       axe pass logs two "Applying inline style violates…" errors that belong
       to the auditor, not to the app. Verified by running the same page with
       and without an axe pass: 0 errors before, 2 after, none from any app
       interaction. Counting them here would put a permanent phantom in the
       console column and train the next reader to ignore it.
       Console-clean is a GATE in tools/verify.mjs, which never loads axe and
       therefore never has to filter anything. */
    const isAxeCspNoise = (t) => /Applying inline style violates/.test(t);
    const record = (t) => { if (!isAxeCspNoise(t)) consoleErrors.push(t); };
    page.on('pageerror', (e) => record(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') record(m.text()); });

    await page.goto(base + PAGE, { waitUntil: 'domcontentloaded' });

    let ready = true;
    try {
      await page.waitForFunction(() => document.documentElement.dataset.ngpReady === '1',
        null, { timeout: READY_MS });
    } catch {
      ready = false;
      failed = true;
      console.error(`\n[${label}] ngpReady NEVER FIRED after ${READY_MS / 1000}s — `
        + 'the data did not load or the map did not paint. The states below are '
        + 'audited against whatever is on screen, which is not the app.');
    }
    await page.waitForTimeout(SETTLE_MS);

    const appliedTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (appliedTheme !== theme) {
      failed = true;
      console.error(`[${label}] theme did not apply: <html data-theme="${appliedTheme}">`);
    }

    // One axe pass per state, merged by rule id so the counts stay comparable
    // to a single-pass run and a rule firing in several states is reported once,
    // naming all of them.
    const seen = new Map();
    const reached = [];
    for (const state of STATES) {
      let ok = true;
      try {
        await state.enter(page);
      } catch (err) {
        ok = false;
        console.error(`  [${label}] state ${state.name} unreachable: `
          + String(err).split('\n')[0]);
      }
      reached.push(state.name + (ok ? '' : ':unavailable'));

      const results = await new AxeBuilder({ page }).analyze();
      for (const v of results.violations) {
        const rec = seen.get(v.id) || { v, states: [] };
        // Keep the pass with the most nodes: the fuller failure is more useful.
        if (v.nodes.length > rec.v.nodes.length) rec.v = v;
        rec.states.push(state.name);
        seen.set(v.id, rec);
      }

      try {
        await state.exit(page);
      } catch (err) {
        console.error(`  [${label}] state ${state.name} would not exit: `
          + String(err).split('\n')[0]);
      }
    }

    const found = [...seen.values()];
    const bad = found.filter((r) => r.v.impact === 'serious' || r.v.impact === 'critical');
    const meh = found.filter((r) => r.v.impact !== 'serious' && r.v.impact !== 'critical');

    if (bad.length) {
      failed = true;
      console.error(`\n[${label}] ${bad.length} SERIOUS/CRITICAL violation(s):`);
      for (const { v, states } of bad) {
        console.error(`  ${v.id} (${v.impact}) [states: ${states.join(', ')}]: ${v.help}`);
        console.error(`    ${v.helpUrl}`);
        for (const n of v.nodes.slice(0, 5)) {
          console.error(`    → ${n.target.join(' ')}`);
          if (n.failureSummary) console.error(`      ${n.failureSummary.split('\n').join(' ')}`);
        }
        if (v.nodes.length > 5) console.error(`    → …and ${v.nodes.length - 5} more node(s)`);
      }
    } else {
      console.log(`\n[${label}] OK — 0 serious/critical`);
    }
    for (const { v, states } of meh) {
      console.log(`  advisory ${v.id} (${v.impact}) [states: ${states.join(', ')}]: `
        + `${v.help} [${v.nodes.length} node(s)]`);
      for (const n of v.nodes.slice(0, 3)) console.log(`    → ${n.target.join(' ')}`);
    }
    if (consoleErrors.length) {
      // Not the gate here — tools/verify.mjs is where console-clean IS a gate —
      // but a console error during an axe run is worth reading in the log.
      console.log(`  console: ${consoleErrors.length} error(s) — ${consoleErrors[0]}`);
    }

    rows.push({
      label, serious: bad.length, advisories: meh.length,
      ready, states: reached.join('+'), consoleErrors: consoleErrors.length,
    });
    await context.close();
  }
}

await browser.close();
server.close();

console.log('\n  theme · viewport                serious/critical  advisories  ngpReady  console');
for (const r of rows) {
  console.log(`  ${r.label.padEnd(30)}${String(r.serious).padStart(10)}`
    + `${String(r.advisories).padStart(14)}  ${String(r.ready).padEnd(8)}  ${r.consoleErrors}`);
}
console.log('\n  states audited (per combo):');
for (const r of rows) console.log(`  ${r.label.padEnd(30)}  ${r.states}`);
console.log(rows.every((r) => r.ready)
  ? '  ngpReady in every combo: the payload joined and the choropleth painted.'
  : '  ngpReady MISSING in at least one combo — see above. This is a failure, not '
    + 'a degradation: four of the six states are unreachable without it.');

process.exit(failed ? 1 : 0);
