import type { StateCreator } from "zustand";

export type DeckNotificationKind = "error" | "warning" | "info";

export type DeckNotificationDetails = {
  phase?: string;
  helmKey?: string;
  method?: string;
  sessionId?: string;
  kind?: string;
  updateKind?: string;
  updateId?: string;
  errorName?: string;
  errorCode?: string;
  errorStack?: string;
  componentStack?: string;
};

export type DeckNotification = {
  id: string;
  kind: DeckNotificationKind;
  message: string;
  source: string;
  code?: string;
  sessionId?: string;
  details?: DeckNotificationDetails;
  createdAt: string;
};

export type DeckNotificationInput = Omit<DeckNotification, "id" | "createdAt" | "source"> & {
  source?: string;
  createdAt?: string;
};

export const MAX_DECK_NOTIFICATIONS = 50;
const DUPLICATE_NOTIFICATION_WINDOW_MS = 5_000;
const NOTIFICATION_DETAIL_KEYS: Array<keyof DeckNotificationDetails> = [
  "phase",
  "helmKey",
  "method",
  "sessionId",
  "kind",
  "updateKind",
  "updateId",
  "errorName",
  "errorCode",
  "errorStack",
  "componentStack",
];

export type NotificationsSlice = {
  notifications: DeckNotification[];
  addNotification: (input: DeckNotificationInput) => void;
  clearNotifications: () => void;
};

let notificationSequence = 0;

function createNotificationId() {
  notificationSequence += 1;
  return `notification-${Date.now()}-${notificationSequence}`;
}

function optionalNotificationContext(input: DeckNotificationInput) {
  const code = input.code?.trim();
  const sessionId = input.sessionId?.trim();
  const details = normalizeNotificationDetails(input.details);
  return {
    ...(code ? { code } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(details ? { details } : {}),
  };
}

function normalizeNotificationDetails(value: unknown): DeckNotificationDetails | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const details = {} as DeckNotificationDetails;
  for (const key of NOTIFICATION_DETAIL_KEYS) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) {
      details[key] = item;
    }
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const createNotificationsSlice: StateCreator<NotificationsSlice> = (set) => ({
  notifications: [],
  addNotification: (input) => {
    const message = input.message.trim();
    if (!message) {
      return;
    }
    set((state) => {
      const now = new Date();
      const source = input.source ?? "runtime";
      const context = optionalNotificationContext(input);
      const duplicateIndex = state.notifications.findIndex((notification) => {
        const age = now.getTime() - Date.parse(notification.createdAt);
        return notification.kind === input.kind
          && notification.source === source
          && notification.message === message
          && notification.sessionId === context.sessionId
          && age >= 0
          && age <= DUPLICATE_NOTIFICATION_WINDOW_MS;
      });
      if (duplicateIndex >= 0) {
        const existing = state.notifications[duplicateIndex] as DeckNotification;
        const merged: DeckNotification = {
          ...existing,
          ...context,
          id: existing.id,
          kind: input.kind,
          message,
          source,
          code: context.code ?? existing.code,
          ...(context.details
            ? { details: { ...existing.details, ...context.details } }
            : {}),
          createdAt: existing.createdAt,
        };
        return {
          notifications: [
            merged,
            ...state.notifications.filter((_notification, index) => index !== duplicateIndex),
          ],
        };
      }
      return {
        notifications: [
          {
            id: createNotificationId(),
            kind: input.kind,
            message,
            source,
            ...context,
            createdAt: input.createdAt ?? now.toISOString(),
          },
          ...state.notifications,
        ].slice(0, MAX_DECK_NOTIFICATIONS),
      };
    });
  },
  clearNotifications: () => set({ notifications: [] }),
});
