import assert from "node:assert/strict";
import test from "node:test";
import { connectToDaemon } from "./sockets.js";

type WebSocketCtor = typeof WebSocket;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly listeners = new Map<string, Set<() => void>>();
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(event: string, handler: () => void) {
    const handlers = this.listeners.get(event) ?? new Set<() => void>();
    handlers.add(handler);
    this.listeners.set(event, handlers);
  }

  removeEventListener(event: string, handler: () => void) {
    this.listeners.get(event)?.delete(handler);
  }

  send() {
    // Not needed for this connection lifecycle test.
  }

  close() {
    this.closed = true;
  }

  emit(event: string) {
    for (const handler of this.listeners.get(event) ?? []) {
      handler();
    }
  }
}

function createContext() {
  const connectionStates: string[] = [];
  const helmStates: string[] = [];
  const storage = new Map<string, string>();
  const localStorage = {
    length: 0,
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  } satisfies Storage;

  return {
    context: {
      embedded: false,
      location: { protocol: "http:", hostname: "127.0.0.1" } as Location,
      daemonHost: "127.0.0.1",
      daemonPort: "47631",
      defaultDaemonHost: "127.0.0.1",
      defaultDaemonPort: "47631",
      primaryHelmKeyRef: { current: null },
      manualDisconnectRef: { current: null },
      socketRef: { current: null },
      rpcClientRef: { current: null },
      setSessions: () => undefined,
      setStatuses: () => undefined,
      setMessages: () => undefined,
      setPermissionRequests: () => undefined,
      setOutputs: () => undefined,
      toolCallsRef: { current: {} },
      setToolCalls: () => undefined,
      setDiffs: () => undefined,
      setSessionConfigOptions: () => undefined,
      setTrustedDevices: () => undefined,
      setActiveSessionId: () => undefined,
      setSelectedProjectId: () => undefined,
      setResumeFeedback: () => undefined,
      setDebugTrace: () => undefined,
      setHelmConnectionState: (_helmKey: string, state: string) => helmStates.push(state),
      setConnection: (state: string) => connectionStates.push(state),
      setConnectFeedback: () => undefined,
      copy: {
        connectFeedbackConnecting: "connecting",
        connectFeedbackIdle: "idle",
        pairingFeedbackIdle: "pairing idle",
      },
      setPairingState: () => undefined,
      setPairingCodeInput: () => undefined,
      setPairingFeedback: () => undefined,
      pairingState: "idle",
      setTrustedDevice: () => undefined,
      readTrustedDeviceCache: () => null,
      dispatch: () => undefined,
      requestInitialSync: () => undefined,
      lastFilesScopeKeyRef: { current: null },
      handleRpcResult: () => undefined,
      handleRpcNotification: () => undefined,
    },
    connectionStates,
    helmStates,
    installWindow() {
      const previousWindow = globalThis.window;
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { localStorage },
      });
      return () => {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: previousWindow,
        });
      };
    },
  };
}

test("stale socket close does not mark a newer daemon connection disconnected", () => {
  const previousWebSocket = globalThis.WebSocket;
  (globalThis as typeof globalThis & { WebSocket: WebSocketCtor }).WebSocket = FakeWebSocket as unknown as WebSocketCtor;
  FakeWebSocket.instances = [];
  const setup = createContext();
  const restoreWindow = setup.installWindow();

  try {
    connectToDaemon(undefined, { preserveState: true }, setup.context as never);
    const staleSocket = FakeWebSocket.instances[0];
    assert.ok(staleSocket);

    connectToDaemon(undefined, { preserveState: true }, setup.context as never);
    assert.equal(FakeWebSocket.instances.length, 2);
    assert.equal(staleSocket.closed, true);

    staleSocket.emit("close");

    assert.deepEqual(connectionStatesTail(setup.connectionStates, 2), ["connecting", "connecting"]);
    assert.equal(setup.helmStates.at(-1), "connecting");
  } finally {
    restoreWindow();
    globalThis.WebSocket = previousWebSocket;
  }
});

test("daemon reconnect reset clears session plans with other session-scoped state", () => {
  const previousWebSocket = globalThis.WebSocket;
  (globalThis as typeof globalThis & { WebSocket: WebSocketCtor }).WebSocket = FakeWebSocket as unknown as WebSocketCtor;
  FakeWebSocket.instances = [];
  const setup = createContext();
  const restoreWindow = setup.installWindow();
  const planResets: unknown[] = [];

  try {
    connectToDaemon(undefined, { preserveState: false }, {
      ...setup.context,
      setSessionPlans: (next: unknown) => planResets.push(next),
    } as never);

    assert.deepEqual(planResets, [{}]);
  } finally {
    restoreWindow();
    globalThis.WebSocket = previousWebSocket;
  }
});

function connectionStatesTail(states: string[], count: number) {
  return states.slice(Math.max(states.length - count, 0));
}
