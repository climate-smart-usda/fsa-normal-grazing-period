/* ============================================================================
   FSA Normal Grazing Periods · js/color.js
   The data palettes: one cyclic ramp for dates, one sequential ramp for
   duration, and the "no data" fill.

   ES module, no build step. Imports the kit's token resolver only.

   ── Why two ramps ──────────────────────────────────────────────────────────
   Season START and season END are days of the year — a genuinely CYCLIC
   quantity. A season beginning December 28 is three days from one beginning
   January 3, and a linear ramp would paint them at opposite ends of the scale.
   `assets/colors.json` is Crameri **romaO** sampled at 366 stops (HOUSE-STYLE
   §6 approves romaO for day-of-year), and it is rendered as a MONTH WHEEL, not
   a bar: the wheel is what tells the reader the ends meet.

   DURATION is not cyclic, so it gets a lightness-monotonic sequential ramp —
   Crameri **batlow** at 53 stops, one per whole week from 0 to 52. It survives
   grayscale and every CVD type, which a hue-only ramp does not.

   ── Two things that are deliberately NOT done here ─────────────────────────
   1. THE CYCLIC RAMP IS NOT ROTATED. `assets/colors.json` ships with its seam
      already placed at July 1 — index 0 is January 1, index 181 is July 1, and
      the discontinuity sits mid-summer where almost no grazing period begins
      or ends. Rotating it here (a "fix" that looks obvious from the array
      alone) would move the seam onto the busiest part of the calendar and
      break every legend that reads the same file. Index = yday − 1. Full stop.
   2. RAMPS ARE NOT THEMED. These are data colors, not chrome: they are the
      same in the light and high-contrast themes, exactly as shipped. The one
      color here that IS a token is the no-data fill — see NO_DATA().
   ========================================================================== */

import { fetchJSON } from 'https://sustainable-fsa.com/style/v0.1.0/core/core.js';
import { resolveToken } from 'https://sustainable-fsa.com/style/v0.1.0/map/map.js';

/* ── Constants ───────────────────────────────────────────────────────────── */

export const CYCLIC_URL = 'assets/colors.json';
export const DURATION_URL = 'assets/colors-duration.json';

/** Day-of-year domain. 366 so a leap-year December 31 has its own stop. */
const YDAY_MIN = 1;
const YDAY_MAX = 366;

/** Duration domain, in whole weeks. 52 weeks ≈ a year of grazing. */
const WEEK_MIN = 0;
const WEEK_MAX = 52;

/** Last-resort fill for a call made before loadRamps() resolves. Same value as
    the kit's --no-data light-theme token; not a second source of truth. */
const NO_DATA_FALLBACK = '#cccccc';

let cyclicRamp = null;    // 366 hex strings, index = yday − 1
let durationRamp = null;  // 53 hex strings, index = whole weeks

/* ── Boot ────────────────────────────────────────────────────────────────── */

/**
 * Fetch both ramps. Idempotent.
 * @param {{cyclicUrl?: string, durationUrl?: string}} [opts]
 * @returns {Promise<{cyclic: string[], duration: string[]}>}
 */
export async function loadRamps({ cyclicUrl = CYCLIC_URL, durationUrl = DURATION_URL } = {}) {
  if (cyclicRamp && durationRamp) return ramps();

  const [cyclic, duration] = await Promise.all([
    fetchJSON(cyclicUrl),
    fetchJSON(durationUrl),
  ]);

  if (!Array.isArray(cyclic) || cyclic.length !== YDAY_MAX) {
    throw new Error('[ngp/color] ' + cyclicUrl + ': expected ' + YDAY_MAX
      + ' colors, got ' + (Array.isArray(cyclic) ? cyclic.length : typeof cyclic));
  }
  if (!Array.isArray(duration) || duration.length !== WEEK_MAX + 1) {
    throw new Error('[ngp/color] ' + durationUrl + ': expected ' + (WEEK_MAX + 1)
      + ' colors, got ' + (Array.isArray(duration) ? duration.length : typeof duration));
  }

  cyclicRamp = cyclic;
  durationRamp = duration;
  return ramps();
}

/**
 * The loaded ramps, for a legend that has to draw every stop.
 * @returns {{cyclic: string[], duration: string[]}} copies — mutating the
 *          module's arrays would repaint the map from under the legend.
 */
export function ramps() {
  return {
    cyclic: cyclicRamp ? cyclicRamp.slice() : [],
    duration: durationRamp ? durationRamp.slice() : [],
  };
}

/* ── Scales ──────────────────────────────────────────────────────────────── */

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * Day of year → cyclic color.
 * @param {number} yday 1–366 (clamped; a non-finite value returns the no-data
 *        fill rather than a wrong-but-plausible color)
 * @returns {string} CSS color
 */
export function cyclicColor(yday) {
  if (!cyclicRamp || !Number.isFinite(yday)) return NO_DATA();
  // index = yday − 1. The seam is already where it belongs; do not rotate.
  return cyclicRamp[clamp(Math.round(yday), YDAY_MIN, YDAY_MAX) - 1];
}

/**
 * Whole weeks → sequential color. Dark is short, light is long.
 * @param {number} weeks 0–52 (rounded, then clamped)
 * @returns {string} CSS color
 */
export function durationColor(weeks) {
  if (!durationRamp || !Number.isFinite(weeks)) return NO_DATA();
  return durationRamp[clamp(Math.round(weeks), WEEK_MIN, WEEK_MAX)];
}

/**
 * The "no data" fill, resolved from the kit's --no-data token AT CALL TIME.
 *
 * A function, not a constant, on purpose: the high-contrast theme lightens the
 * token, and a value captured at module load would leave every legend chip and
 * every export painted in the palette the page happened to boot with. Call it
 * where you need the color; never cache the result across a theme change.
 *
 * @returns {string} CSS color
 */
export function NO_DATA() {
  return resolveToken('--no-data', NO_DATA_FALLBACK);
}

/* ── The variables the map can paint ─────────────────────────────────────── */

/**
 * The three "color by" choices, keyed by the value that appears in `?variable=`
 * and on the segmented buttons' data-variable. `field` names the property to
 * read off a data.js Rec; `scale` turns that number into a color; `label` is
 * the human name used in the legend, the live region, and the export title.
 *
 * @type {Readonly<Record<string, {field: string, scale: (v: number) => string,
 *                                label: string, cyclic: boolean}>>}
 */
export const VARIABLES = Object.freeze({
  start: {
    field: 'start_yday',
    scale: cyclicColor,
    label: 'Season Start',
    cyclic: true,
  },
  end: {
    field: 'end_yday',
    scale: cyclicColor,
    label: 'Season End',
    cyclic: true,
  },
  duration: {
    field: 'duration_weeks',
    scale: durationColor,
    label: 'Grazing Period Duration',
    cyclic: false,
  },
});
