import assert from "node:assert/strict";
import test from "node:test";
import { installWebSocketHeartbeat } from "./websocket-heartbeat.js";

type Listener = () => void;

class FakeSocket {
  readyState = 1;
  pingCount = 0;
  terminated = false;
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  ping() {
    this.pingCount += 1;
  }

  terminate() {
    this.terminated = true;
  }

  emit(event: string) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener();
    }
  }
}

class FakeServer {
  readonly clients = new Set<FakeSocket>();
  private connectionListener: ((socket: FakeSocket) => void) | null = null;

  on(event: string, listener: (socket: FakeSocket) => void) {
    if (event === "connection") {
      this.connectionListener = listener;
    }
    return this;
  }

  connect(socket: FakeSocket) {
    this.clients.add(socket);
    this.connectionListener?.(socket);
  }
}

test("websocket heartbeat terminates sockets that miss a pong", () => {
  let tick: () => void = () => assert.fail("heartbeat interval was not installed");
  const server = new FakeServer();
  const stop = installWebSocketHeartbeat(server, {
    intervalMs: 1000,
    setInterval: (handler) => {
      tick = handler;
      return 1;
    },
    clearInterval: () => undefined,
  });
  const socket = new FakeSocket();

  server.connect(socket);
  tick?.();
  assert.equal(socket.pingCount, 1);
  assert.equal(socket.terminated, false);

  tick?.();
  assert.equal(socket.terminated, true);
  stop();
});

test("websocket heartbeat keeps sockets alive after pong", () => {
  let tick: () => void = () => assert.fail("heartbeat interval was not installed");
  const server = new FakeServer();
  const stop = installWebSocketHeartbeat(server, {
    intervalMs: 1000,
    setInterval: (handler) => {
      tick = handler;
      return 1;
    },
    clearInterval: () => undefined,
  });
  const socket = new FakeSocket();

  server.connect(socket);
  tick?.();
  socket.emit("pong");
  tick?.();

  assert.equal(socket.pingCount, 2);
  assert.equal(socket.terminated, false);
  stop();
});
