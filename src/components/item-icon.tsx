"use client";

import { useState } from "react";

/**
 * tarkov.dev's 64px item icon.
 *
 * The keys panel is a packing list you check against your stash, and "Machinery key" is
 * far slower to match against a container of loot than the picture on the item itself.
 * Served straight from assets.tarkov.dev — the same hotlink the 3D maps use, and a couple
 * of kilobytes each.
 *
 * Decorative on purpose: every use sits beside the item's name, so announcing the icon
 * would only repeat it. Renders nothing when there is no icon or the fetch fails, rather
 * than leaving a broken-image glyph in the middle of a list.
 */
export function ItemIcon({
  src,
  size = 16,
  width,
  height,
}: {
  src?: string | null;
  size?: number;
  /**
   * A box of its own, for an item drawn at its stash footprint rather than in a square —
   * a 5×2 rifle in the calculators' process cell. `object-contain` keeps the picture's own
   * proportions inside it, so a box a cell too wide letterboxes rather than stretching.
   */
  width?: number;
  height?: number;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;

  const box = { width: width ?? size, height: height ?? size };

  return (
    // Plain <img>: these are external files, and next/image cannot optimise them under
    // `output: "export"` anyway.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      width={box.width}
      height={box.height}
      // The task list renders hundreds of rows at once; without this every key on every
      // row would be requested before you scrolled to any of them.
      loading="lazy"
      onError={() => setFailed(true)}
      style={box}
      className="shrink-0 object-contain"
    />
  );
}
