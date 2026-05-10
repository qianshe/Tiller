import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { AcpAgentProvider } from "@tiller/shared";
import { resolveAcpLaunchConfig } from "./adapters";
import { createProtocolStdoutStream, resolveLaunchSpec, terminateChildProcess } from "./process";
import { ACP_LOGS_DIR, sanitizeLogToken, writeChunkLog, writeLogLine } from "./protocol-logging";
import { SDK_PROBE_CLIENT_CAPABILITIES } from "./sdk-helpers";
import { resolve } from "node:path";

const ACP_INITIALIZE_TIMEOUT_MS = 30_000;

export async function testAcpConnection(provider: AcpAgentProvider, cwd = process.cwd()) {
  const launchConfig = resolveAcpLaunchConfig(provider, { fallbackCwd: cwd });
  const launchSpec = resolveLaunchSpec(launchConfig.command, launchConfig.args);
  const launchCwd = launchConfig.cwd;
  const childEnv = { ...process.env, ...launchConfig.env };
  delete childEnv.NODE_OPTIONS;
  delete childEnv.TSX_TSCONFIG_PATH;
  delete childEnv.TSX_DISABLE_CACHE;
  const initializeTimeoutMs = provider.initializeTimeoutMs ?? ACP_INITIALIZE_TIMEOUT_MS;
  const logFile = resolve(ACP_LOGS_DIR, `connection-test-${sanitizeLogToken(provider.id)}.log`);

  writeLogLine(
    logFile,
    "meta",
    `Starting ACP SDK connection test command=${launchSpec.command} args=${JSON.stringify(launchSpec.args)} cwd=${launchCwd}`,
  );

  const child = spawn(launchSpec.command, launchSpec.args, {
    cwd: launchCwd,
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderrBuffer = "";
  const processClosed = new Promise<never>((_resolve, reject) => {
    child.once("error", (error) => {
      writeLogLine(logFile, "process-error", error.message);
      reject(new Error(`Failed to start ACP command: ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      const message = `ACP SDK connection test exited code=${code ?? "unknown"} signal=${signal ?? "unknown"}`;
      writeLogLine(logFile, "exit", message);
      reject(new Error(stderrBuffer.trim() ? `${message}: ${stderrBuffer.trim()}` : message));
    });
  });
  processClosed.catch(() => {});

  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    stderrBuffer += text;
    writeChunkLog(logFile, "stderr", text);
  });

  const protocolStdout = createProtocolStdoutStream(child.stdout, (line) => {
    writeLogLine(logFile, "stdout-discarded", `Discarded non-JSON ACP stdout line (${line.length} chars)`);
  });
  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(protocolStdout));
  const agent = new acp.ClientSideConnection(() => ({
    async sessionUpdate() {
      return undefined;
    },
    async requestPermission() {
      return { outcome: { outcome: "cancelled" } } satisfies acp.RequestPermissionResponse;
    },
    async readTextFile() {
      throw acp.RequestError.methodNotFound("fs/read_text_file");
    },
    async writeTextFile() {
      throw acp.RequestError.methodNotFound("fs/write_text_file");
    },
  }), stream);

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(stderrBuffer.trim() || "Timed out waiting for ACP initialize response."));
    }, initializeTimeoutMs);
  });

  try {
    writeLogLine(logFile, "sdk-request", "initialize");
    const initializeResult = await Promise.race([
      agent.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: SDK_PROBE_CLIENT_CAPABILITIES,
        clientInfo: { name: "tiller", version: "0.1.0" },
      }),
      timeout,
      processClosed,
    ]);
    const agentName = initializeResult.agentInfo?.name ?? provider.name;
    const version = initializeResult.agentInfo?.version ? ` v${initializeResult.agentInfo.version}` : "";
    return { ok: true, message: `ACP initialize passed for ${agentName}${version}.` };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to initialize ACP agent.",
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    terminateChildProcess(child.pid);
  }
}
