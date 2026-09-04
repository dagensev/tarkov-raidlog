import { isFileSystemAccessSupported } from "./fs-access-source";

/**
 * Where screenshot file names come from.
 *
 * Deliberately not a `LogSource`. That port is shaped around byte-offset tailing — `stat`,
 * `readFrom`, folder-then-file addressing — and none of it means anything here, because
 * the position is in the *name* and no screenshot is ever opened. One method is the whole
 * requirement, and keeping it to one method is what makes the difference between a poll
 * that lists a directory and a poll that opens a thousand files to read their timestamps.
 */
export interface ScreenshotSource {
  /** File names in the screenshots directory. Names only: nothing is opened. */
  list(): Promise<string[]>;
}

/** Ask the user for the game's `Screenshots` directory. Must be called from a user gesture. */
export async function pickScreenshotDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error(
      "This browser cannot read local folders. Raidlog needs Chrome or Edge to show your position.",
    );
  }
  return window.showDirectoryPicker!({ id: "eft-screenshots", mode: "read" });
}

export class FileSystemAccessScreenshotSource implements ScreenshotSource {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  async list(): Promise<string[]> {
    const names: string[] = [];
    for await (const entry of this.root.values()) {
      // Only `.png` reaches the parser anyway, but filtering here keeps a folder that also
      // holds videos or thumbnails from being walked into the regex on every poll.
      if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".png")) {
        names.push(entry.name);
      }
    }
    return names;
  }
}

/** In-memory source for tests. */
export class MemoryScreenshotSource implements ScreenshotSource {
  private readonly names: string[];

  constructor(initial: readonly string[] = []) {
    this.names = [...initial];
  }

  /** Add a name, as taking a screenshot would. */
  add(name: string): void {
    this.names.push(name);
  }

  async list(): Promise<string[]> {
    return [...this.names];
  }
}
