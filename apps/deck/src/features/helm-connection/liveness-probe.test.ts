import assert from "node:assert/strict";
import test from "node:test";
import {
  createHelmLivenessRequestProbe,
  startHelmLivenessProbe,
} from "./liveness-probe.js";

function createManualInterval() {
  let handler: (() => void) | undefined;
  let cleared = false;
  return {
    tick: () => handler?.(),
    get cleared() {
      return cleared;
    },
    setInterval: (next: () => void) => {
      handler = next;
      return "timer";
    },
    clearInterval: () => {
      cleared = true;
    },
  };
}

test("startHelmLivenessProbe stays quiet while the Helm answers", async () => {
  const timer = createManualInterval();
  const deaths: string[] = [];

  startHelmLivenessProbe({
    probe: async () => undefined,
    onDead: (reason) => deaths.push(reason),
    setInterval: timer.setInterval,
    clearInterval: timer.clearInterval,
  });

  timer.tick();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(deaths, []);
});

test("startHelmLivenessProbe reports a dead connection when the probe rejects", async () => {
  // 半开连接下 socket.readyState 仍是 OPEN,只有真正发一次请求才能发现它已死。
  const timer = createManualInterval();
  const deaths: string[] = [];

  startHelmLivenessProbe({
    probe: async () => {
      throw new Error("Request timed out");
    },
    onDead: (reason) => deaths.push(reason),
    setInterval: timer.setInterval,
    clearInterval: timer.clearInterval,
  });

  timer.tick();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(deaths, ["Request timed out"]);
});

test("startHelmLivenessProbe stops probing once the connection is declared dead", async () => {
  const timer = createManualInterval();
  let probeCount = 0;

  startHelmLivenessProbe({
    probe: async () => {
      probeCount += 1;
      throw new Error("dead");
    },
    onDead: () => undefined,
    setInterval: timer.setInterval,
    clearInterval: timer.clearInterval,
  });

  timer.tick();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  timer.tick();
  await Promise.resolve();

  assert.equal(probeCount, 1);
  assert.equal(timer.cleared, true);
});

test("startHelmLivenessProbe does not overlap probes when one is still in flight", async () => {
  const timer = createManualInterval();
  let probeCount = 0;
  let release: (() => void) | undefined;

  startHelmLivenessProbe({
    probe: () =>
      new Promise<void>((resolve) => {
        probeCount += 1;
        release = resolve;
      }),
    onDead: () => undefined,
    setInterval: timer.setInterval,
    clearInterval: timer.clearInterval,
  });

  timer.tick();
  timer.tick();
  timer.tick();

  assert.equal(probeCount, 1);

  release?.();
  await Promise.resolve();
  await Promise.resolve();
  timer.tick();

  assert.equal(probeCount, 2);
});

test("startHelmLivenessProbe stops probing after it is disposed", async () => {
  const timer = createManualInterval();
  let probeCount = 0;

  const dispose = startHelmLivenessProbe({
    probe: async () => {
      probeCount += 1;
    },
    onDead: () => undefined,
    setInterval: timer.setInterval,
    clearInterval: timer.clearInterval,
  });

  dispose();
  timer.tick();

  assert.equal(probeCount, 0);
  assert.equal(timer.cleared, true);
});

test("createHelmLivenessRequestProbe treats an answered error as proof the link is alive", async () => {
  // 配对流程里 socket 已 open 但尚未认证,Helm 会拒绝 helm/list。
  // 那是一次回应,不是断线——把它当死连接会直接掐断配对。
  const probe = createHelmLivenessRequestProbe({
    request: async () => {
      throw { code: -32600, message: "Helm not authenticated yet." };
    },
  });

  await probe();
});

test("createHelmLivenessRequestProbe rejects when the Helm never answers", async () => {
  const probe = createHelmLivenessRequestProbe({
    request: async () => {
      throw {
        code: -32603,
        message: "Request timeout: helm/list",
        data: { reason: "request-timeout" },
      };
    },
  });

  await assert.rejects(probe());
});

test("createHelmLivenessRequestProbe resolves on a normal answer", async () => {
  const probe = createHelmLivenessRequestProbe({
    request: async () => ({ helms: [] }),
  });

  await probe();
});
