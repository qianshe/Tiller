import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createUpdateService, UpdateServiceError } from "./service.js";

function launch() {
  return {
    updaterPath: "D:/tiller/updater.js",
    nodeExecutable: "node.exe",
    helmEntryPath: "D:/tiller/index.js",
    helmArgs: [],
    cwd: "D:/tiller",
    env: {},
    parentPid: 1,
    host: "127.0.0.1",
    port: 47631,
    logPath: "D:/tiller/update.log",
  };
}

function makeService(overrides: Partial<Parameters<typeof createUpdateService>[0]> = {}) {
  const statuses: Array<Record<string, unknown>> = [];
  const service = createUpdateService({
    currentVersion: "1.0.0",
    config: { updates: { checkOnStart: true, previewHint: true } },
    env: {},
    host: "127.0.0.1",
    port: 47631,
    isPublishedRuntime: true,
    logPath: "D:/tiller/update.log",
    updaterLaunch: launch(),
    loadVersions: async () => ({ current: "1.0.0", latest: "1.1.0" }),
    requestShutdown: () => undefined,
    emitStatus: (status) => statuses.push(status),
    ...overrides,
  });
  return { service, statuses };
}

test("service reports latest version and update capability for a local published Helm", async () => {
  const { service, statuses } = makeService();
  const result = await service.check(true, true);

  assert.equal(result.updateAvailable, true);
  assert.equal(result.canUpdate, true);
  assert.equal(result.latestVersion, "1.1.0");
  assert.equal(statuses.at(-1)?.status, "available");
  assert.equal(statuses.at(-1)?.canUpdate, true);
});

test("service can scope progress notifications to the requesting connection", async () => {
  const { service, statuses } = makeService();
  const scopedStatuses: Array<Record<string, unknown>> = [];

  await service.check(true, true, (status) => scopedStatuses.push(status));

  assert.equal(statuses.length, 0);
  assert.equal(scopedStatuses.at(-1)?.status, "available");
  assert.equal(scopedStatuses.at(-1)?.canUpdate, true);
});

test("service keeps remote and source Helms read-only", async () => {
  const remote = makeService();
  const remoteResult = await remote.service.check(true, false);
  assert.equal(remoteResult.canUpdate, false);
  assert.equal(remoteResult.cannotUpdateReason, "远程 Helm 不支持自动更新");

  const source = makeService({ isPublishedRuntime: false });
  const sourceResult = await source.service.check(true, true);
  assert.equal(sourceResult.canUpdate, false);
  assert.equal(sourceResult.checkStatus, "unsupported");
  assert.equal(sourceResult.cannotUpdateReason, "当前 Helm 不是发布包运行实例");
});

test("disabling startup checks does not disable forced manual checks", async () => {
  let calls = 0;
  const { service } = makeService({
    env: { TILLER_UPDATE_CHECK: "0" },
    loadVersions: async () => {
      calls += 1;
      return { current: "1.0.0", latest: "1.1.0" };
    },
  });

  const disabled = await service.check(false, true);
  assert.equal(disabled.checkStatus, "disabled");
  assert.equal(calls, 0);
  assert.equal((await service.check(true, true)).updateAvailable, true);
  assert.equal(calls, 1);
});

test("start refuses to run when latest cannot be checked", async () => {
  let spawned = false;
  const { service } = makeService({
    loadVersions: async () => {
      throw new Error("registry unavailable");
    },
    spawnUpdater: () => {
      spawned = true;
      return new EventEmitter() as never;
    },
  });

  await assert.rejects(
    service.start(true),
    (error: unknown) => {
      assert.ok(error instanceof UpdateServiceError);
      assert.equal(error.kind, "check-failed");
      return true;
    },
  );
  assert.equal(spawned, false);
});

test("start prevents a second updater for the same Helm", async () => {
  const updater = new EventEmitter();
  const { service } = makeService({
    spawnUpdater: () => updater as never,
  });

  const result = await service.start(true);
  assert.equal(result.status, "installing");
  await assert.rejects(
    service.start(true),
    (error: unknown) => {
      assert.ok(error instanceof UpdateServiceError);
      assert.equal(error.kind, "in-progress");
      return true;
    },
  );

  updater.emit("message", { kind: "shutdown" });
});

test("updater up-to-date status clears the restart target", async () => {
  const updater = new EventEmitter();
  const { service, statuses } = makeService({
    spawnUpdater: () => updater as never,
  });

  await service.start(true);
  updater.emit("message", {
    kind: "status",
    status: "up-to-date",
    message: "Helm 已是最新版本。",
  });

  assert.equal(statuses.at(-1)?.status, "up-to-date");
  assert.equal(statuses.at(-1)?.targetVersion, undefined);
  updater.emit("exit", 0);
});
