import type { StateCreator } from "zustand";

export type DeckNotificationKind = "error" | "warning" | "info";

export type DeckNotification = {
  id: string;
  kind: DeckNotificationKind;
  message: string;
  source: string;
  code?: string;
  sessionId?: string;
  createdAt: string;
};

export type DeckNotificationInput = Omit<DeckNotification, "id" | "createdAt" | "source"> & {
  source?: string;
  createdAt?: string;
};

export const MAX_DECK_NOTIFICATIONS = 50;
const DUPLICATE_NOTIFICATION_WINDOW_MS = 5_000;

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
  return {
    ...(code ? { code } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
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
