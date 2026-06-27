import type { AcpAgentProvider, AgentMessage, SessionReasoningEffort, WorktreeSummary } from "@tiller/shared";
import { AcpConnection, type AcpConnectionOptions, type AcpSessionRuntimeHandle, type OpenAcpSessionRequest } from "./lifecycle";
import { resolveAcpConnectionKey, type AcpConnectionKey } from "./key";
import type { AcpConnectionInventoryItem } from "./types";

export type AcpConnectionLifecycleEvent = {
  type:
    | "connection-open"
    | "connection-reuse"
    | "connection-pending"
    | "connection-replace"
    | "connection-reconnect";
  key: AcpConnectionKey;
  providerId: string;
  cwd: string;
  sessionId?: string;
};

export type ManagedAcpConnection = {
  inventory(): AcpConnectionInventoryItem;
  dispose(): Promise<void>;
  openOrCreateSession(request: OpenAcpSessionRequest): Promise<AcpSessionRuntimeHandle>;
};

export type AcpConnectionManagerOptions = {
  openConnection?: (options: AcpConnectionOptions) => Promise<ManagedAcpConnection>;
};

export type OpenManagedConnectionOptions = {
  provider: AcpAgentProvider;
  worktree: WorktreeSummary;
  sessionConfig?: AcpConnectionOptions["sessionConfig"];
  protocolLogging?: AcpConnectionOptions["protocolLogging"];
  onLifecycleEvent?: (event: AcpConnectionLifecycleEvent) => void;
  sessionId?: string;
};

export type OpenManagedSessionOptions = OpenManagedConnectionOptions & {
  sessionId: string;
  restore?: {
    runtimeSessionId: string;
    strategy: "load" | "resume";
    replayBaselineMessages?: AgentMessage[];
  };
  onEvent: OpenAcpSessionRequest["onEvent"];
  onRestoreReplayEvent?: OpenAcpSessionRequest["onEvent"];
};

export function createAcpConnectionManager(options: AcpConnectionManagerOptions = {}) {
  const openConnection = options.openConnection ?? AcpConnection.open;
  const connections = new Map<AcpConnectionKey, ManagedAcpConnection>();
  const pendingConnections = new Map<AcpConnectionKey, Promise<ManagedAcpConnection>>();

  async function openManagedConnection(params: OpenManagedConnectionOptions) {
    const key = resolveAcpConnectionKey(params);
    const emit = (type: AcpConnectionLifecycleEvent["type"]) => {
      params.onLifecycleEvent?.({
        type,
        key,
        providerId: params.provider.id,
        cwd: params.worktree.path,
        sessionId: params.sessionId,
      });
    };
    const existing = connections.get(key);
    if (existing) {
      const status = existing.inventory().status;
      if (status !== "closed" && status !== "error") {
        emit("connection-reuse");
        return existing;
      }
      emit("connection-replace");
      connections.delete(key);
    }

    const pending = pendingConnections.get(key);
    if (pending) {
      emit("connection-pending");
      return pending;
    }

    emit("connection-open");
    const promise = openConnection(params)
      .then((connection) => {
        pendingConnections.delete(key);
        connections.set(key, connection);
        return connection;
      })
      .catch((error) => {
        pendingConnections.delete(key);
        throw error;
      });
    pendingConnections.set(key, promise);
    return promise;
  }

  async function reconnect(params: OpenManagedConnectionOptions) {
    const key = resolveAcpConnectionKey(params);
    params.onLifecycleEvent?.({
      type: "connection-reconnect",
      key,
      providerId: params.provider.id,
      cwd: params.worktree.path,
      sessionId: params.sessionId,
    });
    const pending = pendingConnections.get(key);
    pendingConnections.delete(key);
    if (pending) {
      try {
        const connection = await pending;
        await connection.dispose();
      } catch {
        // Ignore failed pending opens; reconnect will open a fresh connection below.
      }
    }
    const existing = connections.get(key);
    connections.delete(key);
    if (existing) {
      await existing.dispose();
    }
    return openManagedConnection(params);
  }

  async function openSession(params: OpenManagedSessionOptions) {
    const connection = await openManagedConnection(params);
    const request: OpenAcpSessionRequest = params.restore
      ? {
          tillerSessionId: params.sessionId,
          worktree: params.worktree,
          kind: params.restore.strategy,
          runtimeSessionId: params.restore.runtimeSessionId,
          onEvent: params.onEvent,
        }
      : {
          tillerSessionId: params.sessionId,
          worktree: params.worktree,
          kind: "new",
          onEvent: params.onEvent,
        };
    return connection.openOrCreateSession(request);
  }

  function listInventory() {
    return Array.from(connections.values()).map((connection) => connection.inventory());
  }

  async function disposeAll() {
    const cached = Array.from(connections.values());
    const pending = Array.from(pendingConnections.entries());
    connections.clear();
    pendingConnections.clear();

    await Promise.allSettled([
      ...cached.map((connection) => connection.dispose()),
      ...pending.map(async ([key, connectionPromise]) => {
        try {
          const connection = await connectionPromise;
          await connection.dispose();
          connections.delete(key);
        } catch {
          // Ignore failed pending opens; shutdown is best-effort cleanup.
        }
      }),
    ]);
  }

  return {
    openConnection: openManagedConnection,
    reconnect,
    openSession,
    listInventory,
    disposeAll,
  };
}
