import { appendFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";

export type OneShotUpdaterLaunch = {
  updaterPath: string;
  nodeExecutable: string;
  helmEntryPath: string;
  helmArgs: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  parentPid: number;
  host: string;
  port: number;
  logPath: string;
  targetVersion?: string;
  currentVersion?: string;
};

export function spawnOneShotUpdater(input: OneShotUpdaterLaunch): ChildProcess {
  const child = spawn(input.nodeExecutable, [input.updaterPath], {
    cwd: input.cwd,
    env: encodeUpdaterLaunch(input),
    detached: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    shell: false,
    windowsHide: true,
  });
  child.unref();
  return child;
}

export function encodeUpdaterLaunch(input: OneShotUpdaterLaunch): NodeJS.ProcessEnv {
  return {
    ...input.env,
    TILLER_UPDATE_PARENT_PID: String(input.parentPid),
    TILLER_UPDATE_NODE: input.nodeExecutable,
    TILLER_UPDATE_HELM_ENTRY: input.helmEntryPath,
    TILLER_UPDATE_HELM_ARGS: JSON.stringify(input.helmArgs),
    TILLER_UPDATE_CWD: input.cwd,
    TILLER_UPDATE_HOST: input.host,
    TILLER_UPDATE_PORT: String(input.port),
    TILLER_UPDATE_LOG: input.logPath,
    TILLER_UPDATE_TARGET_VERSION: input.targetVersion ?? "",
    TILLER_UPDATE_CURRENT_VERSION: input.currentVersion ?? "",
  };
}

export function appendUpdateLog(path: string, message: string) {
  try {
    appendFileSync(path, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // Preserve the original update error if the log path is unavailable.
  }
}

export async function waitForProcessExit(
  pid: number,
  options: { timeoutMs?: number; pollMs?: number; sleep?: (delayMs: number) => Promise<void>; isProcessAlive?: (pid: number) => boolean } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 100;
  const sleep = options.sleep ?? ((delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const startedAt = Date.now();
  while (isProcessAlive(pid)) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for Helm process ${pid} to exit.`);
    }
    await sleep(pollMs);
  }
}

export async function waitForPortRelease(
  host: string,
  port: number,
  options: { timeoutMs?: number; pollMs?: number; sleep?: (delayMs: number) => Promise<void>; isPortOpen?: (host: string, port: number) => Promise<boolean> } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 100;
  const sleep = options.sleep ?? ((delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const isPortOpen = options.isPortOpen ?? defaultIsPortOpen;
  const probeHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const startedAt = Date.now();
  while (await isPortOpen(probeHost, port)) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for port ${port} to be released.`);
    }
    await sleep(pollMs);
  }
}

export async function waitForPortOpen(
  host: string,
  port: number,
  options: { timeoutMs?: number; pollMs?: number; sleep?: (delayMs: number) => Promise<void>; isPortOpen?: (host: string, port: number) => Promise<boolean> } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 100;
  const sleep = options.sleep ?? ((delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const isPortOpen = options.isPortOpen ?? defaultIsPortOpen;
  const probeHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const startedAt = Date.now();
  while (!(await isPortOpen(probeHost, port))) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for Helm to listen on port ${port}.`);
    }
    await sleep(pollMs);
  }
}

function defaultIsProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EPERM");
  }
}

function defaultIsPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}
