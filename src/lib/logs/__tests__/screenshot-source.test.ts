import { describe, expect, it } from "vitest";

import { MemoryScreenshotSource } from "../screenshot-source";

describe("MemoryScreenshotSource", () => {
  it("lists the names it was given", async () => {
    const source = new MemoryScreenshotSource(["a.png", "b.png"]);
    await expect(source.list()).resolves.toEqual(["a.png", "b.png"]);
  });

  it("reflects names added after construction", async () => {
    const source = new MemoryScreenshotSource();
    source.add("later.png");
    await expect(source.list()).resolves.toEqual(["later.png"]);
  });

  it("starts empty", async () => {
    await expect(new MemoryScreenshotSource().list()).resolves.toEqual([]);
  });
});
