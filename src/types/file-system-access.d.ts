/**
 * File System Access API bits TypeScript's DOM lib does not ship.
 *
 * The permission methods are part of the spec but not in lib.dom, and `showDirectoryPicker`
 * is only present in some TS versions. Declared narrowly rather than pulling in a package.
 */

interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: "read" | "readwrite";
  startIn?: FileSystemHandle | "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
}

interface Window {
  showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
