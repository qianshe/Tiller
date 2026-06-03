import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { AcpAgentProvider, AcpMcpServer } from "@tiller/shared";
import { createAcpRuntime, disposeAcpConnections, listAcpAgentSessions, testAcpConnection } from "./runtime";
import { mapTillerMcpServersToSdkMcpServers } from "./sdk-helpers";

const require = createRequire(import.meta.url);
const sdkImportUrl = pathToFileURL(require.resolve("@agentclientprotocol/sdk")).href;
const fakeMessageId = "11111111-1111-4111-8111-111111111111";

function createFakeSdkAgentFixture(tempDir: string) {
  const fakeAgentPath = join(tempDir, "fake-sdk-agent.mjs");
  writeFileSync(fakeAgentPath, `
import { writeFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import * as acp from "${sdkImportUrl}";

let client;
const worktreeFilePath = ${JSON.stringify(join(tempDir, "sdk-write.txt"))};
const terminalCwd = ${JSON.stringify(tempDir)};
const nodePath = ${JSON.stringify(process.execPath)};

function promptText(params) {
  return (params.prompt ?? [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\\n");
}

const agent = {
  async initialize(params) {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: { name: "Fake SDK Agent", version: "0.0.0" },
      agentCapabilities: {
        listSessions: true,
        loadSession: true,
        session: { list: {}, load: {}, resume: {} },
      },
    };
  },
  async newSession(params) {
    return {
      sessionId: "sdk-session-1",
      _meta: {
        cwd: params.cwd,
        mcpServers: params.mcpServers,
      },
    };
  },
  async listSessions(params) {
    return {
      sessions: [{ sessionId: "sdk-session-1", cwd: params.cwd, title: "SDK fixture session" }],
      nextCursor: params.cursor ? "next-page" : undefined,
    };
  },
  async loadSession(params) {
    await client.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "${fakeMessageId}",
        content: { type: "text", text: "loaded history" },
      },
    });
    return {};
  },
  async resumeSession() {
    return {};
  },
  async authenticate() {
    return {};
  },
  async prompt(params) {
    const text = promptText(params);
    if (text.includes("fs-client")) {
      await client.writeTextFile({ sessionId: params.sessionId, path: worktreeFilePath, content: "from sdk fs" });
      const file = await client.readTextFile({ sessionId: params.sessionId, path: worktreeFilePath });
      await client.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "${fakeMessageId}",
          content: { type: "text", text: file.content },
        },
      });
      return { stopReason: "end_turn" };
    }
    if (text.includes("terminal-client")) {
      const terminal = await client.createTerminal({
        sessionId: params.sessionId,
        command: nodePath,
        args: ["-e", "console.log('terminal ok')"],
        cwd: terminalCwd,
        outputByteLimit: 2048,
      });
      const exitStatus = await terminal.waitForExit();
      const output = await terminal.currentOutput();
      await terminal.release();
      await client.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "${fakeMessageId}",
          content: { type: "text", text: output.output.trim() + ":" + exitStatus.exitCode },
        },
      });
      return { stopReason: "end_turn" };
    }
    if (text.includes("plan-client")) {
      await client.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "plan",
          entries: [
            { content: "Receive SDK plan", priority: "high", status: "in_progress" },
            { content: "Render SDK plan", priority: "medium", status: "pending" },
          ],
        },
      });
      return { stopReason: "end_turn" };
    }
    await client.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "${fakeMessageId}",
        content: { type: "text", text: "hello from sdk" },
      },
    });
    const permission = await client.requestPermission({
      sessionId: params.sessionId,
      toolCall: {
        toolCallId: "tool-1",
        title: "Run echo",
        kind: "execute",
        status: "pending",
        rawInput: "echo sdk",
      },
      options: [
        { optionId: "allow-once", name: "Allow", kind: "allow_once" },
        { optionId: "deny-once", name: "Deny", kind: "reject_once" },
      ],
    });
    return {
      stopReason: permission.outcome?.outcome === "cancelled" ? "cancelled" : "end_turn",
    };
  },
  async cancel(params) {
    writeFileSync(${JSON.stringify(join(tempDir, "cancelled.txt"))}, params.sessionId, "utf8");
    return {};
  },
};

const input = Readable.toWeb(process.stdin);
const output = Writable.toWeb(process.stdout);
new acp.AgentSideConnection((agentClient) => {
  client = agentClient;
  return agent;
}, acp.ndJsonStream(output, input));
`, "utf8");
  return fakeAgentPath;
}

function createProvider(command: string, args: string[], mcpServers: AcpMcpServer[] = []): AcpAgentProvider {
  return {
    id: "sdk-fixture",
    name: "SDK fixture",
    command,
    args,
    mcpServers,
    transport: "stdio",
    protocol: "acp",
  };
}

async function waitFor<T>(resolveValue: () => T | undefined, timeoutMs = 2_000): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = resolveValue();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

test("production ACP runtime forwards cancel through the SDK connection", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-sdk-cancel-"));
  const fakeAgentPath = createFakeSdkAgentFixture(tempDir);
  const cancelMarkerPath = join(tempDir, "cancelled.txt");
  const events: any[] = [];
  const runtime = await createAcpRuntime({
    sessionId: "local-session-cancel",
    worktree: { name: "Worktree", path: tempDir },
    agent: createProvider(process.execPath, [fakeAgentPath]),
    onEvent: (event) => events.push(event),
  });

  try {
    runtime.cancel();
    await waitFor(() => existsSync(cancelMarkerPath) ? true : undefined);

    assert.equal(events.at(-1)?.type, "status");
    assert.equal(events.at(-1)?.status, "cancelled");
  } finally {
    await disposeAcpConnections();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("production ACP runtime serves worktree fs requests through the SDK client", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-sdk-fs-"));
  const fakeAgentPath = createFakeSdkAgentFixture(tempDir);
  const events: any[] = [];
  const runtime = await createAcpRuntime({
    sessionId: "local-session-fs",
    worktree: { name: "Worktree", path: tempDir },
    agent: createProvider(process.execPath, [fakeAgentPath]),
    onEvent: (event) => events.push(event),
  });

  try {
    const promptPromise = runtime.prompt("fs-client");
    const permissionEvent = await waitFor(() => events.find((event) => event.type === "permission-request"));
    assert.match(permissionEvent.request.command, /sdk-write\.txt/u);
    runtime.respondPermission(permissionEvent.request.id, "allow");
    await promptPromise;

    assert.equal(readFileSync(join(tempDir, "sdk-write.txt"), "utf8"), "from sdk fs");
    assert.ok(events.some((event) => event.type === "message" && event.message.text === "from sdk fs"));
  } finally {
    await runtime.close();
    await disposeAcpConnections();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("production ACP runtime executes SDK terminal requests after Deck permission", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-sdk-terminal-"));
  const fakeAgentPath = createFakeSdkAgentFixture(tempDir);
  const events: any[] = [];
  const runtime = await createAcpRuntime({
    sessionId: "local-session-terminal",
    worktree: { name: "Worktree", path: tempDir },
    agent: createProvider(process.execPath, [fakeAgentPath]),
    onEvent: (event) => events.push(event),
  });

  try {
    const promptPromise = runtime.prompt("terminal-client");
    const permissionEvent = await waitFor(() => events.find((event) => event.type === "permission-request"));
    assert.match(permissionEvent.request.command, /terminal ok/u);
    runtime.respondPermission(permissionEvent.request.id, "allow");
    await promptPromise;

    assert.ok(events.some((event) => event.type === "command-output" && event.chunk.text.includes("terminal ok")));
    assert.ok(events.some((event) => event.type === "message" && event.message.text === "terminal ok:0"));
  } finally {
    await runtime.close();
    await disposeAcpConnections();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("production ACP runtime maps SDK plan updates", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-sdk-plan-"));
  const fakeAgentPath = createFakeSdkAgentFixture(tempDir);
  const events: any[] = [];
  const runtime = await createAcpRuntime({
    sessionId: "local-session-plan",
    worktree: { name: "Worktree", path: tempDir },
    agent: createProvider(process.execPath, [fakeAgentPath]),
    onEvent: (event) => events.push(event),
  });

  try {
    await runtime.prompt("plan-client");

    const planEvent = events.find((event) => event.type === "plan-update");
    assert.deepEqual(planEvent?.plan.entries, [
      { content: "Receive SDK plan", priority: "high", status: "in_progress" },
      { content: "Render SDK plan", priority: "medium", status: "pending" },
    ]);
    assert.equal(events.at(-1)?.type, "status");
    assert.equal(events.at(-1)?.status, "idle");
  } finally {
    await runtime.close();
    await disposeAcpConnections();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("maps Tiller MCP servers into the SDK stdio shape", () => {
  const mcpServers: AcpMcpServer[] = [
    { name: "dummy", command: "dummy-mcp", args: ["--root", "D:/repo"], env: { ROOT: "D:/repo" } },
  ];

  assert.deepEqual(mapTillerMcpServersToSdkMcpServers(mcpServers), [
    { name: "dummy", command: "dummy-mcp", args: ["--root", "D:/repo"], env: [{ name: "ROOT", value: "D:/repo" }] },
  ]);
});

test("SDK-backed connection test initializes a fake SDK agent", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-sdk-test-"));
  const fakeAgentPath = createFakeSdkAgentFixture(tempDir);

  try {
    const result = await testAcpConnection(createProvider(process.execPath, [fakeAgentPath]), tempDir);

    assert.deepEqual(result, {
      ok: true,
      message: "ACP initialize passed for Fake SDK Agent v0.0.0.",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("SDK-backed session listing uses the generic client connection", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-sdk-list-"));
  const fakeAgentPath = createFakeSdkAgentFixture(tempDir);

  try {
    const result = await listAcpAgentSessions(
      createProvider(process.execPath, [fakeAgentPath]),
      { name: "Worktree", path: tempDir },
      "page-1",
    );

    assert.deepEqual(result.sessions, [{ sessionId: "sdk-session-1", cwd: tempDir, title: "SDK fixture session", updatedAt: undefined, meta: undefined }]);
    assert.equal(result.nextCursor, "next-page");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("production ACP runtime uses the SDK connection path with fake SDK agents", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-sdk-runtime-"));
  const fakeAgentPath = createFakeSdkAgentFixture(tempDir);
  const events: any[] = [];
  const runtime = await createAcpRuntime({
    sessionId: "local-session-1",
    worktree: { name: "Worktree", path: tempDir },
    agent: createProvider(process.execPath, [fakeAgentPath]),
    onEvent: (event) => events.push(event),
  });

  try {
    assert.equal(runtime.runtimeSessionId, "sdk-session-1");
    assert.equal(runtime.supportsPermissionResponses, true);

    const promptPromise = runtime.prompt("hello");
    const permissionEvent = await waitFor(() => events.find((event) => event.type === "permission-request"));
    assert.equal(permissionEvent.request.command, "Run echo :: echo sdk");
    runtime.respondPermission(permissionEvent.request.id, "allow");
    await promptPromise;

    assert.ok(events.some((event) => event.type === "message" && event.message.text === "hello from sdk"));
    assert.equal(events.at(-1)?.type, "status");
    assert.equal(events.at(-1)?.status, "idle");
  } finally {
    await runtime.close();
    await disposeAcpConnections();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
