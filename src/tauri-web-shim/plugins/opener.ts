/**
 * Tauri Opener Plugin Mock for Browser / Web Mode
 */

export async function openUrl(url: string | URL): Promise<void> {
  if (typeof window !== "undefined") {
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }
}

export async function openPath(path: string): Promise<void> {
  if (typeof window !== "undefined") {
    window.open(path, "_blank", "noopener,noreferrer");
  }
}

export async function revealItemInDir(_path: string): Promise<void> {}
