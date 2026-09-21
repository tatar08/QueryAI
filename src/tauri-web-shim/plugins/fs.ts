/**
 * Tauri FS Plugin Mock for Browser / Web Mode
 */

export const BaseDirectory = {
  Audio: 1,
  Cache: 2,
  Config: 3,
  Data: 4,
  LocalData: 5,
  Document: 6,
  Download: 7,
  Picture: 8,
  Public: 9,
  Video: 10,
  Resource: 11,
  Temp: 12,
  AppConfig: 13,
  AppData: 14,
  AppLocalData: 15,
  AppCache: 16,
  AppLog: 17,
} as const;
export type BaseDirectory = (typeof BaseDirectory)[keyof typeof BaseDirectory];

export interface FsOptions {
  baseDir?: BaseDirectory;
}

const fileStore = new Map<string, string | Uint8Array>();

// Called by dialog.ts's open() so a picked browser File's real content is
// readable afterward via readTextFile/readFile(name) — the file input only
// exposes a File object once, at pick time, not a re-readable path.
export function registerPickedFile(name: string, data: Uint8Array): void {
  fileStore.set(name, data);
}

export async function readTextFile(path: string, _options?: FsOptions): Promise<string> {
  if (fileStore.has(path)) {
    const val = fileStore.get(path)!;
    if (typeof val === "string") return val;
    return new TextDecoder().decode(val);
  }
  return "";
}

export async function readFile(path: string, _options?: FsOptions): Promise<Uint8Array> {
  if (fileStore.has(path)) {
    const val = fileStore.get(path)!;
    if (val instanceof Uint8Array) return val;
    return new TextEncoder().encode(val);
  }
  return new Uint8Array();
}

function triggerBrowserDownload(filename: string, data: string | Uint8Array | ArrayBuffer) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    const parts = [data instanceof ArrayBuffer ? new Uint8Array(data) : data];
    const blob = new Blob(parts as any, { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.split(/[/\\]/).pop() || "download";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.warn("Browser download failed:", err);
  }
}

export async function writeTextFile(
  path: string,
  contents: string,
  _options?: FsOptions
): Promise<void> {
  fileStore.set(path, contents);
  triggerBrowserDownload(path, contents);
}

export async function writeFile(
  path: string,
  data: Uint8Array | ArrayBuffer | string,
  _options?: FsOptions
): Promise<void> {
  if (typeof data === "string") {
    fileStore.set(path, data);
  } else if (data instanceof Uint8Array) {
    fileStore.set(path, data);
  } else if (data instanceof ArrayBuffer) {
    fileStore.set(path, new Uint8Array(data));
  }
  triggerBrowserDownload(path, data);
}

export async function exists(path: string, _options?: FsOptions): Promise<boolean> {
  return fileStore.has(path);
}

export async function mkdir(_path: string, _options?: FsOptions): Promise<void> {}
export async function remove(path: string, _options?: FsOptions): Promise<void> {
  fileStore.delete(path);
}

export async function readDir(_path: string, _options?: FsOptions): Promise<any[]> {
  return [];
}

export async function copyFile(
  fromPath: string,
  toPath: string,
  _options?: FsOptions
): Promise<void> {
  const content = fileStore.get(fromPath);
  if (content !== undefined) {
    fileStore.set(toPath, content);
  }
}

export async function stat(_path: string, _options?: FsOptions): Promise<any> {
  return {
    isFile: true,
    isDirectory: false,
    isSymlink: false,
    size: 0,
    mtime: new Date(),
    atime: new Date(),
    ctime: new Date(),
  };
}

export async function lstat(path: string, options?: FsOptions): Promise<any> {
  return stat(path, options);
}

export async function truncate(_path: string, _len?: number, _options?: FsOptions): Promise<void> {}
export async function rename(oldPath: string, newPath: string, _options?: FsOptions): Promise<void> {
  const content = fileStore.get(oldPath);
  if (content !== undefined) {
    fileStore.delete(oldPath);
    fileStore.set(newPath, content);
  }
}
