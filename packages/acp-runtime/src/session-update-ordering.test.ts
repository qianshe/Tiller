import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const require = createRequire(import.meta.url);
const sdkImportUrl = pathToFileURL(require.resolve("@agentclientprotocol/sdk")).href;

type ObservedSessionUpdate = {
  source: "load" | "prompt";
  updateType: string;
  toolCallId?: string;
};

function createFakeAgent(tempDir: string) {
  const fakeAgentPath = join(tempDir, "fake-ordering-agent.mjs");
  writeFileSync(fakeAgentPath, `
import { Readable, Writable } from "node:stream";
import * as acp from "${sdkImportUrl}";

let client;
const sessionHistory = new Map();

const replayUpdates = [
  { sessionUpdate: "user_message_chunk", content: { type: "text", text: "load user" } },
  { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "load assistant" } },
  {
    sessionUpdate: "tool_call",
    toolCallId: "load-tool-1",
    title: "load tool",
    kind: "execute",
    status: "completed",
    rawInput: { command: "echo load" },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "load-tool-1",
    status: "completed",
    rawOutput: "load output",
  },
];

const promptUpdates = [
  { sessionUpdate: "user_message_chunk", content: { type: "text", text: "prompt user" } },
  { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "prompt assistant" } },
  {
    sessionUpdate: "tool_call",
    toolCallId: "prompt-tool-1",
    title: "prompt tool",
    kind: "execute",
    status: "completed",
    rawInput: { command: "echo prompt" },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "prompt-tool-1",
    status: "completed",
    rawOutput: "prompt output",
  },
];

const roundTripUpdates = [
  { sessionUpdate: "user_message_chunk", content: { type: "text", text: "roundtrip user" } },
  { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "roundtrip assistant before plan" } },
  {
    sessionUpdate: "plan",
    entries: [
      { content: "Collect ordered live events", priority: "high", status: "completed" },
      { content: "Replay ordered history", priority: "medium", status: "in_progress" },
    ],
  },
  {
    sessionUpdate: "tool_call",
    toolCallId: "roundtrip-tool-1",
    title: "roundtrip tool",
    kind: "execute",
    status: "completed",
    rawInput: { command: "echo roundtrip" },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "roundtrip-tool-1",
    status: "completed",
    rawOutput: "roundtrip output",
  },
  { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "roundtrip assistant after tool" } },
];

async function sendUpdates(sessionId, updates) {
  for (const update of updates) {
    await client.sessionUpdate({ sessionId, update });
  }
}

function promptText(params) {
  return (params.prompt ?? [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\\n");
}

const agent = {
  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: { name: "Fake Ordering Agent", version: "0.0.0" },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
      },
    };
  },
  async newSession() {
    return { sessionId: "roundtrip-session-1" };
  },
  async loadSession(params) {
    await sendUpdates(params.sessionId, sessionHistory.get(params.sessionId) ?? replayUpdates);
    return { models: null, configOptions: [] };
  },
  async prompt(params) {
    const updates = promptText(params).includes("roundtrip") ? roundTripUpdates : promptUpdates;
    sessionHistory.set(params.sessionId, updates);
    await sendUpdates(params.sessionId, updates);
    return { stopReason: "end_turn" };
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

function observeUpdate(update: any): ObservedSessionUpdate {
  const updateType = String(update?.sessionUpdate ?? "");
  const toolCallId = typeof update?.toolCallId === "string" ? update.toolCallId : undefined;
  const text = typeof update?.content?.text === "string" ? update.content.text : "";
  const source: "load" | "prompt" =
    toolCallId?.startsWith("prompt-") || text.startsWith("prompt ") ? "prompt" : "load";
  return toolCallId ? { source, updateType, toolCallId } : { source, updateType };
}

async function terminateChild(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 1_000);
    child.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill();
  });
}

async function withFakeAgent(
  run: (fixture: {
    agent: any;
    observed: ObservedSessionUpdate[];
    tempDir: string;
  }) => Promise<void>,
) {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-ordering-"));
  const fakeAgentPath = createFakeAgent(tempDir);
  const child = spawn(process.execPath, [fakeAgentPath], {
    cwd: tempDir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderrChunks: Buffer[] = [];
  child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
  const observed: ObservedSessionUpdate[] = [];
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout),
  );
  const agent = new acp.ClientSideConnection(
    () => ({
      async sessionUpdate(params: any) {
        observed.push(observeUpdate(params?.update));
      },
      async requestPermission() {
        return { outcome: { outcome: "cancelled" as const } };
      },
    }),
    stream,
  );

  try {
    await run({ agent, observed, tempDir });
  } catch (error) {
    const stderr = Buffer.concat(stderrChunks).toString("utf8");
    if (stderr.trim()) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nFake agent stderr:\n${stderr}`);
    }
    throw error;
  } finally {
    await terminateChild(child);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function withoutSource(update: ObservedSessionUpdate) {
  const { source: _source, ...rest } = update;
  return rest;
}

test("session/load replay and session/prompt live updates share one ordered notification channel", async () => {
  await withFakeAgent(async ({ agent, observed, tempDir }) => {
    await agent.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "tiller-test", version: "0.0.0" },
    });
    const loadResponse = await agent.loadSession({
      sessionId: "session-1",
      cwd: tempDir,
      mcpServers: [],
    });
    await agent.prompt({
      sessionId: "session-1",
      prompt: [{ type: "text", text: "run prompt" }],
    });

    assert.deepEqual(Object.keys(loadResponse).sort(), ["configOptions", "models"]);
    assert.deepEqual(observed, [
      { source: "load", updateType: "user_message_chunk" },
      { source: "load", updateType: "agent_message_chunk" },
      { source: "load", updateType: "tool_call", toolCallId: "load-tool-1" },
      { source: "load", updateType: "tool_call_update", toolCallId: "load-tool-1" },
      { source: "prompt", updateType: "user_message_chunk" },
      { source: "prompt", updateType: "agent_message_chunk" },
      { source: "prompt", updateType: "tool_call", toolCallId: "prompt-tool-1" },
      { source: "prompt", updateType: "tool_call_update", toolCallId: "prompt-tool-1" },
    ]);
  });
});

test("session/load replays the same ordered plan and tool updates produced live for the same session", async () => {
  await withFakeAgent(async ({ agent, observed, tempDir }) => {
    await agent.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "tiller-test", version: "0.0.0" },
    });
    const created = await agent.newSession({
      cwd: tempDir,
      mcpServers: [],
    });
    await agent.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "roundtrip" }],
    });
    const liveUpdates = observed.map(withoutSource);
    observed.length = 0;

    const loadResponse = await agent.loadSession({
      sessionId: created.sessionId,
      cwd: tempDir,
      mcpServers: [],
    });
    const replayUpdates = observed.map(withoutSource);

    assert.deepEqual(Object.keys(loadResponse).sort(), ["configOptions", "models"]);
    assert.deepEqual(liveUpdates, [
      { updateType: "user_message_chunk" },
      { updateType: "agent_message_chunk" },
      { updateType: "plan" },
      { updateType: "tool_call", toolCallId: "roundtrip-tool-1" },
      { updateType: "tool_call_update", toolCallId: "roundtrip-tool-1" },
      { updateType: "agent_message_chunk" },
    ]);
    assert.deepEqual(replayUpdates, liveUpdates);
  });
});
