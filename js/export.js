/* ============================================================================
   FSA Normal Grazing Periods · js/export.js
   The branded PNG export, and the `?export=` convention that makes it
   headless-scriptable.

   ES module, no build step. The heavy lifting is the kit's ui/export.js — an
   off-screen MapLibre map captured at poster resolution, then the house chrome
   composed around it on a canvas. What lives here is the app's half: which
   colors to paint, what the poster says, and how to draw this app's two
   legends with canvas primitives.

   ── The legend is drawn TWICE, on purpose ──────────────────────────────────
   Once in the DOM (js/legend-wheel.js, the kit's colorbar) and once here in
   canvas calls. Rasterising the live SVG would be shorter and is a trap: a
   foreignObject/SVG round trip taints the canvas in Safari and silently drops
   web fonts everywhere else, and `toBlob()` on a tainted canvas throws
   SecurityError — at which point the export fails for exactly the users who
   cannot be asked to screenshot instead. The wheel's ANGLE MATH is imported
   from js/legend-wheel.js rather than re-derived, so the two pictures cannot
   drift apart; only the drawing calls differ.

   ── `?export=light` / `?export=high-contrast` ──────────────────────────────
   A URL param that forces a theme, waits for the fonts, runs the export, and
   stamps `documentElement.dataset.ngpExported = '1'` when the download has
   been triggered. A screenshot job can therefore load one URL, wait for that
   attribute, and collect the file — no browser automation of the button, no
   sleep-and-hope (HOUSE-STYLE §4). The forced theme is NOT persisted: an
   export job must not rewrite the visitor's own preference.
   ========================================================================== */

import { getTheme, setTheme, urlParams } from 'https://sustainable-fsa.com/style/v0.1.0/core/core.js';
import { captureCompositeMap, composeBranded } from 'https://sustainable-fsa.com/style/v0.1.0/ui/export.js';
import { addCountyLayers } from 'https://sustainable-fsa.com/style/v0.1.0/county/county.js';
import { resolveToken } from 'https://sustainable-fsa.com/style/v0.1.0/map/map.js';

import { getYearType, typeSlug } from './data.js';
import { NO_DATA, VARIABLES, ramps } from './color.js';
import {
  MONTH_LABELS, MONTH_STARTS, WHEEL_DAYS, monthMidAngle, wheelAngle, wheelPoint,
} from './legend-wheel.js';

/* ── Constants ───────────────────────────────────────────────────────────── */

/** The themes `?export=` will accept. Same whitelist as the kit's THEMES; a
    typo must fall through to "do nothing", never to a default export. */
const EXPORT_THEMES = Object.freeze(['light', 'high-contrast']);

const CREDIT = 'Sustainable FSA · USDA FSA data via FOIA · DOI 10.5281/zenodo.15252842 '
  + '· Montana Climate Office · sustainable-fsa.com/fsa-normal-grazing-period';

const TITLE = 'FSA Normal Grazing Periods';

/* Fonts the legend painters use. The kit preloads exactly 900 34px / 500 22px
   / 400 16px Roboto before its own first fillText; a size it does not name is
   the same face and the same file, but the contract says load what you draw
   with, so these are loaded before composeBranded is called. */
const FONT_BODY = '400 16px Roboto';
const FONT_WHEEL = '400 11px Roboto';

/* Legend band geometry, in composeBranded's logical units. The band handed to
   drawLegend is 1504 × 96 at the default capture size. */
const WHEEL_R_OUTER = 29;
const WHEEL_R_INNER = 17;
const WHEEL_R_LABEL = 41;
const CHIP = 22;                 // the "no data" swatch, square

const BAR_W = 420;
const BAR_H = 22;

/** The app context, captured at init — features never import app.js back. */
let appCtx = null;

/* ── Filename ────────────────────────────────────────────────────────────── */

/**
 * The download name. Sortable, greppable, and unambiguous about which of the
 * sixteen pasture types it holds.
 *
 * @param {number} year
 * @param {string} type pasture type name
 * @param {string} variable start | end | duration
 * @returns {string}
 */
export function exportFilename(year, type, variable) {
  return 'fsa-ngp_' + year + '_' + typeSlug(type) + '_' + variable + '.png';
}

/* ── Legend painters ─────────────────────────────────────────────────────── */

function tokens() {
  return {
    text: resolveToken('--text-primary', '#1f2937'),
    muted: resolveToken('--text-muted', '#4b5563'),
    border: resolveToken('--ctrl-border', '#6b7280'),
  };
}

/** The "no data" chip, drawn wherever it is asked for. Outlined, because a
    light gray square on a white poster is otherwise not a square at all, and
    always labelled — color is never the only channel (HOUSE-STYLE §6). */
function drawNoDataChip(ctx2d, x, midY, c) {
  ctx2d.fillStyle = NO_DATA();
  ctx2d.fillRect(x, midY - CHIP / 2, CHIP, CHIP);
  ctx2d.strokeStyle = c.border;
  ctx2d.lineWidth = 1;
  ctx2d.strokeRect(x + 0.5, midY - CHIP / 2 + 0.5, CHIP - 1, CHIP - 1);
  ctx2d.font = FONT_BODY;
  ctx2d.textBaseline = 'middle';
  ctx2d.fillStyle = c.text;
  ctx2d.fillText('No reported grazing period', x + CHIP + 12, midY);
}

/** Duration: the same 53 stops the map is painted from, as a bar. */
function drawDurationLegend(ctx2d, rect) {
  const c = tokens();
  const ramp = ramps().duration;
  const barX = rect.x;
  const barY = rect.y + 14;
  const cell = BAR_W / ramp.length;

  for (let i = 0; i < ramp.length; i++) {
    ctx2d.fillStyle = ramp[i];
    // +0.6 so neighbouring cells overlap rather than leaving a seam of surface
    // between them after rounding.
    ctx2d.fillRect(barX + i * cell, barY, cell + 0.6, BAR_H);
  }
  ctx2d.strokeStyle = c.border;
  ctx2d.lineWidth = 1;
  ctx2d.strokeRect(barX + 0.5, barY + 0.5, BAR_W - 1, BAR_H - 1);

  ctx2d.font = FONT_BODY;
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'top';
  ctx2d.fillStyle = c.muted;
  for (const week of [0, 10, 20, 30, 40, 50]) {
    const x = barX + (week + 0.5) * cell;
    ctx2d.fillStyle = c.border;
    ctx2d.fillRect(x - 0.5, barY + BAR_H, 1, 5);
    ctx2d.fillStyle = c.muted;
    ctx2d.fillText(week + ' wk', x, barY + BAR_H + 9);
  }
  ctx2d.textAlign = 'left';

  drawNoDataChip(ctx2d, barX + BAR_W + 64, barY + BAR_H / 2, c);
}

/** Start / end: the month wheel, in canvas arcs, from the same angle math the
    DOM wheel uses. */
function drawWheelLegend(ctx2d, rect, variable) {
  const c = tokens();
  const ramp = ramps().cyclic;
  const cx = rect.x + WHEEL_R_LABEL + 8;
  const cy = rect.y + rect.height / 2;
  // A whisker of overlap on each wedge; without it the anti-aliased edges leave
  // 366 hairlines of background showing through the ring.
  const overlap = (Math.PI * 2 / WHEEL_DAYS) * 0.12;

  for (let i = 0; i < ramp.length; i++) {
    const a0 = wheelAngle(i);
    const a1 = wheelAngle(i + 1) + overlap;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, WHEEL_R_OUTER, a0, a1);
    ctx2d.arc(cx, cy, WHEEL_R_INNER, a1, a0, true);
    ctx2d.closePath();
    ctx2d.fillStyle = ramp[i];
    ctx2d.fill();
  }

  // Month separators, in the poster's own ground color so they read as gaps.
  ctx2d.strokeStyle = resolveToken('--bg-surface', '#ffffff');
  ctx2d.lineWidth = 1;
  for (const start of MONTH_STARTS) {
    const a = wheelAngle(start);
    const p0 = wheelPoint(cx, cy, WHEEL_R_INNER, a);
    const p1 = wheelPoint(cx, cy, WHEEL_R_OUTER, a);
    ctx2d.beginPath();
    ctx2d.moveTo(p0.x, p0.y);
    ctx2d.lineTo(p1.x, p1.y);
    ctx2d.stroke();
  }

  ctx2d.font = FONT_WHEEL;
  ctx2d.fillStyle = c.muted;
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';
  for (let m = 0; m < 12; m++) {
    const p = wheelPoint(cx, cy, WHEEL_R_LABEL, monthMidAngle(m));
    ctx2d.fillText(MONTH_LABELS[m], p.x, p.y);
  }
  ctx2d.textAlign = 'left';

  const which = variable === 'start' ? 'begins' : 'ends';
  const lines = [
    'Color is the point in the calendar where the grazing period ' + which
      + ', read against the months around the wheel.',
    'The scale wraps, so late December and early January are neighboring colors.',
  ];
  const textX = cx + WHEEL_R_LABEL + 28;
  ctx2d.font = FONT_BODY;
  ctx2d.fillStyle = c.text;
  ctx2d.textBaseline = 'middle';
  ctx2d.fillText(lines[0], textX, cy - 12);
  ctx2d.fillStyle = c.muted;
  ctx2d.fillText(lines[1], textX, cy + 12);

  const widest = Math.max(...lines.map((s) => ctx2d.measureText(s).width));
  drawNoDataChip(ctx2d, textX + widest + 48, cy, c);
}

/**
 * The drawLegend callback for the active variable.
 * @param {string} variable
 * @returns {(ctx2d: CanvasRenderingContext2D, rect: object) => void}
 */
function legendPainter(variable) {
  return (ctx2d, rect) => {
    if (VARIABLES[variable] && VARIABLES[variable].cyclic) {
      drawWheelLegend(ctx2d, rect, variable);
    } else {
      drawDurationLegend(ctx2d, rect);
    }
  };
}

/* ── The export ──────────────────────────────────────────────────────────── */

/** The same Map<id, color> app.js paints the live map with, rebuilt here so the
    off-screen map is colored from the data rather than from the GL state of a
    map that is about to be thrown away. */
function colorsFor(state) {
  const spec = VARIABLES[state.variable];
  const colors = new Map();
  for (const [id, rec] of getYearType(state.year, state.type)) {
    colors.set(id, spec.scale(rec[spec.field]));
  }
  return colors;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Late enough that the browser has certainly started reading the blob, and
  // early enough that a poster-sized PNG is not held for the session.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Capture, compose, and download the current view as a branded PNG.
 *
 * @param {object} [ctx] app.js's ngpContext(); defaults to the one initExport
 *        was given.
 * @returns {Promise<string>} the filename written
 */
export async function runExport(ctx = appCtx) {
  if (!ctx) throw new Error('[ngp/export] runExport() before initExport().');

  const state = ctx.getState();
  const counties = ctx.getCounties();
  if (!counties) throw new Error('[ngp/export] the county boundaries are not loaded.');

  const spec = VARIABLES[state.variable];
  const colors = colorsFor(state);
  const filename = exportFilename(state.year, state.type, state.variable);

  // Load every face the legend painters draw with BEFORE composeBranded: a
  // canvas does not wait for a font the way the DOM does, and a missed load is
  // silent — the glyphs are simply the system sans, forever.
  if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
    await Promise.all([FONT_BODY, FONT_WHEEL].map((f) => document.fonts.load(f).catch(() => {})));
  }

  const { canvas, dispose } = await captureCompositeMap({
    bounds: ctx.getBounds(),
    build: async (offscreen) => {
      // The off-screen map is a throwaway with its own sources and layers:
      // rebuild the composite on it, then let the rAF-coalesced recolor land
      // before the capture waits for idle.
      const offHandle = addCountyLayers(offscreen, counties);
      offHandle.recolor(colors);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
  });

  try {
    const blob = await composeBranded(canvas, {
      title: TITLE,
      subtitle: state.type + ' · ' + state.year + ' · ' + spec.label,
      credit: CREDIT,
      drawLegend: legendPainter(state.variable),
      theme: getTheme(),
    });
    download(blob, filename);
  } finally {
    dispose();
  }

  return filename;
}

/* ── Wiring ──────────────────────────────────────────────────────────────── */

/**
 * Wire the Export button, and honour `?export=` if it is present.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.button #btn-export
 * @param {object} opts.ctx         app.js's ngpContext()
 * @param {URLSearchParams} [opts.params] defaults to the live query string
 * @returns {{run: () => Promise<string>}}
 */
export function initExport({ button, ctx, params = urlParams() } = {}) {
  if (!ctx) {
    console.warn('[ngp/export] no context — PNG export is off.');
    return { run: () => Promise.reject(new Error('no context')) };
  }
  appCtx = ctx;

  async function run() {
    if (button) button.disabled = true;
    ctx.note('Building the PNG export…');
    try {
      const filename = await runExport(ctx);
      ctx.clearNote();
      ctx.toast('Export written: ' + filename);
      ctx.announce('Branded PNG export downloaded.');
      return filename;
    } catch (err) {
      console.error('[ngp/export] export failed', err);
      ctx.clearNote();
      ctx.toast('The PNG export failed. ' + (err && err.message ? err.message : ''), 5000);
      throw err;
    } finally {
      if (button) button.disabled = false;
    }
  }

  if (button) button.addEventListener('click', () => { run().catch(() => {}); });

  const mode = params.get('export');
  if (mode == null) return { run };

  if (!EXPORT_THEMES.includes(mode)) {
    console.warn('[ngp] ignoring ?export=' + JSON.stringify(mode)
      + ' — expected one of ' + EXPORT_THEMES.join(', ') + '.');
    return { run };
  }

  // The headless path. initExport() is called from the seam at the END of the
  // boot sequence, after documentElement.dataset.ngpReady is stamped, so the
  // map is drawn and the data is joined by the time this runs.
  (async () => {
    // persist:false — a screenshot job must not rewrite the visitor's theme.
    setTheme(mode, { persist: false });
    // GL paints do not follow a data-theme swap; the on-screen map has to be
    // repainted too, or a job that ALSO screenshots the page gets a
    // high-contrast poster over a light-theme map.
    const handle = ctx.getHandle();
    if (handle) handle.applyThemePaints();

    try {
      if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready;
      await run();
      // The completion signal the screenshot job waits on.
      document.documentElement.dataset.ngpExported = '1';
    } catch {
      // Stamp the failure too — run() has already logged and toasted it. A job
      // that only ever waits for success hangs until its own timeout on a
      // broken build, which reads as "slow" when it means "broken".
      document.documentElement.dataset.ngpExportError = '1';
    }
  })();

  return { run };
}
