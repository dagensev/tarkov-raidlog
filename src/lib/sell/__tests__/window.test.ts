import { describe, expect, it } from "vitest";

import { offsetOf, rowAt, rowWindow } from "../window";

/** The table's own numbers, so the assertions read like the page. */
const ROW = 76;
const VIEWPORT = 760; // ten rows

const win = (scrollTop: number, over: Partial<Parameters<typeof rowWindow>[0]> = {}) =>
  rowWindow({
    scrollTop,
    viewportHeight: VIEWPORT,
    rowHeight: ROW,
    count: 4835,
    overscan: 2,
    ...over,
  });

describe("rowAt", () => {
  it("finds the row under an offset", () => {
    expect(rowAt(0, ROW)).toBe(0);
    expect(rowAt(ROW - 1, ROW)).toBe(0);
    expect(rowAt(ROW, ROW)).toBe(1);
  });

  it("treats a negative scroll as the top, which is what rubber-banding produces", () => {
    expect(rowAt(-200, ROW)).toBe(0);
  });

  it("stays on the open row for the whole of its expanded height", () => {
    const open = { index: 10, height: 200 };
    expect(rowAt(10 * ROW, ROW, open)).toBe(10);
    expect(rowAt(11 * ROW + 199, ROW, open)).toBe(10);
    expect(rowAt(11 * ROW + 200, ROW, open)).toBe(11);
  });

  it("is unaffected by an open row below the offset", () => {
    expect(rowAt(3 * ROW, ROW, { index: 40, height: 200 })).toBe(3);
  });
});

describe("offsetOf", () => {
  it("is the plain multiple with nothing expanded", () => {
    expect(offsetOf(12, ROW)).toBe(12 * ROW);
  });

  it("pushes rows below the open one down, and leaves the open row itself alone", () => {
    const open = { index: 5, height: 200 };
    expect(offsetOf(5, ROW, open)).toBe(5 * ROW);
    expect(offsetOf(6, ROW, open)).toBe(6 * ROW + 200);
  });
});

describe("rowWindow", () => {
  it("draws the top of the list with no spacer above it", () => {
    const window = win(0);
    expect(window.start).toBe(0);
    expect(window.padTop).toBe(0);
    // Ten rows on screen, plus two of overscan below.
    expect(window.end).toBe(13);
  });

  it("draws a slice in the middle, with spacers standing in for the rest", () => {
    const window = win(100 * ROW);
    expect(window.start).toBe(98);
    expect(window.end).toBe(113);
    expect(window.padTop).toBe(98 * ROW);
  });

  it("always adds up to the full height, which is what sizes the scrollbar", () => {
    for (const scrollTop of [0, 5 * ROW, 100 * ROW, 4830 * ROW]) {
      const window = win(scrollTop);
      const rendered = (window.end - window.start) * ROW;
      expect(window.padTop + rendered + window.padBottom).toBe(window.totalHeight);
    }
  });

  it("stops at the last row rather than running past it", () => {
    const window = win(4835 * ROW);
    expect(window.end).toBe(4835);
    expect(window.padBottom).toBe(0);
  });

  it("counts the expanded row into the total height", () => {
    expect(win(0, { open: { index: 3, height: 200 } }).totalHeight).toBe(4835 * ROW + 200);
  });

  it("shifts the spacer above once the expanded row is scrolled past", () => {
    const open = { index: 3, height: 200 };
    const window = win(100 * ROW, { open });
    expect(window.padTop).toBe(offsetOf(window.start, ROW, open));
    expect(window.padTop).toBe(window.start * ROW + 200);
  });

  it("leaves the spacer above alone when the expanded row is still below", () => {
    const window = win(0, { open: { index: 400, height: 200 } });
    expect(window.padTop).toBe(0);
    expect(window.padBottom).toBe(4835 * ROW + 200 - window.end * ROW);
  });

  it("ignores an expanded row that filtering has taken off the list", () => {
    // The open row is remembered by item id, and a chip click can drop it from the table
    // while it is still expanded. Padding the table out by a row that is not there leaves
    // a gap at the bottom that nothing fills.
    const window = win(0, { count: 10, open: { index: 40, height: 200 } });
    expect(window.totalHeight).toBe(10 * ROW);
  });

  it("draws nothing for an empty list", () => {
    const window = win(0, { count: 0 });
    expect(window).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0, totalHeight: 0 });
  });

  it("overscans on both sides so a fast scroll never shows blank space", () => {
    const tight = rowWindow({ scrollTop: 100 * ROW, viewportHeight: VIEWPORT, rowHeight: ROW, count: 4835, overscan: 0 });
    const loose = win(100 * ROW);
    expect(loose.start).toBeLessThan(tight.start);
    expect(loose.end).toBeGreaterThan(tight.end);
  });
});
