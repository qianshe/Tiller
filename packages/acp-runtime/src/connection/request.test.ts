import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import type { ChildProcess } from "node:child_process";
import type { AcpAgentProvider } from "@tiller/shared";
import { withConnectionRequest } from "./request";

const provider = {
  id: "test-provider",
  name: "Test Provider",
  command: "test-acp",
} as AcpAgentProvider;

function createLogFile(): { path: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "tiller-acp-request-"));
  return {
    path: join(directory, "protocol.log"),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("withConnectionRequest resolves the operation and removes the exit listener", async () => {
  const child = new EventEmitter() as ChildProcess;
  const logFile = createLogFile();
  try {
    const result = await withConnectionRequest(
      "initialize",
      Promise.resolve("ok"),
      child,
      "",
      logFile.path,
      provider,
    );

    assert.equal(result, "ok");
    assert.equal(child.listenerCount("exit"), 0);
  } finally {
    logFile.cleanup();
  }
});

test("withConnectionRequest rejects when the ACP process exits first", async () => {
  const child = new EventEmitter() as ChildProcess;
  const logFile = createLogFile();
  try {
    const request = withConnectionRequest(
      "session/new",
      new Promise<string>(() => {}),
      child,
      "",
      logFile.path,
      provider,
    );
    child.emit("exit", 1, null);

    await assert.rejects(request, /ACP process exited before session\/new/);
    assert.equal(child.listenerCount("exit"), 0);
  } finally {
    logFile.cleanup();
  }
});
