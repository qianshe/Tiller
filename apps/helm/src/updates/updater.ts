import { spawn, type ChildProcess } from "node:child_process";
import { fetchTillerNpmDistTags } from "./npm-registry.js";
import { runLatestUpdate } from "./installer.js";
import { isVersionGreater } from "./versions.js";
import {
  appendUpdateLog,
  resolveReplacementSpawnOptions,
  waitForPortOpen,
  waitForPortRelease,
  waitForProcessExit,
  waitForReplacementExit,
} from "./updater-runtime.js";

const UPDATER_LAUNCH_ENV_KEYS = [
  "TILLER_UPDATE_PARENT_PID",
  "TILLER_UPDATE_NODE",
  "TILLER_UPDATE_HELM_ENTRY",
  "TILLER_UPDATE_HELM_ARGS",
  "TILLER_UPDATE_CWD",
  "TILLER_UPDATE_HOST",
  "TILLER_UPDATE_PORT",
  "TILLER_UPDATE_LOG",
  "TILLER_UPDATE_INTERACTIVE",
  "TILLER_UPDATE_TARGET_VERSION",
  "TILLER_UPDATE_CURRENT_VERSION",
] as const;

export type UpdaterDependencies = {
  fetchTags?: typeof fetchTillerNpmDistTags;
  install?: () => Promise<number>;
  waitForExit?: typeof waitForProcessExit;
  waitForPort?: typeof waitForPortRelease;
  waitForReady?: typeof waitForPortOpen;
  spawnHelm?: (input: {
    nodeExecutable: string;
    entryPath: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    interactive: boolean;
  }) => ChildProcess | void | Promise<ChildProcess | void>;
  send?: (message: { kind: "status" | "shutdown"; status?: string; message?: string }) => Promise<void>;
};

export async function runOneShotUpdater(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: UpdaterDependencies = {},
): Promise<number> {
  const parentPid = readNumber(env.TILLER_UPDATE_PARENT_PID);
  const port = readNumber(env.TILLER_UPDATE_PORT);
  const currentVersion = env.TILLER_UPDATE_CURRENT_VERSION?.trim();
  const nodeExecutable = env.TILLER_UPDATE_NODE;
  const entryPath = env.TILLER_UPDATE_HELM_ENTRY;
  const cwd = env.TILLER_UPDATE_CWD ?? process.cwd();
  const host = env.TILLER_UPDATE_HOST ?? "127.0.0.1";
  const logPath = env.TILLER_UPDATE_LOG ?? "";
  const args = parseArgs(env.TILLER_UPDATE_HELM_ARGS);
  const send = dependencies.send ?? sendProcessMessage;
  const fetchTags = dependencies.fetchTags ?? fetchTillerNpmDistTags;
  const install = dependencies.install ?? runLatestUpdate;
  const waitForExit = dependencies.waitForExit ?? waitForProcessExit;
  const waitForPort = dependencies.waitForPort ?? waitForPortRelease;
  const waitForReady = dependencies.waitForReady ?? waitForPortOpen;
  const spawnHelm = dependencies.spawnHelm ?? spawnReplacementHelm;

  try {
    if (!parentPid || !port || !currentVersion || !nodeExecutable || !entryPath) {
      throw new Error("Updater launch metadata is incomplete.");
    }
    const tags = await fetchTags();
    const latestVersion = tags.latest;
    if (!latestVersion) {
      throw new Error("npm registry did not return a latest version.");
    }
    if (!isVersionGreater(latestVersion, currentVersion)) {
      await send({ kind: "status", status: "up-to-date", message: "Helm 已是最新版本。" });
      return 0;
    }

    const exitCode = await install();
    if (exitCode !== 0) {
      throw new Error(`npm install exited with code ${exitCode}.`);
    }
    await send({ kind: "status", status: "restarting", message: "更新安装完成，等待 Helm 重启。" });
    await send({ kind: "shutdown" });
    await waitForExit(parentPid);
    await waitForPort(host, port);
    const interactive = env.TILLER_UPDATE_INTERACTIVE === "1";
    const replacement = await spawnHelm({
      nodeExecutable,
      entryPath,
      args,
      cwd,
      env: stripUpdaterEnvironment(env),
      interactive,
    });
    await waitForReady(host, port);
    if (interactive && replacement) {
      await waitForReplacementExit(replacement);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (logPath) appendUpdateLog(logPath, message);
    await send({ kind: "status", status: "failed", message }).catch(() => undefined);
    return 1;
  }
}

if (process.argv[1]?.endsWith("updater.js")) {
  process.exitCode = await runOneShotUpdater();
}

async function spawnReplacementHelm(input: {
  nodeExecutable: string;
  entryPath: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  interactive: boolean;
}): Promise<ChildProcess> {
  const { interactive } = input;
  const child = spawn(input.nodeExecutable, [input.entryPath, ...input.args], {
    cwd: input.cwd,
    env: input.env,
    ...resolveReplacementSpawnOptions(input.interactive),
  });
  if (!interactive) {
    child.unref();
  }
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", reject);
  });
  return child;
}

function sendProcessMessage(message: { kind: "status" | "shutdown"; status?: string; message?: string }) {
  return new Promise<void>((resolve) => {
    if (!process.send) {
      resolve();
      return;
    }
    process.send(message, () => resolve());
  });
}

function parseArgs(value: string | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function readNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function stripUpdaterEnvironment(env: NodeJS.ProcessEnv) {
  const next = { ...env };
  for (const key of UPDATER_LAUNCH_ENV_KEYS) {
    delete next[key];
  }
  return next;
}
