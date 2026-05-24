export type RuntimeConnectionStatus = "connecting" | "ready" | "error" | "closed";

export type RuntimeConnectionSnapshot = {
  providerId: string;
  cwd: string;
  status: RuntimeConnectionStatus;
  runtimeConnectionId?: string;
  activeSessionCount?: number;
  pendingSessionCount?: number;
  lastError?: string;
};

export type RuntimeLifecycleEventType =
  | "connection-open"
  | "connection-reuse"
  | "connection-pending"
  | "connection-replace"
  | "connection-reconnect";

export type RuntimeLifecycleEvent = {
  type: RuntimeLifecycleEventType;
  providerId: string;
  cwd: string;
  key: string;
  sessionId?: string;
};
