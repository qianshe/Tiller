import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
      () => "",
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
      () => "",
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

test("withConnectionRequest reads stderr after the request starts", async () => {
  const child = new EventEmitter() as ChildProcess;
  const logFile = createLogFile();
  let stderr = "";
  try {
    const request = withConnectionRequest(
      "session/resume",
      new Promise<string>(() => {}),
      child,
      () => stderr,
      logFile.path,
      provider,
    );
    stderr = "fatal: stored ACP session is unavailable";
    child.emit("exit", 1, null);

    await assert.rejects(
      request,
      /ACP process exited before session\/resume: code=1 signal=none: fatal: stored ACP session is unavailable/,
    );
  } finally {
    logFile.cleanup();
  }
});

test("withConnectionRequest excludes stderr emitted before the request", async () => {
  const child = new EventEmitter() as ChildProcess;
  const logFile = createLogFile();
  let stderr = "startup warning: using fallback config\n";
  try {
    const request = withConnectionRequest(
      "session/resume",
      new Promise<string>(() => {}),
      child,
      () => stderr,
      logFile.path,
      provider,
    );
    stderr += "fatal: stored ACP session is unavailable";
    child.emit("exit", 1, null);

    await assert.rejects(
      request,
      (error: unknown) => {
        assert.equal(
          (error as Error).message,
          "ACP process exited before session/resume: code=1 signal=none: fatal: stored ACP session is unavailable",
        );
        return true;
      },
    );
  } finally {
    logFile.cleanup();
  }
});

test("withConnectionRequest reports timeout instead of treating a warning as the cause", async () => {
  const child = new EventEmitter() as ChildProcess;
  const logFile = createLogFile();
  let timeoutCount = 0;
  try {
    const request = withConnectionRequest(
      "session/load",
      new Promise<string>(() => {}),
      child,
      () => "[CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] Warning: expected warning",
      logFile.path,
      { ...provider, initializeTimeoutMs: 5 },
      () => {
        timeoutCount += 1;
      },
    );

    await assert.rejects(
      request,
      (error: unknown) => {
        assert.equal(
          (error as Error).message,
          "Timed out waiting for ACP response: session/load after 5ms",
        );
        return true;
      },
    );
    assert.equal(timeoutCount, 1);
    assert.match(readFileSync(logFile.path, "utf8"), /sdk-timeout.*session\/load after 5ms/u);
  } finally {
    logFile.cleanup();
  }
});
