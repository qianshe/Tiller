import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { createHandlerNotificationContext } from "../app/handler-context/notification.js";
import {
  attachHelmRpcConnection,
  createHelmOutboundConnectionRegistry,
} from "../app/transport-composition.js";
import type { HelmHandlerContext } from "../handlers/context.js";
import type { SessionSummary } from "@tiller/shared";
import { broadcastConversationUpdate, broadcastSessionUpdate } from "./notifications.js";

type JsonRpcNotification = {
  id?: string | number | null;
  result?: unknown;
  error?: unknown;
  method?: string;
  params?: {
    sessionId?: string;
    kind?: string;
    clearedAt?: string;
    preparation?: { id?: string };
    update?: {
      kind?: string;
      session?: { id?: string; status?: string; completionAcknowledgedAt?: string };
    };
  };
};

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      socket.off("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      socket.off("open", onOpen);
      reject(error);
    };
    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}

function decodeMessage(data: WebSocket.RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(data)).toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: JsonRpcNotification) => boolean,
  timeoutMs = 1000,
): Promise<JsonRpcNotification> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      let message: JsonRpcNotification;
      try {
        message = JSON.parse(decodeMessage(data)) as JsonRpcNotification;
      } catch {
        return;
      }
      if (!predicate(message)) {
        return;
      }
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function closeSocket(socket: WebSocket | undefined): Promise<void> {
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    socket.once("close", () => resolve());
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.terminate();
    } else {
      socket.close();
    }
  });
}

function waitForConnectionCount(
  getCount: () => number,
  expectedCount: number,
  timeoutMs = 1000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (getCount() >= expectedCount) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("Timed out waiting for WebSocket connection"));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

test("global lifecycle updates reach unsubscribed WebSocket clients", async () => {
  const connectedSockets = new Map<WebSocket, string>();
  const topicSubscribers = new Map<string, Set<string>>();
  const outboundConnections = createHelmOutboundConnectionRegistry();
  const errors: string[] = [];
  const connectionIds: string[] = [];
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  let nextSocketId = 0;

  const notificationContext = createHandlerNotificationContext({
    authenticatedSockets: {
      listAll: () => [...connectedSockets.entries()].map(([socket, socketId]) => ({
        socket,
        socketId,
      })),
    },
    getSocketId: (socket) => connectedSockets.get(socket),
    outboundConnections,
    sessionTopics: {
      subscribe: (socketId, sessionId) => {
        const subscribers = topicSubscribers.get(sessionId) ?? new Set<string>();
        subscribers.add(socketId);
        topicSubscribers.set(sessionId, subscribers);
      },
      unsubscribe: (socketId, sessionId) => {
        topicSubscribers.get(sessionId)?.delete(socketId);
      },
      removeSocket: (socketId) => {
        for (const subscribers of topicSubscribers.values()) {
          subscribers.delete(socketId);
        }
      },
      listSubscribers: (sessionId) => [...(topicSubscribers.get(sessionId) ?? [])],
    },
  });

  server.on("connection", (socket) => {
    const socketId = `socket-${++nextSocketId}`;
    connectionIds.push(socketId);
    connectedSockets.set(socket, socketId);
    attachHelmRpcConnection({
      socket,
      getSocketId: (target) => connectedSockets.get(target),
      outboundConnections,
      createHandlerContext: () => ({}) as HelmHandlerContext,
      logError: (message) => errors.push(message),
    });
    socket.once("close", () => {
      connectedSockets.delete(socket);
      notificationContext.removeSocketSessionTopics(socketId);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `ws://127.0.0.1:${address.port}`;
  let webSocket: WebSocket | undefined;
  let secondClient: WebSocket | undefined;

  try {
    webSocket = new WebSocket(url);
    await waitForOpen(webSocket);
    await waitForConnectionCount(() => connectionIds.length, 1);

    secondClient = new WebSocket(url);
    await waitForOpen(secondClient);
    await waitForConnectionCount(() => connectionIds.length, 2);

    const webSocketId = connectionIds[0];
    assert.ok(webSocketId);
    notificationContext.subscribeSessionTopic(webSocketId, "session-1");

    const lifecycle = {
      kind: "session_updated",
      session: { id: "session-1", status: "idle" },
    } as const;
    const webLifecycle = waitForMessage(
      webSocket,
      (message) => message.params?.update?.kind === "session_updated",
    );
    const secondClientLifecycle = waitForMessage(
      secondClient,
      (message) => message.params?.update?.kind === "session_updated",
    );
    broadcastSessionUpdate(notificationContext as unknown as HelmHandlerContext, "session-1", lifecycle);

    for (const message of await Promise.all([webLifecycle, secondClientLifecycle])) {
      assert.equal(message.method, "session/update");
      assert.equal(message.params?.sessionId, "session-1");
      assert.deepEqual(message.params?.update, lifecycle);
    }

    const preparationUpdate = {
      kind: "preparation_updated",
      preparation: {
        id: "preparation-1",
        content: "Prepare globally",
        revision: 1,
        createdAt: "2026-08-11T00:00:00.000Z",
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
    } as const;
    const webPreparation = waitForMessage(
      webSocket,
      (message) => message.method === "conversation/update",
    );
    const secondClientPreparation = waitForMessage(
      secondClient,
      (message) => message.method === "conversation/update",
    );
    broadcastConversationUpdate(
      notificationContext as unknown as HelmHandlerContext,
      preparationUpdate,
    );

    for (const message of await Promise.all([webPreparation, secondClientPreparation])) {
      assert.equal(message.params?.kind, "preparation_updated");
      assert.equal(message.params?.preparation?.id, "preparation-1");
    }

    const liveState = {
      kind: "live_state",
      snapshot: {
        sequence: 2,
        status: {
          runtimeStatus: "running",
          effectiveStatus: "running",
          pendingApprovalCount: 0,
        },
      },
    } as const;
    const webLiveState = waitForMessage(
      webSocket,
      (message) => message.params?.update?.kind === "live_state",
    );
    const secondClientLiveState = waitForMessage(
      secondClient,
      (message) => message.params?.update?.kind === "live_state",
      250,
    );
    broadcastSessionUpdate(notificationContext as unknown as HelmHandlerContext, "session-1", liveState);

    const webLiveMessage = await webLiveState;
    assert.deepEqual(webLiveMessage.params?.update, liveState);
    await assert.rejects(secondClientLiveState, /Timed out waiting for WebSocket message/);
    assert.deepEqual(errors, []);
  } finally {
    await Promise.all([closeSocket(webSocket), closeSocket(secondClient)]);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("completion acknowledgement RPC persists in Helm and reaches every WebSocket client", async () => {
  const connectedSockets = new Map<WebSocket, string>();
  const topicSubscribers = new Map<string, Set<string>>();
  const outboundConnections = createHelmOutboundConnectionRegistry();
  const connectionIds: string[] = [];
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  let nextSocketId = 0;
  const completedAt = "2026-08-15T01:00:00.000Z";
  let persisted: SessionSummary = {
    id: "session-1",
    projectId: "project-1",
    projectName: "Project",
    helmId: "local-helm",
    cwd: "D:/repo",
    worktreeName: "main",
    agentId: "codex",
    agentName: "Codex",
    status: "idle" as const,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: completedAt,
    lastCompletedAt: completedAt,
    messageCount: 1,
  };
  const sessionRecord = { summary: persisted };
  const notificationContext = createHandlerNotificationContext({
    authenticatedSockets: {
      listAll: () => [...connectedSockets.entries()].map(([socket, socketId]) => ({
        socket,
        socketId,
      })),
    },
    getSocketId: (socket) => connectedSockets.get(socket),
    outboundConnections,
    sessionTopics: {
      subscribe: (socketId, sessionId) => {
        const subscribers = topicSubscribers.get(sessionId) ?? new Set<string>();
        subscribers.add(socketId);
        topicSubscribers.set(sessionId, subscribers);
      },
      unsubscribe: (socketId, sessionId) => topicSubscribers.get(sessionId)?.delete(socketId),
      removeSocket: (socketId) => {
        for (const subscribers of topicSubscribers.values()) subscribers.delete(socketId);
      },
      listSubscribers: (sessionId) => [...(topicSubscribers.get(sessionId) ?? [])],
    },
  });
  const context = {
    ...notificationContext,
    sessions: new Map([["session-1", sessionRecord]]),
    sessionStore: { get: () => persisted },
    updateSessionSummary: (_sessionId: string, mutate: (summary: SessionSummary) => SessionSummary) => {
      persisted = mutate(persisted);
      sessionRecord.summary = persisted;
      return persisted;
    },
  } as unknown as HelmHandlerContext;

  server.on("connection", (socket) => {
    const socketId = `socket-${++nextSocketId}`;
    connectionIds.push(socketId);
    connectedSockets.set(socket, socketId);
    attachHelmRpcConnection({
      socket,
      getSocketId: (target) => connectedSockets.get(target),
      outboundConnections,
      createHandlerContext: () => context,
      logError: () => undefined,
    });
    socket.once("close", () => {
      connectedSockets.delete(socket);
      notificationContext.removeSocketSessionTopics(socketId);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `ws://127.0.0.1:${address.port}`;
  let sourceClient: WebSocket | undefined;
  let peerClient: WebSocket | undefined;

  try {
    sourceClient = new WebSocket(url);
    peerClient = new WebSocket(url);
    await Promise.all([waitForOpen(sourceClient), waitForOpen(peerClient)]);
    await waitForConnectionCount(() => connectionIds.length, 2);

    const sourceResponse = waitForMessage(sourceClient, (message) => message.id === 1);
    const sourceUpdate = waitForMessage(
      sourceClient,
      (message) => message.method === "session/update" && message.params?.update?.kind === "session_updated",
    );
    const peerUpdate = waitForMessage(
      peerClient,
      (message) => message.method === "session/update" && message.params?.update?.kind === "session_updated",
    );
    sourceClient.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "session/acknowledge_completion",
      params: { sessionId: "session-1", completedAt },
    }));

    const response = await sourceResponse;
    assert.deepEqual(response.result, { ok: true });
    assert.equal(persisted.completionAcknowledgedAt, completedAt);
    for (const update of await Promise.all([sourceUpdate, peerUpdate])) {
      assert.equal(update.params?.sessionId, "session-1");
      assert.equal(update.params?.update?.session?.completionAcknowledgedAt, completedAt);
    }
  } finally {
    await Promise.all([closeSocket(sourceClient), closeSocket(peerClient)]);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("notification clear RPC removes history and reaches every WebSocket client", async () => {
  const connectedSockets = new Map<WebSocket, string>();
  const topicSubscribers = new Map<string, Set<string>>();
  const outboundConnections = createHelmOutboundConnectionRegistry();
  const connectionIds: string[] = [];
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  let nextSocketId = 0;
  const clearedAt = "2026-08-15T02:00:00.000Z";
  const notificationStore = {
    list: () => [],
    clear: () => clearedAt,
    getClearedAt: () => clearedAt,
  };
  const notificationContext = createHandlerNotificationContext({
    authenticatedSockets: {
      listAll: () => [...connectedSockets.entries()].map(([socket, socketId]) => ({
        socket,
        socketId,
      })),
    },
    getSocketId: (socket) => connectedSockets.get(socket),
    outboundConnections,
    sessionTopics: {
      subscribe: (socketId, sessionId) => {
        const subscribers = topicSubscribers.get(sessionId) ?? new Set<string>();
        subscribers.add(socketId);
        topicSubscribers.set(sessionId, subscribers);
      },
      unsubscribe: (socketId, sessionId) => topicSubscribers.get(sessionId)?.delete(socketId),
      removeSocket: (socketId) => {
        for (const subscribers of topicSubscribers.values()) subscribers.delete(socketId);
      },
      listSubscribers: (sessionId) => [...(topicSubscribers.get(sessionId) ?? [])],
    },
  });
  const context = {
    ...notificationContext,
    notificationStore,
  } as unknown as HelmHandlerContext;

  server.on("connection", (socket) => {
    const socketId = `socket-${++nextSocketId}`;
    connectionIds.push(socketId);
    connectedSockets.set(socket, socketId);
    attachHelmRpcConnection({
      socket,
      getSocketId: (target) => connectedSockets.get(target),
      outboundConnections,
      createHandlerContext: () => context,
      logError: () => undefined,
    });
    socket.once("close", () => {
      connectedSockets.delete(socket);
      notificationContext.removeSocketSessionTopics(socketId);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `ws://127.0.0.1:${address.port}`;
  let sourceClient: WebSocket | undefined;
  let peerClient: WebSocket | undefined;

  try {
    sourceClient = new WebSocket(url);
    peerClient = new WebSocket(url);
    await Promise.all([waitForOpen(sourceClient), waitForOpen(peerClient)]);
    await waitForConnectionCount(() => connectionIds.length, 2);

    const sourceResponse = waitForMessage(sourceClient, (message) => message.id === 1);
    const sourceCleared = waitForMessage(
      sourceClient,
      (message) => message.method === "notification/cleared",
    );
    const peerCleared = waitForMessage(
      peerClient,
      (message) => message.method === "notification/cleared",
    );
    sourceClient.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "notification/clear",
      params: {},
    }));

    assert.deepEqual((await sourceResponse).result, { ok: true, clearedAt });
    for (const message of await Promise.all([sourceCleared, peerCleared])) {
      assert.equal(message.method, "notification/cleared");
      assert.deepEqual(message.params, { clearedAt });
    }
  } finally {
    await Promise.all([closeSocket(sourceClient), closeSocket(peerClient)]);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
