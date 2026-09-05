/**
 * Tauri Event API Mock for Browser / Web Mode
 */

export type UnlistenFn = () => void;

export interface Event<T> {
  event: string;
  id: number;
  payload: T;
}

export type EventCallback<T> = (event: Event<T>) => void;

export const TauriEvent = {
  WINDOW_RESIZED: "tauri://resize",
  WINDOW_MOVED: "tauri://move",
  WINDOW_CLOSE_REQUESTED: "tauri://close-requested",
  WINDOW_DESTROYED: "tauri://destroyed",
  WINDOW_FOCUS: "tauri://focus",
  WINDOW_BLUR: "tauri://blur",
  WINDOW_SCALE_FACTOR_CHANGED: "tauri://scale-change",
  WINDOW_THEME_CHANGED: "tauri://theme-changed",
  WINDOW_FILE_DROP: "tauri://file-drop",
  WINDOW_FILE_DROP_HOVER: "tauri://file-drop-hover",
  WINDOW_FILE_DROP_CANCELLED: "tauri://file-drop-cancelled",
  WEBVIEW_CREATED: "tauri://webview-created",
  DRAG_ENTER: "tauri://drag-enter",
  DRAG_OVER: "tauri://drag-over",
  DRAG_LEAVE: "tauri://drag-leave",
  DRAG_DROP: "tauri://drag-drop",
} as const;
export type TauriEvent = (typeof TauriEvent)[keyof typeof TauriEvent];

const listeners = new Map<string, Set<EventCallback<any>>>();
let nextListenerId = 1;

/**
 * Listen to an event emitted from anywhere in the app
 */
export async function listen<T = any>(
  event: string,
  handlerOrOptions: EventCallback<T> | any,
  maybeHandler?: EventCallback<T>
): Promise<UnlistenFn> {
  const handler: EventCallback<T> =
    typeof handlerOrOptions === "function" ? handlerOrOptions : maybeHandler!;

  if (!handler) {
    return () => {};
  }

  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  const handlerSet = listeners.get(event)!;
  handlerSet.add(handler);

  return () => {
    handlerSet.delete(handler);
    if (handlerSet.size === 0) {
      listeners.delete(event);
    }
  };
}

/**
 * Listen to an event once
 */
export async function once<T = any>(
  event: string,
  handlerOrOptions: EventCallback<T> | any,
  maybeHandler?: EventCallback<T>
): Promise<UnlistenFn> {
  const handler: EventCallback<T> =
    typeof handlerOrOptions === "function" ? handlerOrOptions : maybeHandler!;

  const unlisten = await listen<T>(event, (ev: Event<T>) => {
    unlisten();
    handler(ev);
  });
  return unlisten;
}

/**
 * Emit an event to all listeners
 */
export async function emit<T = any>(
  event: string,
  payload?: T,
  _options?: any
): Promise<void> {
  const handlerSet = listeners.get(event);
  if (handlerSet) {
    const eventObj: Event<T> = {
      event,
      id: nextListenerId++,
      payload: payload as T,
    };
    handlerSet.forEach((fn) => {
      try {
        fn(eventObj);
      } catch (err) {
        console.error(`[Web Event] Error in listener for "${event}":`, err);
      }
    });
  }

  // Also dispatch a DOM CustomEvent for interoperability
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(`tauri://${event}`, { detail: payload })
    );
  }
}

/**
 * Emit an event to a specific target window
 */
export async function emitTo<T = any>(
  _target: string,
  event: string,
  payload?: T
): Promise<void> {
  return emit(event, payload);
}
