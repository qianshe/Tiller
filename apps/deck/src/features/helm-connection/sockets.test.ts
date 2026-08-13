import assert from "node:assert/strict";
import test from "node:test";
import { connectHelmSocket, connectToDaemon } from "./sockets.js";

type WebSocketCtor = typeof WebSocket;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly listeners = new Map<string, Set<() => void>>();
  closed = false;
  readyState = FakeWebSocket.CONNECTING;

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
    this.readyState = FakeWebSocket.CLOSED;
  }

  emit(event: string) {
    if (event === "open") {
      this.readyState = FakeWebSocket.OPEN;
    } else if (event === "close") {
      this.readyState = FakeWebSocket.CLOSED;
    }
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

test("auto reconnect reuses a daemon socket that is still connecting", () => {
  const previousWebSocket = globalThis.WebSocket;
  (globalThis as typeof globalThis & { WebSocket: WebSocketCtor }).WebSocket = FakeWebSocket as unknown as WebSocketCtor;
  FakeWebSocket.instances = [];
  const setup = createContext();
  const restoreWindow = setup.installWindow();

  try {
    connectToDaemon(undefined, { preserveState: true }, setup.context as never);
    const socket = FakeWebSocket.instances[0];
    assert.ok(socket);
    const statesBeforeAuto = [...setup.connectionStates];

    connectToDaemon(undefined, { auto: true, preserveState: true }, setup.context as never);

    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(socket.closed, false);
    // 自动重连复用 socket 时不得抖动前台连接状态：不应新增 connecting/connected。
    assert.deepEqual(setup.connectionStates, statesBeforeAuto);
  } finally {
    restoreWindow();
    globalThis.WebSocket = previousWebSocket;
  }
});

test("auto reconnect reuses an open daemon socket", () => {
  const previousWebSocket = globalThis.WebSocket;
  (globalThis as typeof globalThis & { WebSocket: WebSocketCtor }).WebSocket = FakeWebSocket as unknown as WebSocketCtor;
  FakeWebSocket.instances = [];
  const setup = createContext();
  const restoreWindow = setup.installWindow();

  const pairingStates: string[] = [];
  const codeInputs: string[] = [];
  const pairingsFeedback: string[] = [];

  try {
    connectToDaemon(undefined, { preserveState: true }, {
      ...setup.context,
      setPairingState: (state: string) => pairingStates.push(state),
      setPairingCodeInput: (value: string) => codeInputs.push(value),
      setPairingFeedback: (value: string) => pairingsFeedback.push(value),
    } as never);
    const socket = FakeWebSocket.instances[0];
    assert.ok(socket);
    socket.emit("open");
    const statesBeforeAuto = [...setup.connectionStates];
    // 首次手动连接 open 后已写下配对状态（idle -> paired）。
    const pairingStatesBeforeAuto = pairingStates.length;
    const codeInputsBeforeAuto = codeInputs.length;
    const feedbackBeforeAuto = pairingsFeedback.length;

    connectToDaemon(undefined, { auto: true, preserveState: true }, setup.context as never);

    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(socket.closed, false);
    // 自动重连复用 open socket 不得重置配对界面状态，也不得追加连接状态写入。
    assert.equal(pairingStates.length, pairingStatesBeforeAuto);
    assert.equal(codeInputs.length, codeInputsBeforeAuto);
    assert.equal(pairingsFeedback.length, feedbackBeforeAuto);
    assert.deepEqual(setup.connectionStates, statesBeforeAuto);
  } finally {
    restoreWindow();
    globalThis.WebSocket = previousWebSocket;
  }
});

test("auto reconnect keeps foreground disconnected while retrying and only turns connected on open", () => {
  const previousWebSocket = globalThis.WebSocket;
  (globalThis as typeof globalThis & { WebSocket: WebSocketCtor }).WebSocket = FakeWebSocket as unknown as WebSocketCtor;
  FakeWebSocket.instances = [];
  const setup = createContext();
  const restoreWindow = setup.installWindow();

  const pairingStates: string[] = [];
  const codeInputs: string[] = [];
  const pairingFeedbacks: string[] = [];

  try {
    const reconnectContext = {
      ...setup.context,
      setPairingState: (state: string) => pairingStates.push(state),
      setPairingCodeInput: (value: string) => codeInputs.push(value),
      setPairingFeedback: (value: string) => pairingFeedbacks.push(value),
    } as never;
    // 首次手动连接建立 socket。
    connectToDaemon(undefined, { preserveState: true }, reconnectContext);
    const firstSocket = FakeWebSocket.instances[0];
    assert.ok(firstSocket);

    // 断线后无打开 socket。
    firstSocket.emit("close");
    setup.connectionStates.length = 0;
    setup.helmStates.length = 0;
    const pairingStatesBeforeAuto = pairingStates.length;
    const codeInputsBeforeAuto = codeInputs.length;
    const feedbackBeforeAuto = pairingFeedbacks.length;

    // 第一次自动重连：新建 socket，保持前台 disconnected。
    connectToDaemon(undefined, { auto: true, preserveState: true }, reconnectContext);
    assert.equal(FakeWebSocket.instances.length, 2);
    assert.deepEqual(setup.connectionStates, []);
    assert.deepEqual(setup.helmStates, []);

    // 第二次自动重连（失败前）：仍应保持前台 disconnected，不写 connecting。
    connectToDaemon(undefined, { auto: true, preserveState: true }, reconnectContext);
    assert.deepEqual(setup.connectionStates, []);

    // 配对状态/输入/反馈在整个重连期间不被重置。
    assert.equal(pairingStates.length, pairingStatesBeforeAuto);
    assert.equal(codeInputs.length, codeInputsBeforeAuto);
    assert.equal(pairingFeedbacks.length, feedbackBeforeAuto);

    // socket open 后一次性切到 connected。
    const retrySocket = FakeWebSocket.instances[1]!;
    retrySocket.emit("open");
    assert.equal(setup.connectionStates.at(-1), "connected");
    assert.equal(setup.helmStates.at(-1), "connected");
  } finally {
    restoreWindow();
    globalThis.WebSocket = previousWebSocket;
  }
});

test("switching daemon endpoints replaces the socket without accepting its stale close", () => {
  const previousWebSocket = globalThis.WebSocket;
  (globalThis as typeof globalThis & { WebSocket: WebSocketCtor }).WebSocket = FakeWebSocket as unknown as WebSocketCtor;
  FakeWebSocket.instances = [];
  const setup = createContext();
  const restoreWindow = setup.installWindow();

  try {
    connectToDaemon(undefined, { preserveState: true }, setup.context as never);
    const staleSocket = FakeWebSocket.instances[0];
    assert.ok(staleSocket);

    connectToDaemon(undefined, {
      auto: true,
      host: "192.168.1.9",
      port: "47631",
      preserveState: true,
    }, setup.context as never);
    assert.equal(FakeWebSocket.instances.length, 2);
    assert.equal(staleSocket.closed, true);

    staleSocket.emit("close");

    // 切换端点由 auto 静默完成：替换 socket 但前台不写 connecting，旧 socket
    // 的 stale close 也不应覆盖前台状态（只保留首次手动连接的 connecting）。
    assert.deepEqual(connectionStatesTail(setup.connectionStates, 2), ["connecting"]);
    assert.equal(setup.helmStates.at(-1), "connecting");
  } finally {
    restoreWindow();
    globalThis.WebSocket = previousWebSocket;
  }
});

test("fleet connection reuses a socket that is still connecting", () => {
  const previousWebSocket = globalThis.WebSocket;
  (globalThis as typeof globalThis & { WebSocket: WebSocketCtor }).WebSocket = FakeWebSocket as unknown as WebSocketCtor;
  FakeWebSocket.instances = [];
  const setup = createContext();
  const restoreWindow = setup.installWindow();
  const helmSocketRefs = { current: new Map<string, WebSocket>() };
  const helmRpcClientRefs = { current: new Map() };
  const profile = {
    id: "local-helm",
    name: "Local Helm",
    host: "127.0.0.1",
    port: "47631",
  };
  const context = {
    embedded: false,
    location: setup.context.location,
    helmSocketRefs,
    helmRpcClientRefs,
    setHelmConnectionState: setup.context.setHelmConnectionState,
    setDaemonProfileMessage: () => undefined,
    readTrustedDeviceCache: () => null,
    requestInitialSync: () => undefined,
    dispatch: () => undefined,
    handleRpcResult: () => undefined,
    handleRpcNotification: () => undefined,
  };

  try {
    connectHelmSocket(profile, context as never);
    const socket = FakeWebSocket.instances[0];
    assert.ok(socket);

    connectHelmSocket(profile, context as never);

    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(socket.closed, false);
    assert.equal(setup.helmStates.at(-1), "connecting");

    socket.emit("open");
    connectHelmSocket(profile, context as never);

    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(socket.closed, false);
    assert.equal(setup.helmStates.at(-1), "connected");
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
