/**
 * Tauri Notification Plugin Mock for Browser / Web Mode
 */

export interface Options {
  title: string;
  body?: string;
  icon?: string;
  sound?: string;
  extra?: Record<string, unknown>;
}

export async function isPermissionGranted(): Promise<boolean> {
  if (typeof window !== "undefined" && "Notification" in window) {
    return Notification.permission === "granted";
  }
  return false;
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof window !== "undefined" && "Notification" in window) {
    return await Notification.requestPermission();
  }
  return "denied";
}

export function sendNotification(options: string | Options): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;

  const title = typeof options === "string" ? options : options.title;
  const body = typeof options === "object" ? options.body : undefined;
  const icon = typeof options === "object" ? options.icon : undefined;

  if (Notification.permission === "granted") {
    new Notification(title, { body, icon });
  }
}
