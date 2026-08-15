export type StoredNotificationKind = "error" | "warning" | "info";

export type StoredNotification = {
  id: string;
  kind: StoredNotificationKind;
  source: string;
  sessionId?: string;
  code?: string;
  message: string;
  occurredAt: string;
  details?: Record<string, string>;
};

export type NotificationStore = {
  append: (notification: Omit<StoredNotification, "id"> & { id?: string }) => StoredNotification;
  list: (options?: { limit?: number }) => StoredNotification[];
  clear?: () => string;
  getClearedAt?: () => string | null;
};
