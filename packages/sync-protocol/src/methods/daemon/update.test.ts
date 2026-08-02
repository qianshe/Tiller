import assert from "node:assert/strict";
import test from "node:test";
import * as updateCheck from "./update-check";
import * as updateStart from "./update-start";

test("daemon/update/check accepts optional force and returns version state", () => {
  assert.equal(updateCheck.method, "daemon/update/check");
  assert.deepEqual(updateCheck.ParamsSchema.parse({}), {});
  assert.deepEqual(updateCheck.ParamsSchema.parse({ force: true }), { force: true });
  assert.deepEqual(updateCheck.ResultSchema.parse({
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    updateAvailable: true,
    canUpdate: true,
    checkStatus: "checked",
    checkedAt: "2026-08-02T00:00:00.000Z",
  }), {
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    updateAvailable: true,
    canUpdate: true,
    checkStatus: "checked",
    checkedAt: "2026-08-02T00:00:00.000Z",
  });
});

test("daemon/update/start has an empty request and explicit outcome", () => {
  assert.equal(updateStart.method, "daemon/update/start");
  assert.deepEqual(updateStart.ParamsSchema.parse({}), {});
  assert.deepEqual(updateStart.ResultSchema.parse({
    status: "restarting",
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    message: "Helm 正在安装更新并重启。",
  }), {
    status: "restarting",
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    message: "Helm 正在安装更新并重启。",
  });
});
