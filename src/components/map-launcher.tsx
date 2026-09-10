"use client";

import type { CSSProperties } from "react";

import { Panel, Pill, cx } from "./ui";

/**
 * The card that opens the raid map.
 *
 * This was a thin header strip whose only clickable part was an eleven-pixel word, sitting
 * next to a link out to tarkov.dev that looked exactly as important. Nobody could tell that
 * the best thing on the page was behind it.
 *
 * So: the whole card is the button, and it lists what is inside before you open it. The
 * gesture hints along the bottom answer the questions the map itself cannot — that dragging
 * pans, that the wheel zooms, that Escape gets you out.
 */
export function MapLauncher({
  label,
  tags,
  features,
  hints,
  onOpen,
  className,
  style,
}: {
  /** The name of the thing. Deliberately not "Map". */
  label: string;
  /** Short badges next to the name, in the order they should read. */
  tags?: readonly string[];
  /** What is inside, one short line each. Six words beats a sentence here. */
  features: readonly string[];
  /** Gesture hints, shown as a dotted row along the bottom. */
  hints: readonly string[];
  onOpen: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Panel className={cx("rise overflow-hidden border-amber/35", className)} style={style}>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        title={`Open ${label} full screen`}
        className="group block w-full cursor-pointer text-left transition-colors hover:bg-amber/[0.06]"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4">
          <span className="stencil text-[14px] text-amber glow-amber">{label}</span>
          {tags?.map((tag) => (
            <Pill key={tag} tone="amber">
              {tag}
            </Pill>
          ))}
          <span className="stencil ml-auto border border-amber bg-amber/15 px-3 py-1.5 text-[10px] whitespace-nowrap text-amber transition-colors group-hover:bg-amber group-hover:text-ground">
            Open full screen ⤢
          </span>
        </div>

        {/*
          A list rather than a paragraph: this is read at a glance on the way into a raid,
          and the four things it does are four things, not prose.
        */}
        <ul className="space-y-1 px-4 pt-3">
          {features.map((feature) => (
            <li key={feature} className="flex gap-2.5 text-[12px] leading-relaxed text-bone-dim">
              <span aria-hidden className="text-amber-dim">
                ▸
              </span>
              {feature}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3 pb-3.5">
          {hints.map((hint, index) => (
            <span key={hint} className="data text-[10px] text-muted">
              {index > 0 ? <span className="pr-2 text-line-bright">·</span> : null}
              {hint}
            </span>
          ))}
        </div>
        <div className="ticks h-[3px] opacity-40" />
      </button>
    </Panel>
  );
}
