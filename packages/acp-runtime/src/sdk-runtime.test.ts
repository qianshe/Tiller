import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { AcpAgentProvider, AcpMcpServer } from "@tiller/shared";
import { createAcpRuntime, listAcpAgentSessions } from "./runtime";
import { mapTillerMcpServersToSdkMcpServers } from "./sdk-helpers";

const require = createRequire(import.meta.url);
const sdkImportUrl = pathToFileURL(require.resolve("@agentclientprotocol/sdk")).href;
const fakeMessageId = "11111111-1111-4111-8111-111111111111";

function createFakeSdkAgentFixture(tempDir: string) {
  const fakeAgentPath = join(tempDir, "fake-sdk-agent.mjs");
  writeFileSync(fakeAgentPath, `
import { Readable, Writable } from "node:stream";
import * as acp from "${sdkImportUrl}";

let client;

const agent = {
  async initialize(params) {
    if (params.clientCapabilities?.terminal !== false) {
      throw new Error("terminal capability must stay disabled");
    }
    if (params.clientCapabilities?.fs?.readTextFile !== false || params.clientCapabilities?.fs?.writeTextFile !== false) {
      throw new Error("filesystem capabilities must stay disabled");
    }
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
  async cancel() {
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

test("maps Tiller MCP servers into the SDK stdio shape", () => {
  const mcpServers: AcpMcpServer[] = [
    { name: "dummy", command: "dummy-mcp", args: ["--root", "D:/repo"], env: { ROOT: "D:/repo" } },
  ];

  assert.deepEqual(mapTillerMcpServersToSdkMcpServers(mcpServers), [
    { name: "dummy", command: "dummy-mcp", args: ["--root", "D:/repo"], env: [{ name: "ROOT", value: "D:/repo" }] },
  ]);
});

test("SDK-backed session listing uses the generic client connection", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-sdk-list-"));
  const fakeAgentPath = createFakeSdkAgentFixture(tempDir);

  try {
    const result = await listAcpAgentSessions(
      createProvider(process.execPath, [fakeAgentPath]),
      { id: "workspace", name: "Workspace", path: tempDir },
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
    workspace: { id: "workspace", name: "Workspace", path: tempDir },
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
    rmSync(tempDir, { recursive: true, force: true });
  }
});
