import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeUpdaterLaunch,
  waitForPortOpen,
  waitForPortRelease,
  waitForProcessExit,
} from "./updater-runtime.js";

test("encoded updater launch preserves startup arguments and fixed metadata", () => {
  const encoded = encodeUpdaterLaunch({
    updaterPath: "D:/tiller/updater.js",
    nodeExecutable: "node.exe",
    helmEntryPath: "D:/tiller/index.js",
    helmArgs: ["--host", "127.0.0.1", "--port", "47631"],
    cwd: "D:/tiller",
    env: { PATH: "path" },
    parentPid: 123,
    host: "127.0.0.1",
    port: 47631,
    logPath: "D:/tiller/update.log",
    currentVersion: "1.0.0",
    targetVersion: "1.1.0",
  });

  assert.equal(encoded.TILLER_UPDATE_PARENT_PID, "123");
  assert.equal(encoded.TILLER_UPDATE_NODE, "node.exe");
  assert.equal(encoded.TILLER_UPDATE_HELM_ENTRY, "D:/tiller/index.js");
  assert.deepEqual(JSON.parse(encoded.TILLER_UPDATE_HELM_ARGS ?? ""), ["--host", "127.0.0.1", "--port", "47631"]);
  assert.equal(encoded.TILLER_UPDATE_TARGET_VERSION, "1.1.0");
});

test("waitForProcessExit polls until the old process is gone", async () => {
  let aliveChecks = 0;
  let sleeps = 0;
  await waitForProcessExit(123, {
    isProcessAlive: () => {
      aliveChecks += 1;
      return aliveChecks < 3;
    },
    sleep: async () => {
      sleeps += 1;
    },
  });

  assert.equal(aliveChecks, 3);
  assert.equal(sleeps, 2);
});

test("waitForPortRelease polls until the listener is closed", async () => {
  let openChecks = 0;
  await waitForPortRelease("0.0.0.0", 47631, {
    isPortOpen: async (host, port) => {
      assert.equal(host, "127.0.0.1");
      assert.equal(port, 47631);
      openChecks += 1;
      return openChecks < 3;
    },
    sleep: async () => undefined,
  });

  assert.equal(openChecks, 3);
});

test("waitForPortOpen polls until the replacement listener is ready", async () => {
  let openChecks = 0;
  await waitForPortOpen("0.0.0.0", 47631, {
    isPortOpen: async (host, port) => {
      assert.equal(host, "127.0.0.1");
      assert.equal(port, 47631);
      openChecks += 1;
      return openChecks >= 3;
    },
    sleep: async () => undefined,
  });

  assert.equal(openChecks, 3);
});
