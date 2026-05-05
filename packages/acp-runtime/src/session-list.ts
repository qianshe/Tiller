import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { AcpAgentProvider, AcpAgentSessionInfo, WorkspaceSummary } from "@tiller/shared";
import { resolveSessionCapabilities } from "./capabilities";
import { resolveAcpLaunchConfig } from "./adapters";
import { resolveLaunchSpec, terminateChildProcess } from "./process";
import { ACP_LOGS_DIR, sanitizeLogToken, writeChunkLog, writeLogLine } from "./protocol-logging";
import { SDK_PROBE_CLIENT_CAPABILITIES } from "./sdk-helpers";
import type { AcpAgentSessionListResult } from "./runtime-types";

const ACP_INITIALIZE_TIMEOUT_MS = 30_000;

export function normalizeAcpAgentSessionListResult(result: any): AcpAgentSessionListResult {
  const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
  return {
    sessions: sessions
      .map((item: any) => ({
        sessionId: String(item?.sessionId ?? item?.session_id ?? item?.id ?? ""),
        cwd: typeof item?.cwd === "string" ? item.cwd : undefined,
        title: typeof item?.title === "string" ? item.title : undefined,
        updatedAt:
          typeof item?.updatedAt === "string"
            ? item.updatedAt
            : typeof item?.updated_at === "string"
              ? item.updated_at
              : undefined,
        meta: item?.meta,
      }))
      .filter((item: AcpAgentSessionInfo) => item.sessionId.length > 0),
    nextCursor:
      typeof result?.nextCursor === "string"
        ? result.nextCursor
        : typeof result?.next_cursor === "string"
          ? result.next_cursor
          : undefined,
    meta: result?.meta,
  };
}

export async function listAcpAgentSessions(
  provider: AcpAgentProvider,
  workspace: WorkspaceSummary,
  cursor?: string,
): Promise<AcpAgentSessionListResult> {
  const launchConfig = resolveAcpLaunchConfig(provider, { fallbackCwd: workspace.path });
  const launchSpec = resolveLaunchSpec(launchConfig.command, launchConfig.args);
  const launchCwd = launchConfig.cwd;
  const childEnv = { ...process.env, ...launchConfig.env };
  delete childEnv.NODE_OPTIONS;
  delete childEnv.TSX_TSCONFIG_PATH;
  delete childEnv.TSX_DISABLE_CACHE;
  const logFile = resolve(ACP_LOGS_DIR, `session-list-${sanitizeLogToken(provider.id)}.log`);

  writeLogLine(
    logFile,
    "meta",
    `Starting ACP SDK session list command=${launchSpec.command} args=${JSON.stringify(launchSpec.args)} cwd=${launchCwd}`,
  );

  const child = spawn(launchSpec.command, launchSpec.args, {
    cwd: launchCwd,
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderrBuffer = "";
  let exitError: Error | null = null;

  const exited = new Promise<never>((_resolve, reject) => {
    child.once("exit", (code, signal) => {
      const message = `ACP SDK session list process exited code=${code ?? "unknown"} signal=${signal ?? "unknown"}`;
      exitError = new Error(stderrBuffer.trim() ? `${message}: ${stderrBuffer.trim()}` : message);
      writeLogLine(logFile, "exit", message);
      reject(exitError);
    });
  });
  exited.catch(() => {});

  child.on("error", (error) => {
    writeLogLine(logFile, "process-error", error.message);
    exitError = error;
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    stderrBuffer += text;
    writeChunkLog(logFile, "stderr", text);
  });

  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
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

  const withSdkRequest = async <T>(
    method: string,
    operation: Promise<T>,
    timeoutMs = provider.initializeTimeoutMs ?? ACP_INITIALIZE_TIMEOUT_MS,
  ): Promise<T> => {
    if (exitError) {
      throw exitError;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(stderrBuffer.trim() || `Timed out waiting for ACP response: ${method}`));
      }, timeoutMs);
    });
    try {
      writeLogLine(logFile, "sdk-request", method);
      return await Promise.race([operation, timeoutPromise, exited]);
    } catch (error) {
      if (stderrBuffer.trim() && error instanceof Error && /ACP connection closed/iu.test(error.message)) {
        throw new Error(`${error.message}: ${stderrBuffer.trim()}`);
      }
      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  };

  try {
    const initializeResult = await withSdkRequest("initialize", agent.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: SDK_PROBE_CLIENT_CAPABILITIES,
      clientInfo: { name: "tiller", version: "0.1.0" },
    }));
    const sessionCapabilities = resolveSessionCapabilities(initializeResult, provider);
    if (!sessionCapabilities.sessionList) {
      throw new Error("ACP agent does not advertise session/list capability.");
    }
    const result = await withSdkRequest(
      "session/list",
      agent.listSessions({
        cwd: launchCwd,
        ...(cursor ? { cursor } : {}),
      }),
      15_000,
    );
    return normalizeAcpAgentSessionListResult(result);
  } finally {
    terminateChildProcess(child.pid);
  }
}
