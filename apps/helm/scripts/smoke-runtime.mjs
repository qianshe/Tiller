import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

const HOST = "127.0.0.1";
const ROOT = resolve(import.meta.dirname, "..");
const ENABLE_PROMPT_TRACE = process.argv.includes("--prompt-trace") || process.env.TILLER_PROMPT_TRACE === "1";
const STARTUP_TIMEOUT_MS = Number(process.env.TILLER_SMOKE_STARTUP_TIMEOUT_MS ?? 15_000);
const RPC_TIMEOUT_MS = Number(process.env.TILLER_SMOKE_RPC_TIMEOUT_MS ?? 10_000);

const port = Number(process.env.TILLER_SMOKE_PORT ?? await findFreePort());
const logs = [];
let child;

try {
  child = spawn(
    process.execPath,
    ["dist/index.js", "start", "--host", HOST, "--port", String(port)],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        TILLER_HOST: HOST,
        TILLER_PORT: String(port),
        ...(ENABLE_PROMPT_TRACE ? { TILLER_PROMPT_TRACE: "1" } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  child.once("exit", (code, signal) => {
    logs.push(`[smoke] helm exited code=${code} signal=${signal}\n`);
  });

  await waitForHttpReady(`http://${HOST}:${port}/`, STARTUP_TIMEOUT_MS);
  const httpResponse = await fetch(`http://${HOST}:${port}/`);
  const html = await httpResponse.text();
  assert(httpResponse.ok, `Deck HTTP status expected ok, got ${httpResponse.status}`);
  assert(html.includes('<div id="root"'), "Deck HTML root not found");

  const rpc = await createRpcClient(`ws://${HOST}:${port}`);
  try {
    const helmList = await rpc.request("helm/list", {});
    const projectList = await rpc.request("project/list", {});
    const agentList = await rpc.request("agent/list", {});

    console.log(JSON.stringify({
      ok: true,
      port,
      promptTrace: ENABLE_PROMPT_TRACE,
      http: { status: httpResponse.status, hasRoot: true },
      rpc: {
        helms: Array.isArray(helmList?.helms) ? helmList.helms.length : null,
        projects: Array.isArray(projectList?.projects) ? projectList.projects.length : null,
        agents: Array.isArray(agentList?.agents) ? agentList.agents.length : null,
      },
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
    throw new Error("Unable to allocate a smoke test port.");
  }
  return selectedPort;
}

async function waitForHttpReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) {
      throw new Error(`Helm exited before readiness. ${logs.join("").slice(-2000)}`);
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

async function stopChild(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) {
    return;
  }
  processHandle.kill();
  await Promise.race([
    once(processHandle, "exit"),
    delay(5_000).then(() => processHandle.kill("SIGKILL")),
  ]);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
