# Raid Map Overlay — Design

**Status:** approved 2026-09-08. Amends the Objective Map design of 2026-09-03. It replaces
that document's "open by default" placement and its decision that *"pan and zoom reuse the
Fit/Zoom and `overflow-auto` pattern already in `Map3d`"*. Everything else in it stands —
projection, calibration, pin selection, trail derivation and floor following are untouched.

## Problem

The map panel is open on every visit to the raid board and is always the width of that
board's column. Fitted into it, Streets is unreadable: pins overlap, and the arrow marking
where you are is about the size of a building.

The `Zoom` control does not fix that. It doubles the picture's width and hands you native
scrollbars — a bigger picture viewed blind, with no way back to the whole map except
toggling, and no change to vertical extent at all. It was written as a deliberate reuse of
`Map3d`'s pattern, which is right for a decorative render and wrong for a map you are
navigating by.

The panel also costs everyone the fetch and the several-thousand-node render whether or not
they look at it, on a page whose real subject is the task list.

[tarkov.dev's viewer](https://tarkov.dev/map/woods-3d) is the shape that works: the map
takes the screen, the whole of it is visible on arrival, the wheel zooms and the cursor
drags.

Separately, pins identify themselves through the `title` attribute, so naming one costs a
one-second wait and arrives in OS chrome that cannot be styled or kept on screen.

## What changes

Three things, together because they share the same markup:

1. The panel collapses to a strip, and nothing is fetched until it is opened.
2. Opening mounts a full-viewport overlay: fitted on arrival, wheel to zoom, drag to pan.
3. Pins identify themselves in a card in the overlay's corner, on hover and on click.

## Verified findings

### The two layers already share a box

`objective-map.tsx` mounts the drawing and the markers as siblings inside one wrapper, and
already carries a comment saying why: the SVG holder's children are replaced wholesale on a
floor switch, so the marker layer cannot live inside it, yet the two must share a box for
`project()`'s 0–1 fractions to line up.

**That wrapper is the transform target.** `translate(x, y) scale(k)` on it moves the
drawing and every marker together, in one composited layer, with no per-marker arithmetic
and no second coordinate system to keep in sync. This is the finding that makes the rest
cheap, and it is why the alternative — zooming by rewriting the SVG's `viewBox` — was
rejected: the markers are HTML, so that approach would need every position recomputed by
hand, for a picture a CSS transform already keeps vector-crisp.

### Every drawing carries a `viewBox`, and a standing test proves it

`live-svg.test.ts` parses `viewBox` out of all ten live SVGs and compares its aspect ratio
against the rotated calibration bounds, so a tarkov.dev redraw fails the build. `prepare()`
strips `width` and `height` but leaves `viewBox` alone.

The picture's aspect ratio is therefore available from the parsed document, already
validated, without introducing a second source of truth.

### Leaflet is still not needed

`project.ts` establishes it: the CRS transform cancels out of anything positioned relative
to the picture, leaving a rotation and a normalisation. Fitting and zooming that picture is
`Math.min` of two ratios plus a translation.

Leaflet is built around tile pyramids and would mean re-architecting projection the repo
deliberately does without. `react-zoom-pan-pinch` is ~15 KB and would work, but it buys
sixty lines of arithmetic that wants a test either way. The project has no UI dependency
and should not acquire its first one here.

### React will not let a wheel handler stop the page

React 17 and later register `wheel` on the root container as a **passive** listener, so
`preventDefault()` inside an `onWheel` prop does nothing and the page scrolls underneath.
The stage registers its own listener with `{ passive: false }` in an effect.

## Architecture

### New module

`lib/maps/viewport.ts` — the arithmetic, pure and tested, beside the projection it serves.

```ts
export interface Size  { width: number; height: number }
export interface Point { x: number; y: number }
export interface View  { scale: number; x: number; y: number }

export const FITTED: View;  // { scale: 1, x: 0, y: 0 }

/** Largest box of `aspect` that fits `within`. */
export function fitBox(aspect: number, within: Size): Size;

/** Zoom about `at`, given relative to the centre of `within`. Clamped. */
export function zoomAt(view: View, factor: number, at: Point, box: Size, within: Size): View;

/** Translation clamped to the picture's overflow; scale clamped to 1–8. */
export function clampView(view: View, box: Size, within: Size): View;
```

**`scale: 1` is the fitted view, not the drawing's natural size.** `fitBox` returns the
largest box of the picture's aspect that fits the open area, and the stage wrapper is given
those pixel dimensions. Centring is then plain flexbox, the fitted state is the identity
transform, and `Fit` is `setView(FITTED)`. Absolute SVG units never enter the component.

`zoomAt` holds the point under the cursor still. With the picture at `translate(t) scale(k)`
about its centre, a cursor at `c` sits over picture point `p = (c − t) / k`; keeping it
there after zooming to `k′` gives `t′ = c − (c − t)·(k′/k)`. Two lines, and the invariant
the tests assert.

`clampView` allows translation only within the overflow: `limit = max(0, (box·k − within)/2)`
per axis. Because `box` is the *fitted* box, it never exceeds `within`, so at `scale: 1`
both limits are zero and there is nothing to pan. Past that, the picture's edges can never
be dragged inside the open area.

### New component

`components/map-overlay.tsx` — the full-viewport layer: header, stage, pointer and wheel
handling, the pin card, attribution. It is roughly the body of today's `ObjectiveMap` plus
the interaction. The split exists because the alternative is one file doing four jobs.

### Changes to existing code

- `objective-map.tsx` — becomes the collapsed strip plus the state that must outlive the
  overlay: fetched text, failure, floor selection, open. The fetch effect gains `open` as a
  gate, so nothing is requested until the first open and nothing is refetched on close.
  `prepare` returns `{ svg, aspect }`. The `zoomed` state and the `Zoom`/`Fit` toggle are
  deleted.
- `raid/page.tsx` — unchanged: same props, same key, same position above the keys.
- `map-3d.tsx` — unchanged. It keeps its own Fit/Zoom, which suits a decorative render.

No store, settings or persistence changes.

## Behaviour

**Closed.** A header strip carrying a disclosure arrow, "Map", and the pin count — mirroring
`Map3d`'s strip immediately below it, so the two read as a pair. The whole title is the
control; the count beside it is a label, not a button, so the strip has exactly one thing
you can do to it.

**Open.** `fixed inset-0`, `role="dialog"`, `aria-modal="true"`, rendered in place rather
than through a portal: nothing in the page establishes a stacking context that would trap
it, and a portal would need SSR guards for no gain. Body scroll is locked while it is up.
Escape closes, as does the close control, and focus moves to that control on open.

The header carries the map name, the floor switcher, the pins toggle with its count, `Fit`,
and close. The floor switcher and the pins toggle move here out of the strip: they are
controls for a map you are looking at, and the strip is for a map you are not. Attribution
and the "not live tracking" line stay, at the foot.

**Fit.** On open and on `Fit`, the whole drawing is visible and centred, letterboxed against
the overlay's ground. A window resize re-measures the open area and recomputes the wrapper's
pixel size; because the transform is expressed relative to that box, resizing does not
disturb an existing zoom.

**Zoom.** The wheel zooms toward the cursor, clamped to 1–8. Double-click zooms one step
(×2) toward the cursor.

**Pan.** Pointer events with capture. A drag begun anywhere on the stage pans, including one
begun on a pin: a pin acts only if the pointer moved less than 4 px between down and up. At
`scale: 1` there is nothing to pan, and the grab cursor is not shown.

**Markers counter-scale by `1/k`,** so a pin is the same size on screen at ×8 as at ×1.
Without it the position arrow becomes a lozenge covering half a building. Zone polygons are
drawn in the stretched `viewBox="0 0 100 100"` layer and scale with the picture, which is
correct — they are ground area, not symbols.

**The card.** One card, bottom-left of the stage, fed by two pieces of state: a hovered pin
and a clicked pin. Whichever is more immediate wins, hover over click; leaving a pin falls
back to the clicked one, or to nothing.

- It appears on `pointerenter` with **no delay**, in the panel's own border and stencil
  type.
- Focus counts as hover. The pins are already real `<button>`s, so tabbing to one shows its
  card, which is what makes the map keyboard-reachable at all.
- `Go to task →` appears only when the card is showing a *clicked* pin. It closes the
  overlay and scrolls that task row into view — the behaviour pins have today, kept but made
  reachable, since a hover card vanishes the moment you move toward it.
- Hover updates are suppressed while a drag is in progress, or sweeping the map to pan
  strobes the card through every pin crossed.
- **The `title` attribute is removed from the pins.** Left in place, the OS bubble still
  fades in a second later and sits on top of the card. This is part of the change, not a
  side effect of it.

The dot remains the only interactive element per pin; zone polygons stay decoration, as
before.

## Failure modes

| Case | Behaviour |
| --- | --- |
| Map has no calibration, or the SVG fails to load | Strip hides itself entirely, as the panel does today |
| Opened before the fetch resolves | Overlay opens with `loading` in the stage; the header and close control are live throughout |
| Fetch fails after opening | Overlay closes itself and the strip disappears, matching the `failed` path that exists today |
| `viewBox` missing or unparseable | Treated as a parse failure by `prepare`, which already returns `null` for a document it cannot use |
| Open area measures 0×0 on first paint | `fitBox` returns a zero box and the stage draws nothing until the observer fires; no division by zero |
| Window resized while zoomed | Box re-measured, view re-clamped, zoom preserved |
| Map switched while open | The component is keyed on the map id, so it remounts closed |
| Browser with no File System Access | Unchanged: map, pins and zoom all work, there is simply no trail to draw |

## Testing

- `lib/maps/__tests__/viewport.test.ts` — the new module:
  - `fitBox` for a wide picture in a tall area and the reverse; the fitted box always has
    the picture's aspect and touches exactly one pair of edges.
  - `zoomAt` cursor invariant: the picture point under the cursor is unmoved, asserted
    across several scales, cursor offsets and both zoom directions. This is the property the
    feature lives or dies on.
  - `clampView`: no translation survives at `scale: 1`; a picture larger than the area
    cannot have an edge dragged inside it; scale clamps at 1 and at 8.
- `lib/maps/__tests__/live-svg.test.ts` — unchanged, and now load-bearing for a second
  reason: it is what guarantees there is a `viewBox` to read an aspect from.
- **No component test.** The vitest run is `environment: node` over `src/**/*.test.ts`;
  adding jsdom and a DOM testing library to cover one component would be a larger change
  than the feature. The arithmetic is where the bugs are, and all of it is in the tested
  module.

## Known constraints

- **Pinch-to-zoom is not implemented.** Single-finger drag pans, because pointer events
  give that for free; two-finger pinch needs its own gesture tracking. The position feature
  requires File System Access — Chromium desktop — so this map's audience is on a mouse.
- The drawing is still mounted unsanitised. A composited transform changes nothing about
  that: trust rests, as it did before, on `svgPath` being a pinned `assets.tarkov.dev` URL.
- Zoom, pan and open state are not remembered. Closing the overlay, switching maps or
  reloading returns you to a closed map at the fitted view.
- You cannot zoom out past the whole map. That is deliberate; there is nothing out there.

## Out of scope

Touch gestures beyond single-finger drag; persisting zoom, pan or open state; deep-linking
to a map view; measuring, drawing or dropping markers; a minimap; pin clustering (density
peaks near 30 on a held-task list, against a theoretical maximum of 261); and the three
tile-based maps, which still have no drawing to show.
