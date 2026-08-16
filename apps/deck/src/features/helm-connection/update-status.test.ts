import assert from "node:assert/strict";
import test from "node:test";
import { resolveHelmUpdateStatus } from "./update-status";

test("up-to-date status clears a stale restart target", () => {
  const resolved = resolveHelmUpdateStatus(
    {
      status: "up-to-date",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      canUpdate: true,
      checkStatus: "checked",
      message: "Helm 已是最新版本。",
    },
    {
      status: "restarting",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      targetVersion: "1.1.0",
      updateAvailable: false,
      canUpdate: true,
    },
    "1.1.0",
  );

  assert.equal(resolved.update.status, "up-to-date");
  assert.equal(resolved.update.targetVersion, undefined);
  assert.equal(resolved.update.updateAvailable, false);
  assert.deepEqual(resolved.intent, { kind: "clear" });
});

test("installing status remains visible while a restart target is pending", () => {
  const resolved = resolveHelmUpdateStatus(
    {
      status: "installing",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      targetVersion: "1.1.0",
      canUpdate: true,
      checkStatus: "checked",
      message: "正在安装更新。",
    },
    undefined,
  );

  assert.equal(resolved.update.status, "installing");
  assert.equal(resolved.update.targetVersion, "1.1.0");
  assert.deepEqual(resolved.intent, { kind: "write", targetVersion: "1.1.0" });
});

test("checking and available notifications do not start restart recovery during installation", () => {
  for (const status of ["checking", "available"] as const) {
    const resolved = resolveHelmUpdateStatus(
      {
        status,
        currentVersion: "1.0.0",
        latestVersion: "1.1.0",
        updateAvailable: true,
        canUpdate: true,
      },
      {
        status: "installing",
        currentVersion: "1.0.0",
        latestVersion: "1.1.0",
        targetVersion: "1.1.0",
        updateAvailable: false,
        canUpdate: true,
      },
      "1.1.0",
    );

    assert.equal(resolved.update.status, "installing");
    assert.equal(resolved.update.targetVersion, "1.1.0");
  }
});

test("restarting notification exits installation state", () => {
  const resolved = resolveHelmUpdateStatus(
    {
      status: "restarting",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      targetVersion: "1.1.0",
      canUpdate: true,
    },
    {
      status: "installing",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      targetVersion: "1.1.0",
      updateAvailable: false,
      canUpdate: true,
    },
    "1.1.0",
  );

  assert.equal(resolved.update.status, "restarting");
  assert.equal(resolved.update.targetVersion, "1.1.0");
});

test("stale restart state does not recreate an update intent", () => {
  const resolved = resolveHelmUpdateStatus(
    {
      status: "restarting",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
    },
    {
      status: "restarting",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      targetVersion: "1.1.0",
      updateAvailable: false,
      canUpdate: true,
    },
  );

  assert.equal(resolved.update.targetVersion, "1.1.0");
  assert.deepEqual(resolved.intent, { kind: "keep" });
});
