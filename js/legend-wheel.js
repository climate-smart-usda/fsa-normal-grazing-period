/* ============================================================================
   FSA Normal Grazing Periods · js/legend-wheel.js
   The cyclic month-wheel legend, and the wheel geometry the PNG export reuses.

   ES module, no build step. Imports nothing — not the kit, not data.js — so it
   is trivially testable under node and can never be the reason a legend fails
   to draw.

   ── Why a wheel and not a bar ──────────────────────────────────────────────
   Season start and season end are days of the year: a CYCLIC quantity, painted
   with a cyclic ramp (js/color.js). A bar legend would put December 28 and
   January 3 at opposite ends of the scale and quietly teach the reader that
   they are opposites. A ring says what is true — the ends meet.

   ── The one number everything here turns on ────────────────────────────────
   The ramp in assets/colors.json is romaO with its seam ALREADY PLACED at
   July 1, and js/color.js indexes it as `yday − 1`. So the wheel is a fixed
   366-slot calendar (a leap year, so December 31 always has its own slot) and
   slot 182 — the 183rd day, July 1 in a leap year — is where the ramp's two
   ends meet. That slot goes at 12 o'clock and the year runs CLOCKWISE from
   there, which puts the seam at the top of the wheel, in the dead of the
   grazing summer, where almost no period starts or ends.

   Slot k is filled with ramp[k] and positioned at leap-year day k+1. For a
   NON-leap date past February the wheel is therefore one slot (0.98°) off its
   true calendar position — an unavoidable consequence of one fixed wheel for a
   366-entry ramp, and a rounding error no reader can see.

   ── What this module does NOT own ──────────────────────────────────────────
   Visibility. app.js hides #legend-wheel for the duration variable and shows
   it for start/end (syncLegend), and writes the plain-language meaning into
   #legend-key — the wheel itself is aria-hidden decoration, because a ring of
   366 colored wedges has nothing to say to a screen reader that the key does
   not say better.
   ========================================================================== */

/* ── Wheel geometry (shared with js/export.js) ───────────────────────────── */

/** Slots on the wheel. One per entry in the cyclic ramp. */
export const WHEEL_DAYS = 366;

/** 0-based slot of July 1 — the ramp's seam, drawn at 12 o'clock. */
export const JUL1_INDEX = 182;

/** 0-based slot of each month's first day, on the 366-day (leap) calendar.
    MONTH_STARTS[6] === JUL1_INDEX is the invariant that ties the label ring to
    the color ring; the self-test asserts it. */
export const MONTH_STARTS = Object.freeze([
  0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335,
]);

export const MONTH_LABELS = Object.freeze([
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]);

/** Radians per slot. */
const STEP = (Math.PI * 2) / WHEEL_DAYS;

/**
 * Angle of the LEADING edge of slot `index`, in radians, in the convention
 * canvas and SVG share: 0 points right (3 o'clock) and the angle grows
 * clockwise on screen because y points down. −π/2 is 12 o'clock.
 *
 * wheelAngle(JUL1_INDEX) is exactly −π/2 — that is the whole design.
 *
 * @param {number} index 0-based slot; values outside 0…365 are fine (the
 *        caller draws slot i from wheelAngle(i) to wheelAngle(i + 1)).
 * @returns {number} radians
 */
export function wheelAngle(index) {
  return (index - JUL1_INDEX) * STEP - Math.PI / 2;
}

/**
 * Angle at the middle of month `m` (0 = January), for placing its label.
 * December wraps to the following January using WHEEL_DAYS, not MONTH_STARTS[0].
 *
 * @param {number} m 0–11
 * @returns {number} radians
 */
export function monthMidAngle(m) {
  const start = MONTH_STARTS[m];
  const next = (m === 11) ? WHEEL_DAYS : MONTH_STARTS[m + 1];
  return wheelAngle((start + next) / 2);
}

/**
 * Cartesian point at (r, angle) around a center. Shared so the SVG wheel and
 * the canvas wheel in js/export.js cannot drift apart.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} angle radians, from wheelAngle()/monthMidAngle()
 * @returns {{x: number, y: number}}
 */
export function wheelPoint(cx, cy, r, angle) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/* ── The DOM wheel ───────────────────────────────────────────────────────── */

const SVG_NS = 'http://www.w3.org/2000/svg';

/* One square viewBox holds the ring AND its month labels. The labels have to
   live inside it — an SVG scaled to the panel width clips at the viewBox edge,
   so a ring at r=100 in a 220 box would have nowhere to put "Apr". The ring
   keeps the intended 0.62 inner/outer proportion at a radius that leaves a
   label gutter. */
const VIEWBOX = 220;
const CENTER = VIEWBOX / 2;
const R_OUTER = 84;
const R_INNER = 52;
const R_LABEL = 96;

/** Slot fills are extended by a whisker of a degree so neighbouring wedges
    overlap instead of leaving a hairline of background between them after
    sub-pixel rasterisation. Half a slot would be visible; 7% is not. */
const SEAM_OVERLAP = STEP * 0.07;

const round = (n) => Math.round(n * 100) / 100;

/** The annular wedge for one slot, as a path `d`. */
function wedgePath(a0, a1) {
  const o0 = wheelPoint(CENTER, CENTER, R_OUTER, a0);
  const o1 = wheelPoint(CENTER, CENTER, R_OUTER, a1);
  const i1 = wheelPoint(CENTER, CENTER, R_INNER, a1);
  const i0 = wheelPoint(CENTER, CENTER, R_INNER, a0);
  // sweep-flag 1 is the direction of increasing angle, i.e. clockwise on
  // screen; the inner arc comes back with sweep-flag 0. Every wedge is ~1°, so
  // large-arc-flag is always 0.
  return 'M' + round(o0.x) + ' ' + round(o0.y)
    + 'A' + R_OUTER + ' ' + R_OUTER + ' 0 0 1 ' + round(o1.x) + ' ' + round(o1.y)
    + 'L' + round(i1.x) + ' ' + round(i1.y)
    + 'A' + R_INNER + ' ' + R_INNER + ' 0 0 0 ' + round(i0.x) + ' ' + round(i0.y)
    + 'Z';
}

/**
 * Build the month wheel into `container`, replacing whatever is there (the
 * loading placeholder index.html ships).
 *
 * @param {object} opts
 * @param {HTMLElement} opts.container   #legend-wheel
 * @param {{cyclic: string[]}|string[]} opts.ramps  js/color.js's ramps(), or
 *        the cyclic array on its own.
 * @returns {{update: (info?: object) => void, element: SVGElement|null}}
 */
export function initLegendWheel({ container, ramps } = {}) {
  if (!container) {
    console.warn('[ngp/wheel] no container — the month wheel was not built.');
    return { update() {}, element: null };
  }

  const cyclic = Array.isArray(ramps) ? ramps : (ramps && ramps.cyclic) || [];
  if (cyclic.length !== WHEEL_DAYS) {
    // Not fatal: #legend-key still carries the meaning in words, and the map is
    // still painted. Leave the placeholder standing rather than drawing a wheel
    // that is missing a season.
    console.warn('[ngp/wheel] expected ' + WHEEL_DAYS + ' cyclic colors, got '
      + cyclic.length + ' — keeping the placeholder.');
    return { update() {}, element: null };
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + VIEWBOX + ' ' + VIEWBOX);
  // Decoration for AT: the accessible meaning of this ramp is #legend-key's
  // sentence, which app.js maintains (HOUSE-STYLE §5.2).
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  // One group for the 366 fills, one for the chrome, so the separators and
  // labels always paint over the ring.
  const ring = document.createElementNS(SVG_NS, 'g');
  for (let i = 0; i < WHEEL_DAYS; i++) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', wedgePath(wheelAngle(i), wheelAngle(i + 1) + SEAM_OVERLAP));
    path.setAttribute('fill', cyclic[i]);
    ring.appendChild(path);
  }
  svg.appendChild(ring);

  // Month separators: a hairline in the panel's own surface color at each
  // month start, so the ring reads as twelve months and not as one smear.
  const marks = document.createElementNS(SVG_NS, 'g');
  marks.setAttribute('stroke', 'var(--bg-surface)');
  marks.setAttribute('stroke-width', '1.2');
  marks.setAttribute('stroke-linecap', 'butt');
  for (const start of MONTH_STARTS) {
    const a = wheelAngle(start);
    const p0 = wheelPoint(CENTER, CENTER, R_INNER, a);
    const p1 = wheelPoint(CENTER, CENTER, R_OUTER, a);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(round(p0.x)));
    line.setAttribute('y1', String(round(p0.y)));
    line.setAttribute('x2', String(round(p1.x)));
    line.setAttribute('y2', String(round(p1.y)));
    marks.appendChild(line);
  }
  svg.appendChild(marks);

  const labels = document.createElementNS(SVG_NS, 'g');
  labels.setAttribute('fill', 'var(--text-dim)');
  labels.setAttribute('font-size', '11.5');
  labels.setAttribute('text-anchor', 'middle');
  // `central`, not `middle`: `middle` is the mathematically wrong baseline and
  // Safari treats the two differently enough to shift a label off its month.
  labels.setAttribute('dominant-baseline', 'central');
  for (let m = 0; m < 12; m++) {
    const p = wheelPoint(CENTER, CENTER, R_LABEL, monthMidAngle(m));
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(round(p.x)));
    text.setAttribute('y', String(round(p.y)));
    text.textContent = MONTH_LABELS[m];
    labels.appendChild(text);
  }
  svg.appendChild(labels);

  container.replaceChildren(svg);

  return {
    /**
     * API symmetry with the kit's colorbar handle, and a real no-op: the wheel
     * is the SAME PICTURE for `start` and for `end` (both read the same cyclic
     * ramp), and data ramps do not theme-swap (js/color.js). app.js decides
     * whether the wheel is shown at all. Nothing here has to be repainted —
     * saying so out loud is cheaper than a rebuild nobody can see.
     */
    update() {},
    element: svg,
  };
}
