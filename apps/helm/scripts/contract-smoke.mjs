import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { WebSocket } from "ws";

const RPC_TIMEOUT_MS = Number(process.env.TILLER_CONTRACT_SMOKE_RPC_TIMEOUT_MS ?? 10_000);
const STARTUP_TIMEOUT_MS = Number(process.env.TILLER_CONTRACT_SMOKE_STARTUP_TIMEOUT_MS ?? 15_000);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export function resolveContractSmokeTarget(baseUrl) {
  const url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
  return {
    httpRoot: url.toString(),
    wsUrl: `${wsProtocol}//${url.host}${url.pathname}`,
  };
}

export function assertInventoryResultShapes(helmList, projectList, agentList, sessionList) {
  if (!Array.isArray(helmList?.helms)) {
    throw new Error("helm/list result must include helms array");
  }
  if (!Array.isArray(projectList?.projects)) {
    throw new Error("project/list result must include projects array");
  }
  if (!Array.isArray(agentList?.agents)) {
    throw new Error("agent/list result must include agents array");
  }
  if (!Array.isArray(sessionList?.sessions)) {
    throw new Error("session/list result must include sessions array");
  }
}

export function summarizeInventoryResults({ helmList, projectList, agentList, sessionList }) {
  assertInventoryResultShapes(helmList, projectList, agentList, sessionList);
  return {
    helms: helmList.helms.length,
    projects: projectList.projects.length,
    agents: agentList.agents.length,
    sessions: sessionList.sessions.length,
  };
}

async function main() {
  const target = process.argv[2] ?? process.env.TILLER_CONTRACT_SMOKE_BASE_URL;
  if (!target) {
    console.error(JSON.stringify({ ok: false, error: "Missing base URL. Pass one argument or set TILLER_CONTRACT_SMOKE_BASE_URL." }, null, 2));
    process.exitCode = 1;
    return;
  }

  const { httpRoot, wsUrl } = resolveContractSmokeTarget(target);
  const timings = {};
  const startedAt = Date.now();

  try {
    await waitForHttpReady(httpRoot, STARTUP_TIMEOUT_MS);
    markTiming(timings, startedAt, "httpReadyMs");
    const httpResponse = await fetch(httpRoot);
    const html = await httpResponse.text();
    assert(httpResponse.ok, `HTTP status expected ok, got ${httpResponse.status}`);
    assert(html.includes('<div id="root"') || html.length > 0, "HTTP root response is empty");

    const rpc = await createRpcClient(wsUrl);
    markTiming(timings, startedAt, "webSocketOpenMs");
    try {
      const helmList = await rpc.request("helm/list", {});
      markTiming(timings, startedAt, "firstRpcMs");
      const projectList = await rpc.request("project/list", {});
      const agentList = await rpc.request("agent/list", {});
      const sessionList = await rpc.request("session/list", {});
      const rpcSummary = summarizeInventoryResults({ helmList, projectList, agentList, sessionList });
      console.log(JSON.stringify({ ok: true, target: httpRoot, timings, http: { status: httpResponse.status }, rpc: rpcSummary }));
    } finally {
      rpc.close();
    }
  } catch (error) {
    console.error(JSON.stringify({ ok: false, target: httpRoot, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  }
}

function markTiming(timings, startedAt, name) {
  timings[name] = Date.now() - startedAt;
}

async function waitForHttpReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function createRpcClient(url) {
  const socket = new WebSocket(url);
  await withTimeout(once(socket, "open"), RPC_TIMEOUT_MS, "Timed out opening WebSocket");
  let nextId = 1;
  const pending = new Map();

  socket.on("message", (data) => {
    const message = JSON.parse(String(data));
    if (!("id" in message) || !pending.has(message.id)) {
      return;
    }
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(`${message.error.code}: ${message.error.message}`));
      return;
    }
    resolve(message.result);
  });

  socket.on("error", (error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  });

  return {
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for RPC ${method}`));
        }, RPC_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
