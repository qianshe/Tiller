#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const requireFromAcp = createRequire(import.meta.url);
const requireFromHelm = createRequire(
  pathToFileURL(join(repoRoot, "apps/helm/package.json")).href,
);
const sdkImportUrl = pathToFileURL(
  requireFromAcp.resolve("@agentclientprotocol/sdk"),
).href;
const wsModule = await import(pathToFileURL(requireFromHelm.resolve("ws")).href);
const WebSocket = wsModule.WebSocket ?? wsModule.default;

const RUNTIME_SESSION_ID = "validation-codex-runtime-session";
const PROMPT_TEXT = "ACP UI validation prompt unique 2026-06-08";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "setup") {
    await setup();
    return;
  }
  if (command === "reimport") {
    await reimport(readStatePath(args));
    return;
  }
  if (command === "cleanup") {
    cleanup(readStatePath(args));
    return;
  }
  usage();
  process.exitCode = 2;
}

function usage() {
  console.error([
    "Usage:",
    "  node packages/acp-runtime/scripts/validate-acp-reimport-ui.mjs setup",
    "  node packages/acp-runtime/scripts/validate-acp-reimport-ui.mjs reimport --state <state.json>",
    "  node packages/acp-runtime/scripts/validate-acp-reimport-ui.mjs cleanup --state <state.json>",
  ].join("\n"));
}

function readStatePath(args) {
  const index = args.indexOf("--state");
  const statePath = index >= 0 ? args[index + 1] : undefined;
  if (!statePath) {
    usage();
    process.exit(2);
  }
  return statePath;
}

async function setup() {
  const tempRoot = await mkdtemp(join(tmpdir(), "tiller-acp-ui-"));
  const home = join(tempRoot, "home");
  const configDir = join(home, ".config", "tiller");
  const projectDir = join(configDir, "projects", "acp-validation");
  const codexHome = join(home, ".codex");
  const fakeDir = join(tempRoot, "fake-agent");
  const port = await getFreePort();
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(join(codexHome, "sessions", "2026", "06", "08"), {
    recursive: true,
  });
  mkdirSync(fakeDir, { recursive: true });

  const fakeAgentPath = join(fakeDir, "fake-codex-acp-agent.mjs");
  const fakeHistoryPath = join(fakeDir, "history.json");
  const fakeLogPath = join(fakeDir, "agent-log.jsonl");
  writeFileSync(
    fakeAgentPath,
    fakeAgentSource({ fakeHistoryPath, fakeLogPath }),
    "utf8",
  );
  writeConfig({ configDir, fakeAgentPath, port });
  writeProjectYaml({ projectDir });
  writeCodexAdapterHistory({ codexHome });

  const helmLogPath = join(tempRoot, "helm.log");
  const helm = startHelm({ home, codexHome, port, helmLogPath });
  const state = {
    tempRoot,
    home,
    configDir,
    codexHome,
    fakeAgentPath,
    fakeHistoryPath,
    fakeLogPath,
    helmLogPath,
    helmPid: helm.pid,
    port,
    runtimeSessionId: RUNTIME_SESSION_ID,
    promptText: PROMPT_TEXT,
  };
  const statePath = join(tempRoot, "state.json");
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
  await waitForHttp(port);

  const rpc = new RpcClient(port);
  await rpc.open();
  try {
    const created = await rpc.request("session/new", {
      projectId: "acp-validation",
      cwd: repoRoot.replace(/\\/g, "/"),
      agentId: "codex",
    });
    const sessionId = created.session.id;
    await rpc.request("session/prompt", {
      sessionId,
      text: PROMPT_TEXT,
      clientMessageId: `${sessionId}-client-validation`,
    });
    const before = await waitForLiveTimeline(rpc, sessionId);
    const nextState = {
      ...state,
      statePath,
      sessionId,
      beforeBackendTimeline: summarizeTimeline(before.timeline),
    };
    await writeFile(statePath, JSON.stringify(nextState, null, 2), "utf8");
    console.log(JSON.stringify(nextState, null, 2));
  } finally {
    rpc.close();
  }
}

async function reimport(statePath) {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const rpc = new RpcClient(state.port);
  await rpc.open();
  try {
    const reimported = await rpc.request("session/reimport_history", {
      sessionId: state.sessionId,
      limit: 100,
    });
    const after = await rpc.request("session/list_messages", {
      sessionId: state.sessionId,
      limit: 100,
    });
    const artifacts = await rpc.request("session/get_artifacts", {
      sessionId: state.sessionId,
      limit: 100,
    });
    const agentLog = readAgentLog(state.fakeLogPath);
    const result = {
      ...state,
      acpCalls: agentLog.map((entry) => entry.event),
      reimportResultTimeline: summarizeTimeline(reimported.timeline),
      reimportPlanEntries: (reimported.plan?.entries ?? []).map((entry) => entry.content),
      afterBackendTimeline: summarizeTimeline(after.timeline),
      afterArtifactsPlanEntries: (artifacts.plan?.entries ?? []).map((entry) => entry.content),
      usedAdapterAfterReimport: JSON.stringify(after.timeline).includes("ADAPTER assistant after tool"),
      usedAcpAfterReimport: JSON.stringify(after.timeline).includes("ACP assistant after tool"),
    };
    await writeFile(statePath, JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    rpc.close();
  }
}

function cleanup(statePath) {
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (state.helmPid) {
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/pid", String(state.helmPid), "/t", "/f"], {
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(state.helmPid, "SIGTERM");
      } catch {
        // already stopped
      }
    }
  }
  rmSync(state.tempRoot, { recursive: true, force: true });
  console.log(JSON.stringify({ cleaned: true, tempRoot: state.tempRoot }));
}

function fakeAgentSource({ fakeHistoryPath, fakeLogPath }) {
  return `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import * as acp from ${JSON.stringify(sdkImportUrl)};

let client;
const runtimeSessionId = ${JSON.stringify(RUNTIME_SESSION_ID)};
const historyPath = ${JSON.stringify(fakeHistoryPath)};
const logPath = ${JSON.stringify(fakeLogPath)};

function log(event, data = {}) {
  appendFileSync(logPath, JSON.stringify({ event, ...data }) + "\\n", "utf8");
}

function readHistory() {
  if (!existsSync(historyPath)) return {};
  return JSON.parse(readFileSync(historyPath, "utf8"));
}

function writeHistory(history) {
  writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf8");
}

function promptTextFrom(params) {
  return (params.prompt ?? [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\\n");
}

function updatesFor(text) {
  return [
    { sessionUpdate: "user_message_chunk", messageId: "live-user-1", content: { type: "text", text } },
    { sessionUpdate: "agent_message_chunk", messageId: "live-assistant-1", content: { type: "text", text: "ACP assistant before tool" } },
    { sessionUpdate: "plan", entries: [
      { content: "ACP plan step one", priority: "high", status: "completed" },
      { content: "ACP plan step two", priority: "medium", status: "in_progress" },
    ] },
    { sessionUpdate: "tool_call", toolCallId: "live-tool-1", title: "live-tool-1", kind: "execute", status: "in_progress", rawInput: { server: "fake_mcp", tool: "timeline_probe", arguments: { source: "acp-live" } } },
    { sessionUpdate: "tool_call_update", toolCallId: "live-tool-1", status: "completed", rawOutput: "ACP tool output" },
    { sessionUpdate: "agent_message_chunk", messageId: "live-assistant-1", content: { type: "text", text: "ACP assistant after tool" } },
  ];
}

async function sendUpdates(sessionId, updates) {
  for (const update of updates) {
    await client.sessionUpdate({ sessionId, update });
  }
}

const agent = {
  async initialize() {
    log("initialize");
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: { name: "Fake Codex ACP", version: "0.0.0" },
      agentCapabilities: {
        loadSession: true,
        session: { load: {}, resume: {}, list: {} },
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
      },
    };
  },
  async newSession(params) {
    log("newSession", { cwd: params.cwd });
    return { sessionId: runtimeSessionId, _meta: { cwd: params.cwd } };
  },
  async loadSession(params) {
    const updates = readHistory()[params.sessionId] ?? [];
    log("loadSession", { sessionId: params.sessionId, updates: updates.length });
    await sendUpdates(params.sessionId, updates);
    return { models: null, configOptions: [] };
  },
  async prompt(params) {
    const text = promptTextFrom(params);
    const updates = updatesFor(text);
    const history = readHistory();
    history[params.sessionId] = updates;
    writeHistory(history);
    log("prompt", { sessionId: params.sessionId, updates: updates.length, text });
    await sendUpdates(params.sessionId, updates);
    return { stopReason: "end_turn" };
  },
  async listSessions() {
    return { sessions: [{ sessionId: runtimeSessionId, title: "Validation Codex Session" }] };
  },
  async resumeSession() {
    return {};
  },
  async authenticate() {
    return {};
  },
};

const input = Readable.toWeb(process.stdin);
const output = Writable.toWeb(process.stdout);
new acp.AgentSideConnection((agentClient) => {
  client = agentClient;
  return agent;
}, acp.ndJsonStream(output, input));
`;
}

function writeConfig({ configDir, fakeAgentPath, port }) {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify({
      daemon: { host: "127.0.0.1", port, auth: "none" },
      updates: { checkOnStart: false, previewHint: false },
      logging: { level: "debug", format: "pretty", acpTrace: "summary" },
      helms: [{ id: "local-helm", name: "Local Helm", host: "127.0.0.1", port }],
      agents: [
        {
          id: "codex",
          name: "Codex Validation",
          kind: "custom",
          command: process.execPath,
          args: [fakeAgentPath],
          transport: "stdio",
          protocol: "acp",
          capabilities: { sessionLoad: true, sessionList: true },
          initializeTimeoutMs: 10000,
          promptTimeoutMs: 30000,
        },
      ],
    }, null, 2),
    "utf8",
  );
}

function writeProjectYaml({ projectDir }) {
  writeFileSync(
    join(projectDir, "project.yaml"),
    [
      "id: acp-validation",
      "name: ACP Validation",
      "helmId: local-helm",
      `path: ${repoRoot.replace(/\\/g, "/")}`,
      "worktrees:",
      "  - name: validation-worktree",
      `    path: ${repoRoot.replace(/\\/g, "/")}`,
      "    branch: issue/acp-session-update-validation",
      "    kind: root",
      "",
    ].join("\n"),
    "utf8",
  );
}

function writeCodexAdapterHistory({ codexHome }) {
  const historyDir = join(codexHome, "sessions", "2026", "06", "08");
  const lines = [
    {
      timestamp: "2026-06-08T01:00:00.000Z",
      type: "event_msg",
      payload: { type: "user_message", client_id: "adapter-user-1", message: PROMPT_TEXT },
    },
    {
      timestamp: "2026-06-08T01:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        id: "adapter-assistant-before",
        role: "assistant",
        content: [{ type: "output_text", text: "ADAPTER assistant before tool" }],
      },
    },
    {
      timestamp: "2026-06-08T01:00:02.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        call_id: "adapter-tool-1",
        name: "timeline_probe",
        namespace: "mcp",
        arguments: JSON.stringify({ source: "adapter-history" }),
      },
    },
    {
      timestamp: "2026-06-08T01:00:03.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "adapter-tool-1",
        output: "ADAPTER tool output",
      },
    },
    {
      timestamp: "2026-06-08T01:00:04.000Z",
      type: "response_item",
      payload: {
        type: "message",
        id: "adapter-assistant-after",
        role: "assistant",
        content: [{ type: "output_text", text: "ADAPTER assistant after tool" }],
      },
    },
  ];
  writeFileSync(
    join(historyDir, `${RUNTIME_SESSION_ID}.jsonl`),
    lines.map((line) => JSON.stringify(line)).join("\n"),
    "utf8",
  );
}

function startHelm({ home, codexHome, port, helmLogPath }) {
  const pnpm = resolvePnpmCommand();
  const out = writeFileSync(helmLogPath, "", "utf8");
  void out;
  const logFd = openSync(helmLogPath, "a");
  const child = spawn(
    pnpm,
    ["--filter", "@tiller/helm", "exec", "tsx", "src/app/main.ts"],
    {
      cwd: repoRoot,
      detached: true,
      shell: process.platform === "win32",
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        USERPROFILE: home,
        HOME: home,
        CODEX_HOME: codexHome,
        TILLER_HOST: "127.0.0.1",
        TILLER_PORT: String(port),
        TILLER_AUTH: "none",
        TILLER_UPDATE_CHECK: "0",
        TILLER_UPDATE_PREVIEW_HINT: "0",
        TILLER_LOG_LEVEL: "debug",
        TILLER_LOG_FORMAT: "pretty",
        TILLER_ACP_TRACE: "summary",
      },
    },
  );
  child.unref();
  return child;
}

function resolvePnpmCommand() {
  if (process.env.npm_execpath?.includes("pnpm")) {
    return process.env.npm_execpath;
  }
  const where = process.platform === "win32"
    ? spawnSync("where.exe", ["pnpm.cmd"], { encoding: "utf8" })
    : spawnSync("which", ["pnpm"], { encoding: "utf8" });
  const found = where.stdout.split(/\r?\n/u).find(Boolean)?.trim();
  return found || "pnpm";
}

async function getFreePort() {
  const { default: net } = await import("node:net");
  return await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForHttp(port) {
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/mission`);
    return response.ok;
  }, 60000, "Helm server");
}

async function waitForLiveTimeline(rpc, sessionId) {
  return await waitFor(async () => {
    const list = await rpc.request("session/list_messages", { sessionId, limit: 100 });
    return JSON.stringify(list.timeline).includes("ACP assistant after tool")
      ? list
      : null;
  }, 30000, "live ACP prompt persistence");
}

async function waitFor(check, timeoutMs, label) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

class RpcClient {
  constructor(port) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`);
    this.openPromise = new Promise((resolveOpen, rejectOpen) => {
      this.socket.once("open", resolveOpen);
      this.socket.once("error", rejectOpen);
    });
    this.socket.on("message", (data) => this.handleMessage(data));
  }

  async open() {
    await this.openPromise;
  }

  async request(method, params, timeoutMs = 180000) {
    await this.open();
    const id = this.nextId++;
    return await new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolveRequest(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectRequest(error);
        },
      });
      this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  handleMessage(data) {
    const message = JSON.parse(Buffer.from(data).toString("utf8"));
    if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      return;
    }
    pending.resolve(message.result);
  }

  close() {
    this.socket.close();
  }
}

function summarizeTimeline(timeline) {
  const items = [];
  for (const entry of timeline ?? []) {
    if (entry.kind === "user_message") {
      items.push({
        sequence: entry.timelineSequence ?? entry.message?.timelineSequence,
        text: `user:${entry.message?.text ?? ""}`,
      });
      continue;
    }
    if (entry.kind === "tool_call") {
      items.push({
        sequence: entry.timelineSequence ?? entry.toolCall?.timelineSequence,
        text: `tool:${entry.toolCall?.title ?? entry.toolCall?.id ?? ""}`,
      });
      continue;
    }
    if (entry.kind === "assistant_message") {
      for (const chunk of entry.chunks ?? []) {
        items.push({
          sequence: chunk.timelineSequence ?? entry.timelineSequence,
          text: `assistant:${chunk.text ?? chunk.toolCall?.title ?? ""}`,
        });
      }
      continue;
    }
    items.push({
      sequence: entry.timelineSequence,
      text: `${entry.kind}:${JSON.stringify(entry).slice(0, 80)}`,
    });
  }
  return items
    .sort((left, right) => {
      if (typeof left.sequence === "number" && typeof right.sequence === "number") {
        return left.sequence - right.sequence;
      }
      return 0;
    })
    .map((item) => item.text);
}

function readAgentLog(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

await main();
