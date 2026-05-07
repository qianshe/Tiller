export const DEFAULT_TOAST_DURATION_MS = 3000;
export const TOAST_EXIT_ANIMATION_MS = 180;

export type ToastVariant = "success" | "error" | "warning" | "info";
export type ToastState = "visible" | "exiting";
export type ToastId = string;

export type ToastOptions = Readonly<{
  duration?: number;
  id?: ToastId;
}>;

export type ToastItem = Readonly<{
  id: ToastId;
  message: string;
  variant: ToastVariant;
  duration: number;
  state: ToastState;
}>;

export type ToastSnapshot = readonly ToastItem[];
export type ToastListener = (items: ToastSnapshot) => void;

type ToastTimer = ReturnType<typeof globalThis.setTimeout>;

let nextToastId = 1;
let toastItems: ToastSnapshot = [];

const listeners = new Set<ToastListener>();
const autoDismissTimers = new Map<ToastId, ToastTimer>();
const removalTimers = new Map<ToastId, ToastTimer>();

function createToastId() {
  const id = `toast-${nextToastId}`;
  nextToastId += 1;
  return id;
}

function emitToastUpdate() {
  for (const listener of listeners) {
    listener(toastItems);
  }
}

function clearTimer(map: Map<ToastId, ToastTimer>, id: ToastId) {
  const timer = map.get(id);
  if (!timer) return;
  globalThis.clearTimeout(timer);
  map.delete(id);
}

function removeToast(id: ToastId) {
  clearTimer(autoDismissTimers, id);
  clearTimer(removalTimers, id);

  const nextItems = toastItems.filter((item) => item.id !== id);
  if (nextItems.length === toastItems.length) return;

  toastItems = nextItems;
  emitToastUpdate();
}

function scheduleRemoval(id: ToastId) {
  clearTimer(removalTimers, id);
  removalTimers.set(
    id,
    globalThis.setTimeout(() => removeToast(id), TOAST_EXIT_ANIMATION_MS),
  );
}

function scheduleAutoDismiss(id: ToastId, duration: number) {
  clearTimer(autoDismissTimers, id);
  if (duration <= 0 || !Number.isFinite(duration)) return;

  autoDismissTimers.set(
    id,
    globalThis.setTimeout(() => dismissToast(id), duration),
  );
}

function showToast(
  variant: ToastVariant,
  message: string,
  options: ToastOptions = {},
) {
  const id = options.id ?? createToastId();
  const duration = options.duration ?? DEFAULT_TOAST_DURATION_MS;
  const item: ToastItem = { id, message, variant, duration, state: "visible" };

  clearTimer(autoDismissTimers, id);
  clearTimer(removalTimers, id);
  toastItems = [...toastItems.filter((existing) => existing.id !== id), item];
  emitToastUpdate();
  scheduleAutoDismiss(id, duration);

  return id;
}

function dismissToast(id?: ToastId) {
  const ids = id === undefined ? toastItems.map((item) => item.id) : [id];
  const idsToDismiss = new Set(ids);
  let changed = false;

  toastItems = toastItems.map((item) => {
    if (!idsToDismiss.has(item.id) || item.state === "exiting") {
      return item;
    }

    changed = true;
    clearTimer(autoDismissTimers, item.id);
    scheduleRemoval(item.id);
    return { ...item, state: "exiting" };
  });

  if (changed) {
    emitToastUpdate();
  }
}

function clearToasts() {
  for (const id of autoDismissTimers.keys()) {
    clearTimer(autoDismissTimers, id);
  }

  for (const id of removalTimers.keys()) {
    clearTimer(removalTimers, id);
  }

  if (!toastItems.length) return;
  toastItems = [];
  emitToastUpdate();
}

function subscribeToasts(listener: ToastListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getToastSnapshot() {
  return toastItems;
}

export const toast = {
  success(message: string, options?: ToastOptions) {
    return showToast("success", message, options);
  },
  error(message: string, options?: ToastOptions) {
    return showToast("error", message, options);
  },
  warning(message: string, options?: ToastOptions) {
    return showToast("warning", message, options);
  },
  info(message: string, options?: ToastOptions) {
    return showToast("info", message, options);
  },
  dismiss: dismissToast,
  clear: clearToasts,
  subscribe: subscribeToasts,
  getSnapshot: getToastSnapshot,
};
