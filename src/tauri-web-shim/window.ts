/**
 * Tauri Window API Mock for Browser / Web Mode
 */

import { listen, emit, once, type UnlistenFn } from "./event";

export const UserAttentionType = {
  Critical: 1,
  Informational: 2,
} as const;
export type UserAttentionType = (typeof UserAttentionType)[keyof typeof UserAttentionType];

export const Effect = {
  AppearanceBased: "appearanceBased",
  Light: "light",
  Dark: "dark",
  Titlebar: "titlebar",
  Selection: "selection",
  Menu: "menu",
  Popover: "popover",
  Sidebar: "sidebar",
  HeaderView: "headerView",
  Sheet: "sheet",
  WindowBackground: "windowBackground",
  HudWindow: "hudWindow",
  FullScreenUI: "fullScreenUI",
  Tooltip: "tooltip",
  ContentBackground: "contentBackground",
  UnderWindowBackground: "underWindowBackground",
  UnderPageBackground: "underPageBackground",
  Mica: "mica",
  Blur: "blur",
  Acrylic: "acrylic",
} as const;
export type Effect = (typeof Effect)[keyof typeof Effect];

export class LogicalPosition {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

export class LogicalSize {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}

export class PhysicalPosition {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

export class PhysicalSize {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}

export class WebviewWindow {
  label: string;

  constructor(label: string, _options?: any) {
    this.label = label;
  }

  static getByLabel(label: string): WebviewWindow | null {
    return new WebviewWindow(label);
  }

  static getCurrent(): WebviewWindow {
    return currentWindow;
  }

  async listen<T = any>(event: string, handler: (event: any) => void): Promise<UnlistenFn> {
    return listen<T>(event, handler);
  }

  async once<T = any>(event: string, handler: (event: any) => void): Promise<UnlistenFn> {
    return once<T>(event, handler);
  }

  async emit(event: string, payload?: any): Promise<void> {
    return emit(event, payload);
  }

  async setTitle(title: string): Promise<void> {
    if (typeof document !== "undefined") {
      document.title = title;
    }
  }

  async close(): Promise<void> {
    if (typeof window !== "undefined") {
      window.close();
    }
  }

  async minimize(): Promise<void> {}
  async maximize(): Promise<void> {}
  async unmaximize(): Promise<void> {}
  async toggleMaximize(): Promise<void> {}
  async isMaximized(): Promise<boolean> {
    return false;
  }

  async isMinimized(): Promise<boolean> {
    return false;
  }

  async isFullscreen(): Promise<boolean> {
    return typeof document !== "undefined" && !!document.fullscreenElement;
  }

  async setFocus(): Promise<void> {
    if (typeof window !== "undefined") {
      window.focus();
    }
  }

  async show(): Promise<void> {}
  async hide(): Promise<void> {}
  async isVisible(): Promise<boolean> {
    return true;
  }

  async requestUserAttention(_type: UserAttentionType | null): Promise<void> {}

  async theme(): Promise<"light" | "dark" | null> {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  }

  async setTheme(_theme: "light" | "dark" | null): Promise<void> {}

  async onThemeChanged(handler: (theme: "light" | "dark") => void): Promise<UnlistenFn> {
    if (typeof window !== "undefined" && window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = (e: MediaQueryListEvent) => {
        handler(e.matches ? "dark" : "light");
      };
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    }
    return () => {};
  }

  async onCloseRequested(_handler: (event: any) => void): Promise<UnlistenFn> {
    return () => {};
  }

  async onResized(_handler: (event: any) => void): Promise<UnlistenFn> {
    return () => {};
  }

  async onMoved(_handler: (event: any) => void): Promise<UnlistenFn> {
    return () => {};
  }

  async onFocusChanged(_handler: (event: any) => void): Promise<UnlistenFn> {
    return () => {};
  }

  async onScaleFactorChanged(_handler: (event: any) => void): Promise<UnlistenFn> {
    return () => {};
  }

  async onFileDropEvent(_handler: (event: any) => void): Promise<UnlistenFn> {
    return () => {};
  }

  async center(): Promise<void> {}
  async setPosition(_pos: any): Promise<void> {}
  async setSize(_size: any): Promise<void> {}
  async setAlwaysOnTop(_val: boolean): Promise<void> {}
  async setDecorations(_val: boolean): Promise<void> {}
  async setShadow(_val: boolean): Promise<void> {}
  async setProgressBar(_state: any): Promise<void> {}
  async setFullscreen(_fullscreen: boolean): Promise<void> {}
  async startDragging(): Promise<void> {}
}

export const currentWindow = new WebviewWindow("main");

export function getCurrentWindow(): WebviewWindow {
  return currentWindow;
}
