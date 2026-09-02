import type { FileStat, LogSource } from "./source";

/**
 * The File System Access API implementation of {@link LogSource}.
 *
 * This is the piece that makes Raidlog a website rather than a desktop app: the browser
 * grants read access to the game's `Logs` directory once, and the handle survives in
 * IndexedDB. It is Chromium-only, which is a deliberate accepted constraint.
 */

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/** Ask the user for the game's `Logs` directory. Must be called from a user gesture. */
export async function pickLogDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error(
      "This browser cannot read local folders. Raidlog needs Chrome or Edge for live log tracking.",
    );
  }
  return window.showDirectoryPicker!({ id: "eft-logs", mode: "read" });
}

export type PermissionResult = "granted" | "prompt" | "denied";

/** Current permission on a stored handle, without prompting. */
export async function checkPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionResult> {
  if (!handle.queryPermission) return "granted";
  return (await handle.queryPermission({ mode: "read" })) as PermissionResult;
}

/**
 * Re-acquire permission on a stored handle. Needs a user gesture, which is why the UI
 * shows a "Reconnect logs" button rather than doing this on load.
 */
export async function requestPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionResult> {
  if (!handle.requestPermission) return "granted";
  return (await handle.requestPermission({ mode: "read" })) as PermissionResult;
}

export class FileSystemAccessLogSource implements LogSource {
  /** Cache directory handles so a poll does not re-resolve every folder each time. */
  private readonly folderCache = new Map<string, FileSystemDirectoryHandle>();

  constructor(private readonly root: FileSystemDirectoryHandle) {}

  private async folder(name: string): Promise<FileSystemDirectoryHandle | null> {
    const cached = this.folderCache.get(name);
    if (cached) return cached;
    try {
      const handle = await this.root.getDirectoryHandle(name);
      this.folderCache.set(name, handle);
      return handle;
    } catch {
      // Folder vanished between listing and reading.
      return null;
    }
  }

  private async file(folder: string, file: string): Promise<File | null> {
    const dir = await this.folder(folder);
    if (!dir) return null;
    try {
      return await (await dir.getFileHandle(file)).getFile();
    } catch {
      return null;
    }
  }

  async listFolders(): Promise<string[]> {
    const names: string[] = [];
    for await (const entry of this.root.values()) {
      if (entry.kind === "directory") names.push(entry.name);
    }
    return names;
  }

  async listFiles(folder: string): Promise<string[]> {
    const dir = await this.folder(folder);
    if (!dir) return [];
    const names: string[] = [];
    for await (const entry of dir.values()) {
      if (entry.kind === "file") names.push(entry.name);
    }
    return names;
  }

  async stat(folder: string, file: string): Promise<FileStat | null> {
    const handle = await this.file(folder, file);
    return handle ? { size: handle.size, lastModified: handle.lastModified } : null;
  }

  async readFrom(folder: string, file: string, start: number): Promise<Uint8Array> {
    const handle = await this.file(folder, file);
    if (!handle) return new Uint8Array(0);
    // `File.slice` is byte-addressed, which is why offsets are tracked in bytes.
    const blob = start > 0 ? handle.slice(start) : handle;
    return new Uint8Array(await blob.arrayBuffer());
  }
}
