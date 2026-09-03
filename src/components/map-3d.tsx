"use client";

import { useState } from "react";

import { map3d } from "@/lib/tarkovdev/maps-3d";
import type { GameMap } from "@/lib/tarkovdev/types";
import { Panel, PanelHeader, cx } from "./ui";

/**
 * re3mr's 3D render of the map you are dropping into.
 *
 * These files are large — 0.5 MB on Ground Zero, 11.5 MB on Lighthouse — so the ~20 KB
 * thumbnail goes up first and the full render fades in over it. That way the panel is
 * never an empty box, and on a map you have already opened this week the browser serves
 * both from cache (tarkov.dev sends `Cache-Control: max-age=345600`).
 *
 * State is per map, so the caller keys this on the map id.
 */
export function Map3d({ map }: { map: GameMap }) {
  const source = map3d(map);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  // Five of the thirteen maps have no 3D render. Nothing to say about that, so say
  // nothing rather than showing an apologetic empty panel.
  if (!source || failed) return null;

  return (
    <Panel className="rise" style={{ animationDelay: "90ms" }}>
      <PanelHeader
        title="3D map"
        meta={loaded ? null : "loading"}
        action={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setZoomed((v) => !v)}
              title={zoomed ? "Fit the whole map in the panel" : "Show at full size and pan"}
              className="stencil cursor-pointer border border-line-bright px-2 py-1 text-[10px] text-muted transition-colors hover:border-amber hover:text-amber"
            >
              {zoomed ? "Fit" : "Zoom"}
            </button>
            <a
              href={source.page}
              target="_blank"
              rel="noreferrer"
              className="stencil text-[10px] text-muted underline decoration-line-bright underline-offset-4 transition-colors hover:text-amber"
            >
              tarkov.dev ↗
            </a>
          </div>
        }
      />

      <div
        className={cx(
          "relative bg-ground-2",
          zoomed ? "max-h-[70vh] overflow-auto" : "overflow-hidden",
          !loaded && "min-h-[220px]",
        )}
      >
        {/*
          The stand-in. Blurred because it is being shown far above its own resolution,
          and dimmed so the sharp render reads as an arrival rather than a flicker.
        */}
        {/*
          Plain <img> on purpose: these are external files served by tarkov.dev, and
          next/image would impose the intrinsic sizing the pan view is built on overflowing.
        */}
        {!loaded ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={source.thumbnail}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full object-cover opacity-50 blur-[3px]"
          />
        ) : null}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={source.image}
          alt={`3D map of ${map.name}, drawn by ${source.author}`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cx(
            "relative block transition-opacity duration-500",
            loaded ? "opacity-100" : "opacity-0",
            // Natural width overflows the panel, which is what makes panning possible.
            zoomed ? "max-w-none" : "w-full",
          )}
        />
      </div>

      <p className="data border-t border-line px-4 py-2 text-[10px] text-muted">
        Drawn by{" "}
        <a
          href={source.authorLink}
          target="_blank"
          rel="noreferrer"
          className="text-bone-dim underline decoration-line-bright underline-offset-2 hover:text-amber"
        >
          {source.author}
        </a>
        , hosted by tarkov.dev.
      </p>
    </Panel>
  );
}
