import assert from "node:assert/strict";
import test from "node:test";
import { runOneShotUpdater } from "./updater.js";

function baseEnv() {
  return {
    TILLER_UPDATE_PARENT_PID: "42",
    TILLER_UPDATE_PORT: "47631",
    TILLER_UPDATE_CURRENT_VERSION: "1.0.0",
    TILLER_UPDATE_NODE: "node",
    TILLER_UPDATE_HELM_ENTRY: "helm.js",
    TILLER_UPDATE_HELM_ARGS: JSON.stringify(["--host", "127.0.0.1"]),
    TILLER_UPDATE_CWD: "D:/tiller",
    TILLER_UPDATE_HOST: "127.0.0.1",
    TILLER_UPDATE_LOG: "",
    TILLER_UPDATE_CHECK: "0",
    TILLER_UPDATE_PREVIEW_HINT: "0",
  } satisfies NodeJS.ProcessEnv;
}

test("updater exits without npm when it is already up to date", async () => {
  let installs = 0;
  const messages: unknown[] = [];
  const code = await runOneShotUpdater(baseEnv(), {
    fetchTags: async () => ({ latest: "1.0.0" }),
    install: async () => {
      installs += 1;
      return 0;
    },
    send: async (message) => {
      messages.push(message);
    },
  });

  assert.equal(code, 0);
  assert.equal(installs, 0);
  assert.deepEqual(messages, [{ kind: "status", status: "up-to-date", message: "Helm 已是最新版本。" }]);
});

test("updater does not close the old Helm when npm fails", async () => {
  const messages: unknown[] = [];
  let shutdownSent = false;
  const code = await runOneShotUpdater(baseEnv(), {
    fetchTags: async () => ({ latest: "1.1.0" }),
    install: async () => 1,
    send: async (message) => {
      messages.push(message);
      if (message.kind === "shutdown") shutdownSent = true;
    },
  });

  assert.equal(code, 1);
  assert.equal(shutdownSent, false);
  assert.equal((messages.at(-1) as { status?: string }).status, "failed");
});

test("updater installs, requests shutdown, waits, and starts the replacement", async () => {
  const messages: unknown[] = [];
  const calls: string[] = [];
  let replacement: unknown;
  const code = await runOneShotUpdater(baseEnv(), {
    fetchTags: async () => ({ latest: "1.1.0" }),
    install: async () => {
      calls.push("install");
      return 0;
    },
    waitForExit: async (pid) => {
      calls.push(`exit:${pid}`);
    },
    waitForPort: async (host, port) => {
      calls.push(`port:${host}:${port}`);
    },
    waitForReady: async (host, port) => {
      calls.push(`ready:${host}:${port}`);
    },
    send: async (message) => {
      messages.push(message);
      if (message.kind === "shutdown") calls.push("shutdown");
    },
    spawnHelm: async (input) => {
      replacement = input;
      calls.push("spawn");
    },
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, ["install", "shutdown", "exit:42", "port:127.0.0.1:47631", "spawn", "ready:127.0.0.1:47631"]);
  assert.deepEqual(replacement, {
    nodeExecutable: "node",
    entryPath: "helm.js",
    args: ["--host", "127.0.0.1"],
    cwd: "D:/tiller",
    env: {
      TILLER_UPDATE_CHECK: "0",
      TILLER_UPDATE_PREVIEW_HINT: "0",
    },
  });
  assert.deepEqual(messages, [
    { kind: "status", status: "restarting", message: "更新安装完成，等待 Helm 重启。" },
    { kind: "shutdown" },
  ]);
});
