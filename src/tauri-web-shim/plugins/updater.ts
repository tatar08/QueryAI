/**
 * Tauri Updater Plugin Mock for Browser / Web Mode
 */

export class Update {
  version = "0.21.0";
  currentVersion = "0.21.0";
  body = "";
  date = "";

  async downloadAndInstall(_onProgress?: (progress: any) => void): Promise<void> {}
  async close(): Promise<void> {}
}

export async function check(_options?: any): Promise<Update | null> {
  return null;
}
