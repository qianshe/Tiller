import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { AcpAgentProvider, WorktreeSummary } from "@tiller/shared";
import { AcpConnection } from "./lifecycle";
import { wasAcpPromptFailureReported } from "./prompt-failure";
import type { SessionRuntimeEvent } from "../runtime-types";
import { resolveClaudeTranscriptPath } from "../adapters/claude/transcript/plan";

const require = createRequire(import.meta.url);
const sdkImportUrl = pathToFileURL(require.resolve("@agentclientprotocol/sdk")).href;

function writeInitializeOnlyAgent(tempDir: string, options: { exitAfterMs?: number; newSessionDelayMs?: number; loadSessionDelayMs?: number; exitOnPrompt?: boolean; fireAndForgetPromptUpdate?: boolean; hangOnPrompt?: boolean; promptMessageText?: string } = {}) {
  const initializeCountPath = join(tempDir, "initialize-count.txt");
  const newSessionCountPath = join(tempDir, "new-session-count.txt");
  const newSessionCwdPath = join(tempDir, "new-session-cwd.txt");
  const closeSessionCountPath = join(tempDir, "close-session-count.txt");
  const closeSessionIdPath = join(tempDir, "close-session-id.txt");
  const loadSessionCountPath = join(tempDir, "load-session-count.txt");
  const loadSessionCwdPath = join(tempDir, "load-session-cwd.txt");
  const resumeSessionCountPath = join(tempDir, "resume-session-count.txt");
  const resumeSessionCwdPath = join(tempDir, "resume-session-cwd.txt");
  const launchArgsPath = join(tempDir, "launch-args.json");
  const pidPath = join(tempDir, "agent-pid.txt");
  const agentPath = join(tempDir, "fake-initialize-agent.mjs");
  writeFileSync(agentPath, `
import { Readable, Writable } from "node:stream";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as acp from ${JSON.stringify(sdkImportUrl)};

const initializeCountPath = ${JSON.stringify(initializeCountPath)};
const newSessionCountPath = ${JSON.stringify(newSessionCountPath)};
const newSessionCwdPath = ${JSON.stringify(newSessionCwdPath)};
const closeSessionCountPath = ${JSON.stringify(closeSessionCountPath)};
const closeSessionIdPath = ${JSON.stringify(closeSessionIdPath)};
const loadSessionCountPath = ${JSON.stringify(loadSessionCountPath)};
const loadSessionCwdPath = ${JSON.stringify(loadSessionCwdPath)};
const resumeSessionCountPath = ${JSON.stringify(resumeSessionCountPath)};
const resumeSessionCwdPath = ${JSON.stringify(resumeSessionCwdPath)};
const launchArgsPath = ${JSON.stringify(launchArgsPath)};
const pidPath = ${JSON.stringify(pidPath)};
const exitAfterMs = ${JSON.stringify(options.exitAfterMs ?? null)};
const exitOnPrompt = ${JSON.stringify(options.exitOnPrompt ?? false)};
const fireAndForgetPromptUpdate = ${JSON.stringify(options.fireAndForgetPromptUpdate ?? false)};
const hangOnPrompt = ${JSON.stringify(options.hangOnPrompt ?? false)};
const promptMessageText = ${JSON.stringify(options.promptMessageText ?? null)};
const newSessionDelayMs = ${JSON.stringify(options.newSessionDelayMs ?? 50)};
const loadSessionDelayMs = ${JSON.stringify(options.loadSessionDelayMs ?? 100)};
writeFileSync(launchArgsPath, JSON.stringify(process.argv.slice(2)), "utf8");
writeFileSync(pidPath, String(process.pid), "utf8");
const incrementCount = (path) => {
  const current = existsSync(path) ? Number(readFileSync(path, "utf8")) : 0;
  writeFileSync(path, String(current + 1), "utf8");
};

let client;

const agent = {
  async initialize() {
    incrementCount(initializeCountPath);
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: { name: "Fake initialize agent", version: "0.0.0" },
      agentCapabilities: {
        session: { list: {}, load: {}, resume: {}, close: {} },
        promptCapabilities: { image: true },
      },
    };
  },
  async newSession(params) {
    incrementCount(newSessionCountPath);
    writeFileSync(newSessionCwdPath, params.cwd, "utf8");
    await new Promise((resolve) => setTimeout(resolve, newSessionDelayMs));
    return { sessionId: "runtime-session-1" };
  },
  async loadSession(params) {
    incrementCount(loadSessionCountPath);
    writeFileSync(loadSessionCwdPath, params.cwd, "utf8");
    await new Promise((resolve) => setTimeout(resolve, loadSessionDelayMs));
    await client.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "message-from-load",
        content: { type: "text", text: "loaded message" },
      },
    });
    return { sessionId: params.sessionId };
  },
  async resumeSession(params) {
    incrementCount(resumeSessionCountPath);
    writeFileSync(resumeSessionCwdPath, params.cwd, "utf8");
    return { sessionId: params.sessionId };
  },
  async prompt(params) {
    if (exitOnPrompt) {
      process.exit(0);
    }
    if (hangOnPrompt) {
      await new Promise(() => {});
    }
    const result = await client.readTextFile({ sessionId: params.sessionId, path: "marker.txt" });
    const update = client.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "message-" + params.sessionId,
        content: { type: "text", text: promptMessageText ?? result.content },
      },
    });
    if (!fireAndForgetPromptUpdate) {
      await update;
    }
    return {};
  },
  async cancel() {},
  async closeSession(params) {
    incrementCount(closeSessionCountPath);
    writeFileSync(closeSessionIdPath, params.sessionId, "utf8");
    return {};
  },
};

const input = Readable.toWeb(process.stdin);
const output = Writable.toWeb(process.stdout);
new acp.AgentSideConnection((agentClient) => {
  client = agentClient;
  return agent;
}, acp.ndJsonStream(output, input));

if (typeof exitAfterMs === "number") {
  setTimeout(() => process.exit(2), exitAfterMs);
}
`, "utf8");
  return { agentPath, initializeCountPath, newSessionCountPath, newSessionCwdPath, closeSessionCountPath, closeSessionIdPath, loadSessionCountPath, loadSessionCwdPath, resumeSessionCountPath, resumeSessionCwdPath, launchArgsPath, pidPath };
}

function writeSilentAgent(tempDir: string) {
  const pidPath = join(tempDir, "silent-agent-pid.txt");
  const agentPath = join(tempDir, "silent-agent.mjs");
  writeFileSync(agentPath, `
import { writeFileSync } from "node:fs";
const pidPath = ${JSON.stringify(pidPath)};
writeFileSync(pidPath, String(process.pid), "utf8");
setInterval(() => undefined, 1_000);
`, "utf8");
  return { agentPath, pidPath };
}

async function waitForProcessExit(pid: number, timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function createProvider(command: string, args: string[]): AcpAgentProvider {
  return {
    id: "fake-acp",
    name: "Fake ACP",
    command,
    args,
    transport: "stdio",
    protocol: "acp",
  };
}

const worktree: WorktreeSummary = {
  name: "Worktree",
  path: "D:/tmp/worktree",
};

test("AcpConnection.open initializes exactly once", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-connection-"));
  try {
    const { agentPath, initializeCountPath } = writeInitializeOnlyAgent(tempDir);
    const connection = await AcpConnection.open({
      provider: createProvider("node", [agentPath]),
      worktree: { ...worktree, path: tempDir },
    });

    assert.equal(readFileSync(initializeCountPath, "utf8"), "1");
    assert.equal(connection.inventory().initialized, true);
    assert.equal(connection.inventory().activeSessionCount, 0);

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("AcpConnection.open terminates the child process when initialize times out", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-open-timeout-"));
  try {
    const { agentPath, pidPath } = writeSilentAgent(tempDir);

    await assert.rejects(
      AcpConnection.open({
        // Headroom so the silent agent's cold start still writes its pid file before the
        // initialize timeout fires; 100ms flakes on slow CI runners where node startup ≈ timeout.
        provider: { ...createProvider("node", [agentPath]), initializeTimeoutMs: 500 },
        worktree: { ...worktree, path: tempDir },
      }),
      /Timed out waiting for ACP response: initialize/u,
    );

    const pid = Number(readFileSync(pidPath, "utf8"));
    assert.equal(await waitForProcessExit(pid), true);
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("AcpConnection.open applies per-session config when launching connection", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-launch-config-"));
  try {
    const { agentPath, launchArgsPath } = writeInitializeOnlyAgent(tempDir);
    const connection = await AcpConnection.open({
      provider: { ...createProvider("node", [agentPath]), id: "codex" },
      worktree: { ...worktree, path: tempDir },
      sessionConfig: { model: "gpt-5.5", reasoningEffort: "high" },
    });

    const launchArgs = JSON.parse(readFileSync(launchArgsPath, "utf8")) as string[];
    assert.equal(launchArgs.some((arg) => arg.includes("gpt-5.5")), true);
    assert.equal(launchArgs.some((arg) => arg.includes("model_reasoning_effort")), true);
    assert.equal(connection.inventory().initialized, true);

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("openOrCreateSession reuses the same pending new-session request", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-session-"));
  try {
    const { agentPath, newSessionCountPath } = writeInitializeOnlyAgent(tempDir);
    const connection = await AcpConnection.open({
      provider: createProvider("node", [agentPath]),
      worktree: { ...worktree, path: tempDir },
    });

    const [first, second] = await Promise.all([
      connection.openOrCreateSession({ tillerSessionId: "session-1", worktree: { ...worktree, path: tempDir }, kind: "new", onEvent: () => undefined }),
      connection.openOrCreateSession({ tillerSessionId: "session-1", worktree: { ...worktree, path: tempDir }, kind: "new", onEvent: () => undefined }),
    ]);

    assert.equal(readFileSync(newSessionCountPath, "utf8"), "1");
    assert.equal(first.runtimeSessionId, "runtime-session-1");
    assert.equal(second.runtimeSessionId, first.runtimeSessionId);
    assert.equal(connection.inventory().activeSessionCount, 1);

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("pending session reuse routes prompt events to the latest listener", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-session-listener-"));
  try {
    const { agentPath } = writeInitializeOnlyAgent(tempDir, { newSessionDelayMs: 100 });
    writeFileSync(join(tempDir, "marker.txt"), "latest listener reply", "utf8");
    const connection = await AcpConnection.open({
      provider: createProvider("node", [agentPath]),
      worktree: { ...worktree, path: tempDir },
    });
    const firstEvents: SessionRuntimeEvent[] = [];
    const secondEvents: SessionRuntimeEvent[] = [];

    const [first, second] = await Promise.all([
      connection.openOrCreateSession({
        tillerSessionId: "session-1",
        worktree: { ...worktree, path: tempDir },
        kind: "new",
        onEvent: (event) => firstEvents.push(event),
      }),
      connection.openOrCreateSession({
        tillerSessionId: "session-1",
        worktree: { ...worktree, path: tempDir },
        kind: "new",
        onEvent: (event) => secondEvents.push(event),
      }),
    ]);

    assert.equal(first.runtimeSessionId, second.runtimeSessionId);
    await second.prompt("reply through the active listener");

    assert.equal(
      firstEvents.some((event) => event.type === "message" && event.message.text === "latest listener reply"),
      false,
    );
    assert.equal(
      secondEvents.some((event) => event.type === "message" && event.message.text === "latest listener reply"),
      true,
    );

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("session requests time out and clear pending state", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-session-timeout-"));
  try {
    const { agentPath } = writeInitializeOnlyAgent(tempDir, { newSessionDelayMs: 2_000 });
    const connection = await AcpConnection.open({
      provider: { ...createProvider("node", [agentPath]), initializeTimeoutMs: 1_500 },
      worktree: { ...worktree, path: tempDir },
    });

    t.mock.timers.enable({ apis: ["setTimeout"] });
    const request = connection.openOrCreateSession({
      tillerSessionId: "session-timeout",
      worktree: { ...worktree, path: tempDir },
      kind: "new",
      onEvent: () => undefined,
    });
    t.mock.timers.tick(120_000);
    await assert.rejects(
      request,
      /Timed out waiting for ACP response: session\/new after 120000ms/u,
    );
    assert.equal(connection.inventory().pendingSessionCount, 0);
    assert.equal(connection.inventory().activeSessionCount, 0);

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("session restore timeout disposes the ACP connection", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-session-restore-timeout-"));
  try {
    const { agentPath, pidPath } = writeInitializeOnlyAgent(tempDir, { loadSessionDelayMs: 2_000 });
    const connection = await AcpConnection.open({
      provider: { ...createProvider("node", [agentPath]), initializeTimeoutMs: 1_500 },
      worktree: { ...worktree, path: tempDir },
    });

    t.mock.timers.enable({ apis: ["setTimeout"] });
    const request = connection.openOrCreateSession({
      tillerSessionId: "session-restore-timeout",
      worktree: { ...worktree, path: tempDir },
      kind: "load",
      runtimeSessionId: "runtime-restore-timeout",
      onEvent: () => undefined,
    });
    t.mock.timers.tick(120_000);
    await assert.rejects(
      request,
      /Timed out waiting for ACP response: session\/load after 120000ms/u,
    );

    assert.equal(connection.inventory().status, "closed");
    t.mock.timers.reset();
    assert.equal(await waitForProcessExit(Number(readFileSync(pidPath, "utf8"))), true);
    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("session requests use the requested worktree cwd instead of launch cwd", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-session-cwd-"));
  const sessionDir = join(tempDir, "session-project");
  mkdirSync(sessionDir, { recursive: true });
  try {
    const { agentPath, newSessionCwdPath } = writeInitializeOnlyAgent(tempDir);
    const connection = await AcpConnection.open({
      provider: { ...createProvider("node", [agentPath]), cwd: tempDir },
      worktree: { ...worktree, path: tempDir },
    });

    await connection.openOrCreateSession({
      tillerSessionId: "session-1",
      worktree: { ...worktree, path: sessionDir },
      kind: "new",
      onEvent: () => undefined,
    });

    assert.equal(readFileSync(newSessionCwdPath, "utf8"), sessionDir);
    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("closeSession only closes ACP session after the last handle is released", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-close-"));
  try {
    const { agentPath, closeSessionCountPath } = writeInitializeOnlyAgent(tempDir);
    const connection = await AcpConnection.open({
      provider: createProvider("node", [agentPath]),
      worktree: { ...worktree, path: tempDir },
    });

    await connection.openOrCreateSession({ tillerSessionId: "session-1", worktree: { ...worktree, path: tempDir }, kind: "new", onEvent: () => undefined });
    await connection.openOrCreateSession({ tillerSessionId: "session-1", worktree: { ...worktree, path: tempDir }, kind: "new", onEvent: () => undefined });

    await connection.closeSession("session-1");
    assert.equal(existsSync(closeSessionCountPath), false);
    assert.equal(connection.inventory().activeSessionCount, 1);

    await connection.closeSession("session-1");
    assert.equal(readFileSync(closeSessionCountPath, "utf8"), "1");
    assert.equal(connection.inventory().activeSessionCount, 0);

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("closing the last session keeps the ACP child process alive", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-persistent-idle-"));
  try {
    const { agentPath, pidPath } = writeInitializeOnlyAgent(tempDir);
    const connection = await AcpConnection.open({
      provider: createProvider("node", [agentPath]),
      worktree: { ...worktree, path: tempDir },
    });

    await connection.openOrCreateSession({
      tillerSessionId: "session-1",
      worktree: { ...worktree, path: tempDir },
      kind: "new",
      onEvent: () => undefined,
    });
    const childPid = Number(readFileSync(pidPath, "utf8"));

    await connection.closeSession("session-1");
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(connection.inventory().activeSessionCount, 0);
    assert.equal(connection.inventory().status, "ready");
    assert.equal(isProcessRunning(childPid), true);

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("closeSession during in-flight load removes pending session and sends close once", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-close-load-"));
  try {
    const { agentPath, closeSessionCountPath, closeSessionIdPath, loadSessionCountPath } = writeInitializeOnlyAgent(tempDir);
    const connection = await AcpConnection.open({
      provider: createProvider("node", [agentPath]),
      worktree: { ...worktree, path: tempDir },
    });

    const load = connection.openOrCreateSession({
      tillerSessionId: "session-1",
      worktree: { ...worktree, path: tempDir },
      kind: "load",
      runtimeSessionId: "remote-session-1",
      onEvent: () => undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    await connection.closeSession("session-1");

    await assert.rejects(load, /session was closed before load completed/u);
    assert.equal(readFileSync(loadSessionCountPath, "utf8"), "1");
    assert.equal(readFileSync(closeSessionCountPath, "utf8"), "1");
    assert.equal(readFileSync(closeSessionIdPath, "utf8"), "remote-session-1");
    assert.equal(connection.inventory().activeSessionCount, 0);
    assert.equal(connection.inventory().pendingSessionCount, 0);

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("session updates are routed to the matching loaded session", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-route-"));
  try {
    const { agentPath } = writeInitializeOnlyAgent(tempDir);
    const connection = await AcpConnection.open({
      provider: createProvider("node", [agentPath]),
      worktree: { ...worktree, path: tempDir },
    });
    const events: Array<{ type: string; message?: { text: string } }> = [];

    await connection.openOrCreateSession({
      tillerSessionId: "session-1",
      worktree: { ...worktree, path: tempDir },
      kind: "load",
      runtimeSessionId: "remote-session-1",
      onEvent: (event) => events.push(event as { type: string; message?: { text: string } }),
    });

    assert.deepEqual(events.map((event) => event.message?.text).filter(Boolean), ["loaded message"]);

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("client file callbacks resolve paths from the matching session cwd", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-callback-cwd-"));
  const firstDir = join(tempDir, "project-a");
  const secondDir = join(tempDir, "project-b");
  mkdirSync(firstDir, { recursive: true });
  mkdirSync(secondDir, { recursive: true });
  writeFileSync(join(firstDir, "marker.txt"), "from project a", "utf8");
  writeFileSync(join(secondDir, "marker.txt"), "from project b", "utf8");
  try {
    const { agentPath } = writeInitializeOnlyAgent(tempDir);
    const connection = await AcpConnection.open({
      provider: createProvider("node", [agentPath]),
      worktree: { ...worktree, path: tempDir },
    });
    const firstEvents: Array<{ type: string; message?: { text: string } }> = [];
    const secondEvents: Array<{ type: string; message?: { text: string } }> = [];

    const first = await connection.openOrCreateSession({
      tillerSessionId: "session-1",
      worktree: { ...worktree, path: firstDir },
      kind: "load",
      runtimeSessionId: "remote-session-1",
      onEvent: (event) => firstEvents.push(event as { type: string; message?: { text: string } }),
    });
    const second = await connection.openOrCreateSession({
      tillerSessionId: "session-2",
      worktree: { ...worktree, path: secondDir },
      kind: "load",
      runtimeSessionId: "remote-session-2",
      onEvent: (event) => secondEvents.push(event as { type: string; message?: { text: string } }),
    });

    await first.prompt("read marker");
    await second.prompt("read marker");

    assert.equal(firstEvents.some((event) => event.message?.text === "from project a"), true);
    assert.equal(secondEvents.some((event) => event.message?.text === "from project b"), true);

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("openOrCreateSession supports resume with the requested runtime session id", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-resume-"));
  try {
    const { agentPath, resumeSessionCountPath } = writeInitializeOnlyAgent(tempDir);
    const connection = await AcpConnection.open({
      provider: createProvider("node", [agentPath]),
      worktree: { ...worktree, path: tempDir },
    });

    const handle = await connection.openOrCreateSession({
      tillerSessionId: "session-1",
      worktree: { ...worktree, path: tempDir },
      kind: "resume",
      runtimeSessionId: "remote-session-1",
      onEvent: () => undefined,
    });

    assert.equal(handle.runtimeSessionId, "remote-session-1");
    assert.equal(readFileSync(resumeSessionCountPath, "utf8"), "1");

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("prompt emits idle after fire-and-forget assistant updates are delivered", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-prompt-update-order-"));
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(join(tempDir, "marker.txt"), "async assistant text", "utf8");
  try {
    const { agentPath } = writeInitializeOnlyAgent(tempDir, { fireAndForgetPromptUpdate: true });
    const connection = await AcpConnection.open({
      provider: createProvider("node", [agentPath]),
      worktree: { ...worktree, path: tempDir },
    });
    const events: Array<{ type: string; status?: string; message?: { text: string } }> = [];
    const handle = await connection.openOrCreateSession({
      tillerSessionId: "session-1",
      worktree: { ...worktree, path: tempDir },
      kind: "new",
      onEvent: (event) => events.push(event as { type: string; status?: string; message?: { text: string } }),
    });

    await handle.prompt("read marker");

    const messageIndex = events.findIndex((event) => event.message?.text === "async assistant text");
    const idleIndex = events.findIndex((event) => event.type === "status" && event.status === "idle");
    assert.notEqual(messageIndex, -1);
    assert.notEqual(idleIndex, -1);
    assert.equal(messageIndex < idleIndex, true);

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("cancelling a turn keeps the ACP session reusable", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-cancel-reuse-"));
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(join(tempDir, "marker.txt"), "reused session", "utf8");
  try {
    const { agentPath } = writeInitializeOnlyAgent(tempDir);
    const connection = await AcpConnection.open({
      provider: createProvider("node", [agentPath]),
      worktree: { ...worktree, path: tempDir },
    });
    const events: Array<{ type: string; status?: string }> = [];
    const handle = await connection.openOrCreateSession({
      tillerSessionId: "session-1",
      worktree: { ...worktree, path: tempDir },
      kind: "new",
      onEvent: (event) => events.push(event as { type: string; status?: string }),
    });

    handle.cancel();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await handle.prompt("continue after cancellation");

    assert.equal(
      connection.inventory().sessions.some((session) => session.tillerSessionId === "session-1"),
      true,
    );
    assert.equal(
      events.some((event) => event.type === "status" && event.status === "cancelled"),
      true,
    );
    assert.equal(
      events.some((event) => event.type === "status" && event.status === "idle"),
      true,
    );

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("prompt preserves Claude synthetic API errors instead of marking the prompt idle", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-claude-api-error-"));
  const apiError = "Failed to authenticate. API Error: 403 预扣费额度失败 (request id: abc123)";
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(join(tempDir, "marker.txt"), "unused", "utf8");
  try {
    const { agentPath } = writeInitializeOnlyAgent(tempDir, { promptMessageText: apiError });
    const connection = await AcpConnection.open({
      provider: { ...createProvider(process.execPath, [agentPath]), id: "claudecode", name: "Claude Code" },
      worktree: { ...worktree, path: tempDir },
    });
    const events: SessionRuntimeEvent[] = [];
    const handle = await connection.openOrCreateSession({
      tillerSessionId: "session-claude-api-error",
      worktree: { ...worktree, path: tempDir },
      kind: "new",
      onEvent: (event) => events.push(event),
    });

    await handle.prompt("test API error");

    assert.deepEqual(
      events.filter((event) => event.type === "error"),
      [{ type: "error", code: "ACP_AGENT_API_ERROR", message: apiError }],
    );
    assert.equal(events.some((event) => event.type === "message"), false);
    assert.equal(
      events.some((event) => event.type === "status" && event.status === "idle"),
      false,
    );

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("idle prompt observation emits a delayed Claude subagent completion", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-idle-observer-"));
  const tempHome = join(tempDir, "home");
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let connection: AcpConnection | undefined;
  try {
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    writeFileSync(join(tempDir, "marker.txt"), "assistant response", "utf8");
    const { agentPath } = writeInitializeOnlyAgent(tempDir);
    connection = await AcpConnection.open({
      provider: { ...createProvider("node", [agentPath]), id: "claude", name: "Claude" },
      worktree: { ...worktree, path: tempDir },
    });
    const events: SessionRuntimeEvent[] = [];
    const handle = await connection.openOrCreateSession({
      tillerSessionId: "session-1",
      worktree: { ...worktree, path: tempDir },
      kind: "new",
      onEvent: (event) => events.push(event),
    });

    await handle.prompt("finish the foreground prompt");

    const transcriptPath = resolveClaudeTranscriptPath({
      runtimeSessionId: "runtime-session-1",
      cwd: tempDir,
    });
    assert.equal(transcriptPath.startsWith(tempDir), true);
    mkdirSync(dirname(transcriptPath), { recursive: true });
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        timestamp: "2026-07-19T14:12:55.834Z",
        content: [
          "<task-notification>",
          "<task-id>agent-1</task-id>",
          "<tool-use-id>call-background</tool-use-id>",
          "<status>completed</status>",
          "<result>SUBAGENT_DONE</result>",
          "</task-notification>",
        ].join("\\n"),
      })}\n`,
      "utf8",
    );

    assert.equal(
      await waitForCondition(() => events.some((event) =>
        event.type === "tool-call" &&
        event.toolCall.id === "call-background" &&
        event.toolCall.status === "completed"),
      ),
      true,
    );
  } finally {
    await connection?.dispose();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("automatic Claude compaction reaches the session through ACP without a follow-up prompt", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-automatic-compaction-"));
  let connection: AcpConnection | undefined;
  try {
    writeFileSync(join(tempDir, "marker.txt"), "assistant response", "utf8");
    const { agentPath } = writeInitializeOnlyAgent(tempDir);
    connection = await AcpConnection.open({
      provider: { ...createProvider("node", [agentPath]), id: "claude", name: "Claude" },
      worktree: { ...worktree, path: tempDir },
    });
    const events: SessionRuntimeEvent[] = [];
    await connection.openOrCreateSession({
      tillerSessionId: "session-1",
      worktree: { ...worktree, path: tempDir },
      kind: "new",
      onEvent: (event) => events.push(event),
    });

    (connection as unknown as {
      handleSessionUpdate(params: unknown): void;
    }).handleSessionUpdate({
      sessionId: "runtime-session-1",
      update: {
        sessionUpdate: "compaction_completed",
        messageId: "automatic-compaction",
        timestamp: "2026-07-20T09:00:00.000Z",
        status: "completed",
        compaction: {
          summary: "Automatically compacted context.",
        },
      },
    });

    assert.deepEqual(events, [{
      type: "compaction",
      phase: "completed",
      source: "provider",
      messageId: "automatic-compaction",
      summaryText: "Automatically compacted context.",
      timestamp: "2026-07-20T09:00:00.000Z",
    }]);
  } finally {
    await connection?.dispose();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("manual Claude /compact persists its transcript summary without a follow-up prompt", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-idle-compaction-"));
  const tempHome = join(tempDir, "home");
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let connection: AcpConnection | undefined;
  try {
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    writeFileSync(join(tempDir, "marker.txt"), "assistant response", "utf8");
    const { agentPath } = writeInitializeOnlyAgent(tempDir);
    connection = await AcpConnection.open({
      provider: { ...createProvider("node", [agentPath]), id: "claude", name: "Claude" },
      worktree: { ...worktree, path: tempDir },
    });
    const events: SessionRuntimeEvent[] = [];
    const handle = await connection.openOrCreateSession({
      tillerSessionId: "session-1",
      worktree: { ...worktree, path: tempDir },
      kind: "new",
      onEvent: (event) => events.push(event),
    });

    await handle.prompt("/compact");

    const transcriptPath = resolveClaudeTranscriptPath({
      runtimeSessionId: "runtime-session-1",
      cwd: tempDir,
    });
    mkdirSync(dirname(transcriptPath), { recursive: true });
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        timestamp: "2026-07-19T14:12:55.834Z",
        uuid: "summary-after-compact",
        isCompactSummary: true,
        message: {
          role: "user",
          content: [
            "Summary:",
            "Compacted context written after the command completed.",
            "If you need specific details from before compaction, read the transcript.",
          ].join("\n"),
        },
      })}\n`,
      "utf8",
    );

    assert.equal(
      await waitForCondition(() => events.some((event) =>
        event.type === "compaction" &&
        event.messageId === "summary-after-compact"),
      ),
      true,
    );
    const compaction = events.find((event) =>
      event.type === "compaction" &&
      event.messageId === "summary-after-compact");
    assert.deepEqual(compaction, {
      type: "compaction",
      phase: "completed",
      source: "provider",
      messageId: "summary-after-compact",
      summaryText: "Compacted context written after the command completed.",
      timestamp: "2026-07-19T14:12:55.834Z",
    });
  } finally {
    await connection?.dispose();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("prompt transport close marks the connection as unusable", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-prompt-close-"));
  try {
    const { agentPath } = writeInitializeOnlyAgent(tempDir, { exitOnPrompt: true });
    const connection = await AcpConnection.open({
      provider: createProvider("node", [agentPath]),
      worktree: { ...worktree, path: tempDir },
    });
    const events: Array<{ type: string; message?: string }> = [];
    const handle = await connection.openOrCreateSession({
      tillerSessionId: "session-1",
      worktree: { ...worktree, path: tempDir },
      kind: "new",
      onEvent: (event) => events.push(event as { type: string; message?: string }),
    });

    await assert.rejects(
      handle.prompt("close now"),
      (error: unknown) => {
        assert.match(
          error instanceof Error ? error.message : "",
          /ACP connection closed|ACP process exited/u,
        );
        assert.equal(wasAcpPromptFailureReported(error), true);
        return true;
      },
    );

    assert.equal(["closed", "error"].includes(connection.inventory().status), true);
    assert.match(connection.inventory().lastError ?? "", /ACP connection closed/u);
    assert.equal(
      events.some((event) => event.type === "error" && event.message?.includes("ACP connection closed")),
      true,
    );

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("prompt timeout terminates a provider that produces no events", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-prompt-stalled-"));
  try {
    const { agentPath, pidPath } = writeInitializeOnlyAgent(tempDir, { hangOnPrompt: true });
    const connection = await AcpConnection.open({
      provider: { ...createProvider("node", [agentPath]), promptTimeoutMs: 75 },
      worktree: { ...worktree, path: tempDir },
    });
    const events: Array<{ type: string; status?: string; message?: string }> = [];
    const handle = await connection.openOrCreateSession({
      tillerSessionId: "session-1",
      worktree: { ...worktree, path: tempDir },
      kind: "new",
      onEvent: (event) => events.push(event as { type: string; status?: string; message?: string }),
    });
    const pid = Number(readFileSync(pidPath, "utf8"));

    await assert.rejects(
      handle.prompt("hang forever"),
      /produced no prompt progress|Timed out waiting for ACP response/u,
    );

    assert.equal(await waitForProcessExit(pid), true);
    assert.equal(["closed", "error"].includes(connection.inventory().status), true);
    assert.equal(events.some((event) => event.type === "error"), true);
    assert.equal(events.some((event) => event.type === "status" && event.status === "error"), true);

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("child exit broadcasts an error to active sessions", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-exit-"));
  try {
    const { agentPath } = writeInitializeOnlyAgent(tempDir, { exitAfterMs: 500 });
    const connection = await AcpConnection.open({
      provider: createProvider("node", [agentPath]),
      worktree: { ...worktree, path: tempDir },
    });
    const events: Array<{ type: string; message?: string }> = [];

    await connection.openOrCreateSession({
      tillerSessionId: "session-1",
      worktree: { ...worktree, path: tempDir },
      kind: "new",
      onEvent: (event) => events.push(event as { type: string; message?: string }),
    });
    await new Promise((resolve) => setTimeout(resolve, 700));

    assert.equal(connection.inventory().status, "error");
    assert.equal(events.some((event) => event.type === "error" && event.message?.includes("ACP process exited")), true);

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("intentional connection dispose does not broadcast an exit error", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-dispose-"));
  try {
    const { agentPath } = writeInitializeOnlyAgent(tempDir);
    const connection = await AcpConnection.open({
      provider: createProvider("node", [agentPath]),
      worktree: { ...worktree, path: tempDir },
    });
    const events: Array<{ type: string; message?: string }> = [];

    await connection.openOrCreateSession({
      tillerSessionId: "session-1",
      worktree: { ...worktree, path: tempDir },
      kind: "new",
      onEvent: (event) => events.push(event as { type: string; message?: string }),
    });

    await connection.dispose();
    await new Promise((resolve) => setTimeout(resolve, 160));

    assert.equal(connection.inventory().status, "closed");
    assert.equal(events.some((event) => event.type === "error" && event.message?.includes("ACP process exited")), false);
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("runtime handle rekeys draft inventory when attached to a real session", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-draft-attach-"));
  try {
    const { agentPath } = writeInitializeOnlyAgent(tempDir);
    const connection = await AcpConnection.open({
      provider: createProvider("node", [agentPath]),
      worktree: { ...worktree, path: tempDir },
    });

    const handle = await connection.openOrCreateSession({
      tillerSessionId: "draft-1",
      worktree: { ...worktree, path: tempDir },
      kind: "new",
      onEvent: () => undefined,
    });

    handle.attachTillerSession("session-1");

    assert.equal(connection.inventory().activeSessionCount, 1);
    assert.deepEqual(
      connection.inventory().sessions.map((session) => session.tillerSessionId),
      ["session-1"],
    );

    await handle.close();
    assert.equal(connection.inventory().activeSessionCount, 0);

    await connection.dispose();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});
