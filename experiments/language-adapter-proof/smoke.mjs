import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const requireFromHelm = createRequire(new URL("../../apps/helm/package.json", import.meta.url));
const { WebSocket } = requireFromHelm("ws");

const HOST = "127.0.0.1";
const STARTUP_TIMEOUT_MS = Number(process.env.TILLER_ADAPTER_PROOF_STARTUP_TIMEOUT_MS ?? 10_000);
const RPC_TIMEOUT_MS = Number(process.env.TILLER_ADAPTER_PROOF_RPC_TIMEOUT_MS ?? 5_000);

const port = Number(process.env.TILLER_ADAPTER_PROOF_PORT ?? await findFreePort());
const startedAt = Date.now();
const timings = {};
const logs = [];
let child;

try {
  child = spawn(process.execPath, ["server.mjs", "--host", HOST, "--port", String(port)], {
    cwd: new URL(".", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));

  await waitForHttpReady(`http://${HOST}:${port}/`, STARTUP_TIMEOUT_MS);
  markTiming("httpReadyMs");

  const httpResponse = await fetch(`http://${HOST}:${port}/`);
  const html = await httpResponse.text();
  assert(httpResponse.ok, `HTTP status expected ok, got ${httpResponse.status}`);
  assert(html.includes("Language Adapter Proof"), "HTTP root did not expose proof shell");

  const rpc = await createRpcClient(`ws://${HOST}:${port}`);
  markTiming("webSocketOpenMs");
  try {
    const helmList = await rpc.request("helm/list", {});
    markTiming("firstRpcMs");
    const projectList = await rpc.request("project/list", {});
    const agentList = await rpc.request("agent/list", {});
    const sessionList = await rpc.request("session/list", {});

    assertInventoryResultShapes({ helmList, projectList, agentList, sessionList });
    await assertUnsupportedMethod(rpc);

    console.log(JSON.stringify({
      ok: true,
      target: `http://${HOST}:${port}/`,
      timings,
      http: { status: httpResponse.status },
      rpc: summarizeInventoryResults({ helmList, projectList, agentList, sessionList }),
    }));
  } finally {
    rpc.close();
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    port,
    error: error instanceof Error ? error.message : String(error),
    logs: logs.join("").slice(-4000),
  }, null, 2));
  process.exitCode = 1;
} finally {
  await stopChild(child);
}

async function findFreePort() {
  const server = createServer();
  server.listen(0, HOST);
  await once(server, "listening");
  const address = server.address();
  const selectedPort = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  if (!selectedPort) {
    throw new Error("Unable to allocate a proof smoke port.");
  }
  return selectedPort;
}

function markTiming(name) {
  timings[name] = Date.now() - startedAt;
}

async function waitForHttpReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) {
      throw new Error(`Adapter proof exited before readiness. ${logs.join("").slice(-2000)}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
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
      reject(Object.assign(new Error(`${message.error.code}: ${message.error.message}`), { rpcError: message.error }));
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

async function assertUnsupportedMethod(rpc) {
  try {
    await rpc.request("session/prompt", {});
  } catch (error) {
    assert(error?.rpcError?.code === -32601, "Unsupported methods must return MethodNotFound");
    return;
  }
  throw new Error("Unsupported method unexpectedly succeeded");
}

function summarizeInventoryResults({ helmList, projectList, agentList, sessionList }) {
  return {
    helms: helmList.helms.length,
    projects: projectList.projects.length,
    agents: agentList.agents.length,
    sessions: sessionList.sessions.length,
  };
}

function assertInventoryResultShapes({ helmList, projectList, agentList, sessionList }) {
  assert(Array.isArray(helmList?.helms), "helm/list must return { helms: [] }");
  assert(Array.isArray(projectList?.projects), "project/list must return { projects: [] }");
  assert(Array.isArray(agentList?.agents), "agent/list must return { agents: [] }");
  assert(Array.isArray(sessionList?.sessions), "session/list must return { sessions: [] }");
  assert(sessionList.hasMore === false, "session/list must expose hasMore=false for provider-free proof");
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

async function stopChild(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) {
    return;
  }
  processHandle.kill();
  await Promise.race([
    once(processHandle, "exit"),
    delay(2_000).then(() => processHandle.kill("SIGKILL")),
  ]);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
