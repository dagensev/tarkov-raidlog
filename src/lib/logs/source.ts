/**
 * Where log bytes come from.
 *
 * The watcher talks to this port rather than to the File System Access API directly, so
 * the tailing logic is testable without a browser, and so a future local companion agent
 * can supply the same interface without the watcher changing.
 */

export interface FileStat {
  size: number;
  lastModified: number;
}

export interface LogSource {
  /** Names of every entry in the logs directory. Non-session folders are filtered later. */
  listFolders(): Promise<string[]>;
  /** File names inside one session folder. */
  listFiles(folder: string): Promise<string[]>;
  stat(folder: string, file: string): Promise<FileStat | null>;
  /** Read from `start` to end of file. */
  readFrom(folder: string, file: string, start: number): Promise<string>;
}

/** In-memory source for tests, and for the drag-and-drop import path. */
export class MemoryLogSource implements LogSource {
  /** folder -> file -> contents */
  private readonly data = new Map<string, Map<string, string>>();

  constructor(initial: Record<string, Record<string, string>> = {}) {
    for (const [folder, files] of Object.entries(initial)) {
      this.data.set(folder, new Map(Object.entries(files)));
    }
  }

  /** Replace a file's contents, as a new game session would. */
  write(folder: string, file: string, contents: string): void {
    let files = this.data.get(folder);
    if (!files) this.data.set(folder, (files = new Map()));
    files.set(file, contents);
  }

  /** Add to the end of a file, as the running game does. */
  append(folder: string, file: string, contents: string): void {
    this.write(folder, file, (this.data.get(folder)?.get(file) ?? "") + contents);
  }

  async listFolders(): Promise<string[]> {
    return [...this.data.keys()];
  }

  async listFiles(folder: string): Promise<string[]> {
    return [...(this.data.get(folder)?.keys() ?? [])];
  }

  async stat(folder: string, file: string): Promise<FileStat | null> {
    const contents = this.data.get(folder)?.get(file);
    if (contents === undefined) return null;
    return { size: contents.length, lastModified: 0 };
  }

  async readFrom(folder: string, file: string, start: number): Promise<string> {
    return (this.data.get(folder)?.get(file) ?? "").slice(start);
  }
}
