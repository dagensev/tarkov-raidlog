/**
 * Fitting, zooming and panning the raid map.
 *
 * Split out of the component because the vitest run is `environment: node` over
 * `src/**` `/*.test.ts` — a component cannot be tested here at all, and this arithmetic is
 * where the bugs are. It is also why there is no map library: tarkov.dev drives its viewer
 * with Leaflet, but Leaflet is built around tile pyramids, and `project.ts` already
 * establishes that anything positioned *relative to the picture* needs no CRS.
 *
 * The idea that makes the rest simple: **scale 1 is the fitted view, not the drawing's
 * natural size.** The stage is sized by `fitBox` to the largest box of the picture's
 * aspect that fits the open area, so fitted is the identity transform, "Fit" is `FITTED`,
 * and the SVG's own units never reach the component.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * `translate(x, y) scale(scale)` about the stage's centre, in CSS pixels.
 *
 * The stage is centred in the open area by flexbox, so both `x` and `y` are measured from
 * the area's centre — the same frame a cursor position is converted into.
 */
export interface View {
  scale: number;
  x: number;
  y: number;
}

/** Zooming out past the whole map is deliberately impossible; there is nothing out there. */
export const MIN_SCALE = 1;
export const MAX_SCALE = 8;

export const FITTED: View = { scale: MIN_SCALE, x: 0, y: 0 };

/** The largest box of `aspect` that fits `within`. Zero for an area not yet measured. */
export function fitBox(aspect: number, within: Size): Size {
  if (!(aspect > 0) || within.width <= 0 || within.height <= 0) {
    return { width: 0, height: 0 };
  }
  const width = Math.min(within.width, within.height * aspect);
  return { width, height: width / aspect };
}

/**
 * Scale into range, and translation into the picture's overflow.
 *
 * Because `box` is the *fitted* box it never exceeds `within`, so at scale 1 both limits
 * are zero and there is nothing to pan. Past that the picture's edges can never be dragged
 * inside the open area.
 */
export function clampView(view: View, box: Size, within: Size): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
  const limitX = Math.max(0, (box.width * scale - within.width) / 2);
  const limitY = Math.max(0, (box.height * scale - within.height) / 2);
  return {
    scale,
    x: Math.min(limitX, Math.max(-limitX, view.x)),
    y: Math.min(limitY, Math.max(-limitY, view.y)),
  };
}

/**
 * Zoom by `factor` about `at`, holding the picture point under that cursor still.
 *
 * A cursor at `c` sits over picture point `p = (c − t) / k`. Keeping it there at `k′`
 * rearranges to `t′ = c − (c − t)·(k′/k)`. The ratio uses the *clamped* `k′`, so hitting
 * `MAX_SCALE` stops the translation moving too, rather than sliding the map sideways
 * against a scale that did not change.
 *
 * Clamping can override the invariant near an edge. That is correct: showing the ground
 * beyond the map's border to honour a cursor position would be the worse answer.
 */
export function zoomAt(
  view: View,
  factor: number,
  at: Point,
  box: Size,
  within: Size,
): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const ratio = scale / view.scale;
  return clampView(
    { scale, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio },
    box,
    within,
  );
}

/** Firefox's own value for `DOM_DELTA_LINE`: a "line" of wheel scroll is sixteen CSS pixels. */
const PIXELS_PER_LINE = 16;

/**
 * `DOM_DELTA_PAGE` has no reported page height to convert with, so this stands in for one —
 * chosen as a typical viewport height rather than the 1-3px it would be worth read as a raw
 * pixel count, which used to make a page of scroll barely zoom at all.
 */
const PIXELS_PER_PAGE = 800;

/**
 * Convert a wheel event's delta into a zoom factor, in CSS pixels regardless of which of the
 * three `deltaMode` values the browser reported: pixels (0), lines (1), or pages (2).
 *
 * Exponential so that zooming in and back out by the same scroll distance returns you to
 * where you started: `wheelFactor(d, m) * wheelFactor(-d, m) === 1` exactly, because
 * `exp(a) * exp(-a) = 1`.
 */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const pixels =
    deltaMode === 1 ? deltaY * PIXELS_PER_LINE : deltaMode === 2 ? deltaY * PIXELS_PER_PAGE : deltaY;
  return Math.exp(-pixels * 0.0015);
}
