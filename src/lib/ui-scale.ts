/**
 * The gap between the two pixel frames `zoom` on the root element creates.
 *
 * `globals.css` zooms `html`, so the page is *laid out* at one size and *drawn* a quarter
 * larger. CSS lengths, inline `style` widths and `offsetHeight` are all in the laid-out
 * frame; `getBoundingClientRect()`, `clientX/Y` and `window.innerHeight` come back in the
 * drawn one. Mixing the two is silent — the numbers still look like pixels — and shows up
 * as geometry that is off by exactly a quarter, so every read of a drawn-frame value that
 * ends up back in a CSS length divides by this.
 *
 * Read from the stylesheet rather than written down twice, so the scale has one home. The
 * result is cached because callers are scroll and pointer handlers, and `getComputedStyle`
 * forces a style recalculation on every call.
 */
let cached: number | null = null;

export function uiScale(): number {
  if (cached !== null) return cached;
  // `zoom` computes to a unitless number, but a browser that does not support the property
  // at all drops the declaration and leaves nothing useful behind: fall back to 1, which
  // is also the honest answer there, since an unsupported `zoom` scales nothing.
  const value = Number.parseFloat(getComputedStyle(document.documentElement).zoom);
  cached = Number.isFinite(value) && value > 0 ? value : 1;
  return cached;
}

/** Reset the cache. Tests only — the scale does not change while the app is running. */
export function resetUiScale(): void {
  cached = null;
}
