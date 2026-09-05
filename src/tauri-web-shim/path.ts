/**
 * Tauri Path API Mock for Browser / Web Mode
 */

export async function appDataDir(): Promise<string> {
  return "/appdata";
}

export async function appConfigDir(): Promise<string> {
  return "/config";
}

export async function appLocalDataDir(): Promise<string> {
  return "/localdata";
}

export async function appCacheDir(): Promise<string> {
  return "/cache";
}

export async function appLogDir(): Promise<string> {
  return "/logs";
}

export async function desktopDir(): Promise<string> {
  return "/desktop";
}

export async function documentDir(): Promise<string> {
  return "/documents";
}

export async function downloadDir(): Promise<string> {
  return "/downloads";
}

export async function homeDir(): Promise<string> {
  return "/home";
}

export async function tempDir(): Promise<string> {
  return "/temp";
}

export async function join(...paths: string[]): Promise<string> {
  return paths
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/");
}

export async function resolve(...paths: string[]): Promise<string> {
  return join(...paths);
}

export async function normalize(path: string): Promise<string> {
  return path.replace(/\/+/g, "/");
}

export async function basename(path: string, ext?: string): Promise<string> {
  let name = path.split("/").pop() || "";
  if (ext && name.endsWith(ext)) {
    name = name.slice(0, -ext.length);
  }
  return name;
}

export async function dirname(path: string): Promise<string> {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || "/";
}

export async function extname(path: string): Promise<string> {
  const base = await basename(path);
  const dotIndex = base.lastIndexOf(".");
  return dotIndex !== -1 ? base.slice(dotIndex) : "";
}

export async function isAbsolute(path: string): Promise<boolean> {
  return path.startsWith("/");
}
