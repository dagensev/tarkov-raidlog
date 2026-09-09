"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ScreenshotPosition } from "@/lib/logs/screenshots";
import type { MapCalibration, MapFloor } from "@/lib/maps/calibration";
import type { ObjectivePin } from "@/lib/maps/pins";
import { project } from "@/lib/maps/project";
import {
  FITTED,
  clampView,
  fitBox,
  wheelFactor,
  zoomAt,
  type Point,
  type Size,
  type View,
} from "@/lib/maps/viewport";
import type { GameMap } from "@/lib/tarkovdev/types";
import { cx } from "./ui";

/**
 * The raid map, full screen.
 *
 * Covers the viewport rather than sitting in the raid board's column, because fitted into
 * that column Streets is unreadable — pins overlap and the arrow marking you is about the
 * size of a building. tarkov.dev's own viewer is the same shape and for the same reason.
 *
 * The drawing and the markers are siblings inside one wrapper whose box *is* the picture.
 * That is what makes this cheap: one `transform` on that wrapper moves the SVG and every
 * marker together, with no per-marker arithmetic and no second coordinate system.
 */

interface Prepared {
  svg: SVGSVGElement;
  /** Width over height, from the drawing's own `viewBox`. */
  aspect: number;
}

/**
 * Strip the layers we are not showing, and return the SVG element to mount.
 *
 * The drawing is fetched as text and inlined rather than dropped into an `<img>` because
 * every floor in one of these files is a sibling `<g>`, all equally opaque — the only thing
 * that marks a non-ground floor is a `class="shadow"` drop-shadow, nothing more. An `<img>`
 * would render every storey of Streets stacked on top of one another; inlining is what makes
 * a floor switcher possible at all, since it lets this loop remove the groups we are not
 * showing.
 */
function prepare(
  text: string,
  baseLayer: string,
  activeFloor: MapFloor | null,
): Prepared | null {
  const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = parsed.querySelector("svg");
  if (!svg || parsed.querySelector("parsererror")) return null;

  // `live-svg.test.ts` reads this same attribute out of all ten drawings and fails the
  // build if one loses it, so a miss here means a corrupt response rather than a map that
  // was ever shaped this way. Nothing can be sized without it, so treat it as a parse
  // failure and let the caller hide the map.
  const box = svg.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  if (!box || box.length !== 4 || !box.every(Number.isFinite)) return null;
  const [, , width, height] = box;
  if (width <= 0 || height <= 0) return null;

  const shown = new Set([baseLayer, activeFloor?.svgLayer].filter(Boolean) as string[]);

  // Only top-level groups are floors. Descending further would hit the groups that make up
  // the drawing itself — buildings, roads, trees.
  for (const group of Array.from(svg.children)) {
    const id = group.getAttribute("id");
    const isFloor = id !== null && /(_Level|_Floor|Basement)$/.test(id);
    if (isFloor && !shown.has(id)) group.remove();
  }

  svg.removeAttribute("width");
  svg.removeAttribute("height");
  // The stage below is sized to exactly this aspect ratio, so filling it cannot distort.
  svg.setAttribute("class", "block size-full");
  return { svg: svg as SVGSVGElement, aspect: width / height };
}

/** A cursor in the frame the transform uses: CSS pixels from the open area's centre. */
function pointerAt(event: { clientX: number; clientY: number }, node: HTMLElement): Point {
  const rect = node.getBoundingClientRect();
  return {
    x: event.clientX - (rect.left + rect.width / 2),
    y: event.clientY - (rect.top + rect.height / 2),
  };
}

export function MapOverlay({
  map,
  calibration,
  text,
  floor,
  onFloor,
  pins,
  trail,
  showPins,
  onTogglePins,
  onClose,
}: {
  map: GameMap;
  calibration: MapCalibration;
  /** The drawing, or null while it is still being fetched. */
  text: string | null;
  floor: MapFloor | null;
  onFloor: (floor: MapFloor | null) => void;
  pins: readonly ObjectivePin[];
  /** This raid's screenshots, oldest first. Empty on browsers with no File System Access. */
  trail: readonly ScreenshotPosition[];
  showPins: boolean;
  onTogglePins: () => void;
  onClose: () => void;
}) {
  const prepared = useMemo(() => {
    if (!text) return null;
    return prepare(text, calibration.svgLayer, floor);
  }, [text, calibration, floor]);

  const areaRef = useRef<HTMLDivElement | null>(null);
  const [area, setArea] = useState<Size>({ width: 0, height: 0 });

  // The size is measured when the node attaches, and the observer only keeps it current
  // afterwards. Making the map's existence depend on a callback arriving is a bad trade
  // when measuring directly costs one line. An observer that delivered nothing was in fact
  // observed during development, and the overlay sat on "loading" for ever as a result.
  //
  // A ref callback rather than an effect, on two counts: it runs when the node actually
  // attaches, and setting state here is not the synchronous setState in an effect body
  // that `react-hooks/set-state-in-effect` forbids.
  const attachArea = useCallback((node: HTMLDivElement | null) => {
    areaRef.current = node;
    if (!node) return;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      // ResizeObserver.observe() always delivers one initial callback on top of the measure()
      // call just below, so without this, every open measures the unchanged size twice and
      // re-renders (and swaps both effects' listeners) for nothing.
      setArea((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
      areaRef.current = null;
    };
  }, []);

  const box = useMemo(
    () => (prepared ? fitBox(prepared.aspect, area) : { width: 0, height: 0 }),
    [prepared, area],
  );

  const [raw, setRaw] = useState<View>(FITTED);

  // Clamped at render rather than corrected in an effect, for the same reason `floor` is
  // derived in `objective-map.tsx`: pushing a corrected value back into state from an
  // effect is exactly what `react-hooks/set-state-in-effect` exists to stop. It also makes
  // a window resize free — the limits fall out of the new `area` on the next render, with
  // an existing zoom left alone. Clamping is idempotent, so nothing drifts.
  const view = clampView(raw, box, area);

  // The wheel listener is registered by hand because React attaches `wheel` at the root as
  // a *passive* listener, so `preventDefault()` inside an `onWheel` prop does nothing and
  // the raid board scrolls underneath the map. Re-registers when the box or area changes,
  // which is cheap and beats stashing both in refs.
  useEffect(() => {
    const node = areaRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = wheelFactor(event.deltaY, event.deltaMode);
      const at = pointerAt(event, node);
      setRaw((current) => zoomAt(clampView(current, box, area), factor, at, box, area));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [box, area]);

  /** A drag in flight. `moved` stays false until the pointer clears the slop below. */
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  /**
   * Whether the gesture that just ended was a drag. Two readers: a pin's own click handler
   * uses it to ignore the click a drag release leaves on it, and the stage's click handler
   * uses it to skip clearing the selection when a drag happens to end over the stage rather
   * than a pin.
   */
  const dragged = useRef(false);

  // Deliberately *not* pointer capture. Capturing on the stage would retarget the click
  // that follows to the stage itself, and a pin would never see its own click. Window
  // listeners keep native click dispatch intact and still follow the pointer off-screen.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId) return;
      // Pointer capture is deliberately not held (see above), so a pointerup dropped by a
      // focus change never arrives — treat no button being held as the gesture having ended.
      if (event.buttons === 0) {
        drag.current = null;
        return;
      }
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      // A few pixels of slop, so a click on a pin with a shaky hand is still a click.
      if (!active.moved && Math.hypot(dx, dy) < 4) return;
      active.moved = true;
      active.x = event.clientX;
      active.y = event.clientY;
      setRaw((current) => {
        const from = clampView(current, box, area);
        return clampView({ ...from, x: from.x + dx, y: from.y + dy }, box, area);
      });
    };
    const end = (event: PointerEvent) => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId) return;
      dragged.current = active.moved;
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [box, area]);

  // Two sources, one card. Hover wins while it lasts, so leaving a pin falls back to
  // whatever you clicked, or to nothing. Keyed by `key` rather than holding the pin object,
  // because `objectivePins` rebuilds the array in the parent and identity would not survive
  // it — and because a pin that disappears (pins toggled off, a task completed) then takes
  // its card with it for free.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const visible = showPins ? pins : [];
  const shownKey = hoveredKey ?? selectedKey;
  const shown = visible.find((pin) => pin.key === shownKey) ?? null;

  // A ref callback keyed on `prepared`, not an effect: the holder only enters the tree
  // once the area has been measured, which is a render *after* `prepared` arrives, so an
  // effect keyed on `prepared` alone fires against a null ref and never runs again — the
  // map came up blank on first open until a floor switch happened to produce a new
  // `prepared` at a moment when the holder existed.
  //
  // Keying the callback on `prepared` keeps the property the effect was reaching for: an
  // unrelated re-render (the trail polling at 2 Hz, a pin toggle) leaves the callback's
  // identity alone, so a several-thousand-node SVG is not re-detached and re-attached.
  // It re-runs only for a genuinely different element — a fresh fetch or a floor switch.
  const mountSvg = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && prepared) node.replaceChildren(prepared.svg);
    },
    [prepared],
  );

  // The page behind must not scroll under a layer that covers it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    // Captured here rather than read at cleanup time, because by then the overlay (and
    // whatever it moved focus to) has already unmounted.
    const trigger = document.activeElement;
    closeRef.current?.focus();
    return () => {
      // Guards against the element that opened the map having left the document while the
      // overlay was up (the strip re-rendering, say) — focusing a detached node is a no-op
      // at best and throws in some browsers.
      if (trigger instanceof HTMLElement && document.contains(trigger)) trigger.focus();
    };
  }, []);

  const chip =
    "stencil cursor-pointer border px-2 py-1 text-[10px] transition-colors";
  const chipOff = "border-line-bright text-muted hover:border-amber hover:text-amber";
  const chipOn = "border-amber text-amber";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Map of ${map.name}`}
      // m-0 looks like a no-op, but it is not: this fixed element is rendered as a non-last
      // child of the raid page's `space-y-4` list, which gives every non-last child a
      // margin-bottom Tailwind adds via `:where()` — low enough specificity that this
      // class's plain `.m-0` still beats it. Without it, `bottom: 0` resolves 16px short of
      // the actual viewport bottom and the page behind shows through in a band there.
      className="fixed inset-0 z-50 m-0 flex flex-col bg-ground"
    >
      <header className="shrink-0 border-b border-line bg-panel/70">
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 pt-3 pb-2">
          <h2 className="stencil text-[13px] text-amber glow-amber">{map.name}</h2>
          <div className="flex flex-wrap items-center gap-3">
            {calibration.floors.length > 0 ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onFloor(null)}
                  className={cx(chip, floor === null ? chipOn : chipOff)}
                >
                  Ground
                </button>
                {calibration.floors.map((option) => (
                  <button
                    key={option.svgLayer}
                    type="button"
                    onClick={() => onFloor(option)}
                    className={cx(
                      chip,
                      floor?.svgLayer === option.svgLayer ? chipOn : chipOff,
                    )}
                  >
                    {option.name}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={onTogglePins}
              title={showPins ? "Hide objective pins" : "Show objective pins"}
              className={cx(chip, showPins ? chipOn : chipOff)}
            >
              {pins.length} pins
            </button>
            <button
              type="button"
              onClick={() => setRaw(FITTED)}
              disabled={view.scale === 1}
              title="Fit the whole map on screen"
              className={cx(chip, chipOff, "disabled:cursor-not-allowed disabled:opacity-40")}
            >
              Fit
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              title="Close the map (Esc)"
              className={cx(chip, chipOff)}
            >
              Close ✕
            </button>
          </div>
        </div>
        <div className="ticks h-[3px] opacity-40" />
      </header>

      <div
        ref={attachArea}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          dragged.current = false;
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        }}
        onDoubleClick={(event) => {
          const at = pointerAt(event, event.currentTarget);
          setRaw((current) => zoomAt(clampView(current, box, area), 2, at, box, area));
        }}
        onClick={() => {
          if (!dragged.current) setSelectedKey(null);
        }}
        className={cx(
          "relative flex flex-1 touch-none items-center justify-center overflow-hidden bg-ground-2 select-none",
          // No grab cursor at the fitted scale, because there is nothing to pan to.
          view.scale > 1 && "cursor-grab active:cursor-grabbing",
        )}
      >
        {prepared && box.width > 0 ? (
          <div
            style={{
              width: box.width,
              height: box.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
            className="relative"
          >
            <div
              // This markup is still someone else's SVG, not something sanitised: `prepare`
              // only drops inactive floor groups, so a `<script>` in the source would run
              // when `replaceChildren` mounts it. Trust rests entirely on `svgPath` being a
              // fixed, pinned assets.tarkov.dev URL rather than on anything done to the markup.
              ref={mountSvg}
              className="size-full"
            />

            {/*
              A sibling of the SVG holder, not a child of it: the ref callback above replaces that
              node's children outright whenever `prepared` changes, which would silently wipe
              any JSX mounted inside it. Sharing this wrapper is also what keeps every marker
              aligned with the picture through the transform above, for free.
            */}
            <div className="pointer-events-none absolute inset-0">
              {/*
                Decoration only — the dot rendered below stays the clickable control for
                every zone, polygon or not. `viewBox="0 0 100 100"` with
                `preserveAspectRatio="none"` maps the same 0–1 `project()` fractions the
                dots use, stretched independently on each axis exactly as their percentage
                positioning already is.
              */}
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 size-full"
              >
                {visible.map((pin) => {
                  if (pin.kind !== "zone" || !pin.outline || pin.outline.length < 3) return null;
                  const points = pin.outline.map((point) => project(calibration, point));
                  if (points.some(({ u, v }) => u < 0 || u > 1 || v < 0 || v > 1)) return null;
                  return (
                    <polygon
                      key={pin.key}
                      points={points.map(({ u, v }) => `${u * 100},${v * 100}`).join(" ")}
                      className="fill-amber/20 stroke-amber/70"
                      strokeWidth="0.3"
                    />
                  );
                })}

                {/* The trail, joined in order. Fewer than two points has nothing to join. */}
                {trail.length >= 2 ? (
                  <polyline
                    points={trail
                      .map((shot) => {
                        const { u, v } = project(calibration, shot);
                        return `${u * 100},${v * 100}`;
                      })
                      .join(" ")}
                    fill="none"
                    className="stroke-rust/50"
                    strokeWidth="0.3"
                  />
                ) : null}
              </svg>

              {visible.map((pin) => {
                const { u, v } = project(calibration, pin.position);
                if (u < 0 || u > 1 || v < 0 || v > 1) return null;
                // The counter-scale and the hover grow cannot live on the same element.
                // Both compile to the `scale` CSS property, so an inline `scale` here
                // would beat the button's `:hover` rule outright — a stylesheet rule
                // that is not `!important` never wins over an inline declaration — and
                // `hover:scale-150` would be dead at every zoom, fitted view included.
                // Worse, `transition-transform` is Tailwind's shorthand for
                // `transition-property: transform, translate, scale, rotate`, so with
                // both classes on one element the counter-scale itself would ease over
                // 150ms on every wheel event and never settle during a continuous zoom.
                // A wrapper carries the position and the counter-scale; the button
                // inside keeps its own size, transition and hover grow untouched.
                return (
                  <div
                    key={pin.key}
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${u * 100}%`, top: `${v * 100}%`, scale: 1 / view.scale }}
                  >
                    <button
                      type="button"
                      // Focus counts as hover: these are real buttons, so tabbing through
                      // them is what makes the map reachable without a mouse at all.
                      onFocus={() => setHoveredKey(pin.key)}
                      onBlur={() => setHoveredKey((current) => (current === pin.key ? null : current))}
                      onPointerEnter={() => {
                        // Sweeping the map to pan would otherwise strobe the card through
                        // every pin crossed.
                        if (!drag.current) setHoveredKey(pin.key);
                      }}
                      onPointerLeave={() =>
                        setHoveredKey((current) => (current === pin.key ? null : current))
                      }
                      onClick={(event) => {
                        // Without this the stage's own click clears the selection again.
                        event.stopPropagation();
                        // A keyboard activation (Enter/Space on a focused button) dispatches
                        // a click with detail 0, unlike a real pointer click. Without this
                        // check, panning with the mouse once leaves `dragged.current` true
                        // forever after (it is only ever cleared by a pointerdown), and every
                        // later keyboard activation of a pin would be swallowed.
                        if (event.detail !== 0 && dragged.current) return;
                        setSelectedKey((current) => (current === pin.key ? null : pin.key));
                      }}
                      aria-label={`${pin.taskName} — ${pin.description}`}
                      className={cx(
                        "pointer-events-auto block cursor-pointer rounded-full border transition-transform hover:scale-150",
                        pin.kind === "zone"
                          ? "size-[10px] border-amber bg-amber/60"
                          : "size-[7px] border-bone-dim bg-bone-dim/40",
                        pin.key === shownKey && "ring-2 ring-amber",
                      )}
                    />
                  </div>
                );
              })}

              {/*
                The trail. Faint dots for where you have been, the last one drawn as an arrow
                because it is the only one whose facing you still care about.
              */}
              {trail.map((shot, index) => {
                const { u, v } = project(calibration, shot);
                if (u < 0 || u > 1 || v < 0 || v > 1) return null;
                const latest = index === trail.length - 1;
                if (!latest) {
                  return (
                    <span
                      key={shot.name}
                      style={{ left: `${u * 100}%`, top: `${v * 100}%`, scale: 1 / view.scale }}
                      className="absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-rust/50"
                    />
                  );
                }
                // tarkov.dev adds the map's own rotation to the marker, and a further half
                // turn on the quarter-turn maps. Ported rather than derived; confirm it
                // against a screenshot whose facing you know.
                const extra =
                  calibration.coordinateRotation === 90 || calibration.coordinateRotation === 270
                    ? calibration.coordinateRotation + 180
                    : calibration.coordinateRotation;
                return (
                  <span
                    key={shot.name}
                    style={{
                      left: `${u * 100}%`,
                      top: `${v * 100}%`,
                      scale: 1 / view.scale,
                      rotate: shot.yaw === null ? undefined : `${shot.yaw + extra}deg`,
                    }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 text-[16px] leading-none text-rust"
                    aria-label="You are here"
                  >
                    {shot.yaw === null ? "●" : "▲"}
                  </span>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="data text-[11px] text-muted">
            {/*
              `prepare` returning null against text that did arrive means a drawing this
              cannot read — no `viewBox`, or malformed XML. Said out loud rather than left
              as a permanent "loading", and not folded into the parent's `failed` flag,
              which would mean reaching for a callback and a synchronous setState in an
              effect to reach it.
            */}
            {text !== null && prepared === null ? "this map could not be read" : "loading"}
          </p>
        )}

        {shown ? (
          <div
            // The card is a child of the stage, which owns pan (pointerdown), clearing the
            // selection (click) and zoom (doubleclick) — all things a user clicking inside
            // the card is not asking for. Stop each here before it reaches the stage.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            className="absolute bottom-4 left-4 max-w-[min(360px,calc(100%-2rem))] border border-line-bright bg-panel/95 p-3"
          >
            <p className="stencil text-[11px] text-amber">{shown.taskName}</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-bone-dim">{shown.description}</p>
            {shown.key === selectedKey ? (
              // Only when the card is showing the pin you clicked, not merely one you are
              // hovering. Testing `hoveredKey === null` instead would hide the link right
              // after the click that should reveal it: the mouse (or, for a keyboard
              // activation, focus) is still on the clicked pin, so `hoveredKey` is still
              // set even though the card is showing the selection.
              <button
                type="button"
                onClick={() => {
                  const id = `task-${shown.taskId}`;
                  onClose();
                  // A zero timeout, not a frame: this only needs to run after React commits
                  // the close, so the scroll lock is off and the row is somewhere a smooth
                  // scroll can actually take you. A `requestAnimationFrame` callback is the
                  // one timer a page that is not currently being painted can starve, and a
                  // macrotask still runs after the commit either way.
                  setTimeout(() => {
                    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }, 0);
                }}
                className="stencil mt-2.5 cursor-pointer border border-line-bright px-2 py-1 text-[10px] text-muted transition-colors hover:border-amber hover:text-amber"
              >
                Go to task →
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <p className="data shrink-0 border-t border-line bg-panel/70 px-4 py-2 text-[10px] text-muted">
        Drawn by{" "}
        <a
          href="https://github.com/the-hideout/tarkov-dev-svg-maps/"
          target="_blank"
          rel="noreferrer"
          className="text-bone-dim underline decoration-line-bright underline-offset-2 hover:text-amber"
        >
          the tarkov.dev map project
        </a>
        . Your position appears once you take a screenshot in raid — this is not live tracking.
      </p>
    </div>
  );
}
