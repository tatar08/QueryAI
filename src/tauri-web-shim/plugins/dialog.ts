/**
 * Tauri Dialog Plugin Mock for Browser / Web Mode
 */

import { registerPickedFile } from "./fs";

export interface OpenDialogOptions {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  defaultPath?: string;
  multiple?: boolean;
  directory?: boolean;
  recursive?: boolean;
  canCreateDirectories?: boolean;
}

export interface SaveDialogOptions {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  defaultPath?: string;
  canCreateDirectories?: boolean;
}

export interface MessageDialogOptions {
  title?: string;
  kind?: "info" | "warning" | "error";
  okLabel?: string;
}

export interface ConfirmDialogOptions {
  title?: string;
  kind?: "info" | "warning" | "error";
  okLabel?: string;
  cancelLabel?: string;
}

export async function open(options?: OpenDialogOptions): Promise<string | string[] | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      return resolve(null);
    }
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = !!options?.multiple;
    if (options?.filters && options.filters.length > 0) {
      input.accept = options.filters
        .flatMap((f) => f.extensions.map((ext) => `.${ext}`))
        .join(",");
    }

    input.onchange = () => {
      if (input.files && input.files.length > 0) {
        const files = Array.from(input.files);
        // Stash real content now — the File objects only exist for this
        // change event, but readTextFile/readFile(name) is called later.
        void Promise.all(
          files.map(async (f) => {
            registerPickedFile(f.name, new Uint8Array(await f.arrayBuffer()));
          }),
        ).then(() => {
          if (options?.multiple) {
            resolve(files.map((f) => f.name));
          } else {
            resolve(files[0].name);
          }
        });
      } else {
        resolve(null);
      }
    };

    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function save(options?: SaveDialogOptions): Promise<string | null> {
  const filename = options?.defaultPath || "database.sqlite";
  return filename;
}

export async function message(msg: string, options?: MessageDialogOptions): Promise<void> {
  if (typeof window !== "undefined") {
    window.alert(options?.title ? `${options.title}\n\n${msg}` : msg);
  }
}

export async function confirm(msg: string, options?: ConfirmDialogOptions): Promise<boolean> {
  if (typeof window !== "undefined") {
    return window.confirm(options?.title ? `${options.title}\n\n${msg}` : msg);
  }
  return false;
}

export async function ask(msg: string, options?: ConfirmDialogOptions): Promise<boolean> {
  return confirm(msg, options);
}
