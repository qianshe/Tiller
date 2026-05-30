import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { AcpAgentProvider, WorktreeSummary } from "@tiller/shared";
import { AcpConnection } from "./lifecycle";

const require = createRequire(import.meta.url);
const sdkImportUrl = pathToFileURL(require.resolve("@agentclientprotocol/sdk")).href;

function writeInitializeOnlyAgent(tempDir: string, options: { exitAfterMs?: number; newSessionDelayMs?: number; exitOnPrompt?: boolean; fireAndForgetPromptUpdate?: boolean } = {}) {
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
const newSessionDelayMs = ${JSON.stringify(options.newSessionDelayMs ?? 50)};
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
    await new Promise((resolve) => setTimeout(resolve, 100));
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
    const result = await client.readTextFile({ sessionId: params.sessionId, path: "marker.txt" });
    const update = client.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "message-" + params.sessionId,
        content: { type: "text", text: result.content },
      },
    });
    if (!fireAndForgetPromptUpdate) {
      await update;
    }
    return {};
  },
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
        provider: { ...createProvider("node", [agentPath]), initializeTimeoutMs: 100 },
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

test("session requests time out and clear pending state", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-session-timeout-"));
  try {
    const { agentPath } = writeInitializeOnlyAgent(tempDir, { newSessionDelayMs: 2_000 });
    const connection = await AcpConnection.open({
      provider: { ...createProvider("node", [agentPath]), initializeTimeoutMs: 1_500 },
      worktree: { ...worktree, path: tempDir },
    });

    await assert.rejects(
      connection.openOrCreateSession({
        tillerSessionId: "session-timeout",
        worktree: { ...worktree, path: tempDir },
        kind: "new",
        onEvent: () => undefined,
      }),
      /Timed out waiting for ACP response: session\/new/u,
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

test("prompt transport close marks the connection as errored", async () => {
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

    await handle.prompt("close now");

    assert.equal(connection.inventory().status, "error");
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

test("child exit broadcasts an error to active sessions", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-exit-"));
  try {
    const { agentPath } = writeInitializeOnlyAgent(tempDir, { exitAfterMs: 80 });
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
    await new Promise((resolve) => setTimeout(resolve, 160));

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