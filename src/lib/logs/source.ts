/**
 * Where log bytes come from.
 *
 * The watcher talks to this port rather than to the File System Access API directly, so
 * the tailing logic is testable without a browser, and so a future local companion agent
 * can supply the same interface without the watcher changing.
 */

const ENCODER = new TextEncoder();

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
  /**
   * Read raw bytes from `start` to end of file.
   *
   * Bytes, not text, and `start` is a byte offset to match `FileStat.size`. Logs contain
   * Cyrillic player nicknames, so a character offset would drift out of step with the
   * byte length the filesystem reports and eventually slice mid-record. Decoding is the
   * watcher's job, where a streaming decoder can span a multi-byte sequence that
   * straddles two reads.
   */
  readFrom(folder: string, file: string, start: number): Promise<Uint8Array>;
}

/**
 * In-memory source for tests, and for the drag-and-drop import path.
 *
 * Stores bytes rather than strings so it can represent a file truncated mid-way through
 * a multi-byte character — which is exactly the case that breaks naive tailing, and so
 * exactly the case tests need to be able to construct.
 */
export class MemoryLogSource implements LogSource {
  /** folder -> file -> bytes */
  private readonly data = new Map<string, Map<string, Uint8Array>>();

  constructor(initial: Record<string, Record<string, string>> = {}) {
    for (const [folder, files] of Object.entries(initial)) {
      for (const [file, contents] of Object.entries(files)) {
        this.write(folder, file, contents);
      }
    }
  }

  /** Replace a file's contents, as a new game session would. */
  write(folder: string, file: string, contents: string): void {
    this.writeBytes(folder, file, ENCODER.encode(contents));
  }

  /** Replace a file's raw bytes, for constructing partially-written files. */
  writeBytes(folder: string, file: string, bytes: Uint8Array): void {
    let files = this.data.get(folder);
    if (!files) this.data.set(folder, (files = new Map()));
    files.set(file, bytes);
  }

  /** Add to the end of a file, as the running game does. */
  append(folder: string, file: string, contents: string): void {
    const existing = this.data.get(folder)?.get(file) ?? new Uint8Array(0);
    const addition = ENCODER.encode(contents);
    const merged = new Uint8Array(existing.byteLength + addition.byteLength);
    merged.set(existing);
    merged.set(addition, existing.byteLength);
    this.writeBytes(folder, file, merged);
  }

  async listFolders(): Promise<string[]> {
    return [...this.data.keys()];
  }

  async listFiles(folder: string): Promise<string[]> {
    return [...(this.data.get(folder)?.keys() ?? [])];
  }

  async stat(folder: string, file: string): Promise<FileStat | null> {
    const bytes = this.data.get(folder)?.get(file);
    if (bytes === undefined) return null;
    return { size: bytes.byteLength, lastModified: 0 };
  }

  async readFrom(folder: string, file: string, start: number): Promise<Uint8Array> {
    return (this.data.get(folder)?.get(file) ?? new Uint8Array(0)).subarray(start);
  }
}
