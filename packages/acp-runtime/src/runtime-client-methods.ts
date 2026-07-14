import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import { mapSessionUpdateNotificationBatch } from "./events";
import { terminateChildProcess } from "./process";
import { writeProtocolLog, type ProtocolLogSink } from "./protocol-logging";
import { mapSdkPermissionRequest } from "./sdk-helpers";
import {
  emitTerminalChunk,
  formatTerminalCommand,
  mergeTerminalEnv,
  requireTerminal,
  resolveContainedWorktreePath,
  sliceTextFileContent,
  type ManagedSdkTerminal,
} from "./terminal-client";
import type { AcpRuntimeOptions, AcpSessionConfigOption } from "./runtime-types";
import type { PermissionDecision } from "@tiller/shared";

export type AcpRuntimePendingPermissionReply =
  | {
      kind: "agent";
      optionIds: Partial<Record<PermissionDecision, string>>;
      allowOptionId?: string;
      denyOptionId?: string;
      resolve: (response: acp.RequestPermissionResponse) => void;
    }
  | {
      kind: "client";
      resolve: (allowed: boolean) => void;
    };

type RuntimeClientMethodsOptions = {
  options: AcpRuntimeOptions;
  launchCwd: string;
  childEnv: NodeJS.ProcessEnv;
  protocolLog: ProtocolLogSink;
  terminals: Map<string, ManagedSdkTerminal>;
  pendingPermissionReplies: Map<string, AcpRuntimePendingPermissionReply>;
  getSessionToken: () => string;
  setCurrentConfigOptions: (options: AcpSessionConfigOption[]) => void;
  nextPermissionRequestId: (prefix: string) => string;
  nextTerminalId: () => string;
};

export function createRuntimeClientMethods({
  options,
  launchCwd,
  childEnv,
  protocolLog,
  terminals,
  pendingPermissionReplies,
  getSessionToken,
  setCurrentConfigOptions,
  nextPermissionRequestId,
  nextTerminalId,
}: RuntimeClientMethodsOptions) {
  const ensureActiveSessionRequest = (requestSessionId: string) => {
    const sessionToken = getSessionToken();
    if (sessionToken && requestSessionId !== sessionToken) {
      throw new Error(`ACP client request targeted unknown session ${requestSessionId}.`);
    }
  };

  const requestClientPermission = async (command: string, reason: string) => {
    const id = nextPermissionRequestId("sdk-client-permission");
    options.onEvent({
      type: "status",
      status: "waiting_for_permission",
      message: reason,
    });
    options.onEvent({
      type: "permission-request",
      request: {
        id,
        command,
        reason,
        cwd: options.worktree.path,
      },
    });
    return await new Promise<boolean>((resolve) => {
      pendingPermissionReplies.set(id, { kind: "client", resolve });
    });
  };

  const resolveWorktreePath = (requestPath: string) => resolveContainedWorktreePath(options.worktree.path, requestPath);

  return {
    async sessionUpdate(params: any) {
      const sessionToken = getSessionToken();
      const mapped = mapSessionUpdateNotificationBatch(
        { method: "session/update", params },
        { provider: options.agent, providerId: options.agent.id },
      );
      if (!mapped || (sessionToken && mapped.sessionId !== sessionToken)) {
        return;
      }
      writeProtocolLog(protocolLog, "stdout", { method: "session/update", params });
      for (const event of mapped.events) {
        if (event.type === "config-options") {
          setCurrentConfigOptions(event.options);
        }
        options.onEvent(event);
      }
    },
    async requestPermission(params: any) {
      const mapped = mapSdkPermissionRequest(params, nextPermissionRequestId("sdk-permission"), launchCwd);
      options.onEvent({
        type: "status",
        status: "waiting_for_permission",
        message: "ACP agent requested permission",
      });
      options.onEvent({
        type: "permission-request",
        request: mapped.request,
      });
      return await new Promise<acp.RequestPermissionResponse>((resolve) => {
        pendingPermissionReplies.set(mapped.id, {
          kind: "agent",
          optionIds: mapped.optionIds,
          allowOptionId: mapped.allowOptionId,
          denyOptionId: mapped.denyOptionId,
          resolve,
        });
      });
    },
    async readTextFile(params: any) {
      ensureActiveSessionRequest(params.sessionId);
      const filePath = resolveWorktreePath(params.path);
      const content = await readFile(filePath, "utf8");
      return { content: sliceTextFileContent(content, params.line, params.limit) };
    },
    async writeTextFile(params: any) {
      ensureActiveSessionRequest(params.sessionId);
      const filePath = resolveWorktreePath(params.path);
      const relativePath = relative(options.worktree.path, filePath) || params.path;
      const allowed = await requestClientPermission(
        `Write file: ${relativePath}`,
        "ACP agent requested worktree file write access.",
      );
      if (!allowed) {
        throw new Error(`Denied ACP file write: ${relativePath}`);
      }
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, params.content, "utf8");
      const now = new Date().toISOString();
      options.onEvent({
        type: "tool-call",
        toolCall: {
          id: `fs-write-${Date.now()}`,
          kind: "write",
          title: `Write file: ${relativePath}`,
          status: "completed",
          input: params.path,
          output: `${params.content.length} chars written`,
          timestamp: now,
          updatedAt: now,
        },
      });
      return {};
    },
    async createTerminal(params: any) {
      ensureActiveSessionRequest(params.sessionId);
      const cwd = params.cwd ? resolveWorktreePath(params.cwd) : launchCwd;
      const commandLine = formatTerminalCommand(params.command, params.args ?? []);
      const allowed = await requestClientPermission(
        commandLine,
        "ACP agent requested terminal execution.",
      );
      if (!allowed) {
        throw new Error(`Denied ACP terminal command: ${commandLine}`);
      }

      const terminalId = nextTerminalId();
      const terminalProcess = spawn(params.command, params.args ?? [], {
        cwd,
        env: mergeTerminalEnv(childEnv, params.env ?? []),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const terminal: ManagedSdkTerminal = {
        id: terminalId,
        process: terminalProcess,
        output: "",
        truncated: false,
        outputByteLimit: params.outputByteLimit ?? 64 * 1024,
        exitPromise: Promise.resolve({ exitCode: null, signal: null }),
      };
      terminal.exitPromise = new Promise((resolve) => {
        terminalProcess.once("exit", (code, signal) => {
          terminal.exitStatus = { exitCode: code, signal };
          const now = new Date().toISOString();
          options.onEvent({
            type: "tool-call",
            toolCall: {
              id: `tool-${terminalId}`,
              kind: "shell",
              title: commandLine,
              status: code === 0 ? "completed" : "failed",
              commandId: terminalId,
              output: terminal.output,
              timestamp: now,
              updatedAt: now,
            },
          });
          resolve(terminal.exitStatus);
        });
      });
      terminals.set(terminalId, terminal);

      const startedAt = new Date().toISOString();
      options.onEvent({
        type: "tool-call",
        toolCall: {
          id: `tool-${terminalId}`,
          kind: "shell",
          title: commandLine,
          status: "running",
          commandId: terminalId,
          input: commandLine,
          timestamp: startedAt,
          updatedAt: startedAt,
        },
      });
      terminalProcess.stdout.on("data", (chunk) => emitTerminalChunk(terminal, "stdout", String(chunk), options.onEvent));
      terminalProcess.stderr.on("data", (chunk) => emitTerminalChunk(terminal, "stderr", String(chunk), options.onEvent));
      terminalProcess.once("error", (error) => emitTerminalChunk(terminal, "stderr", error.message, options.onEvent));
      return { terminalId };
    },
    async terminalOutput(params: any) {
      ensureActiveSessionRequest(params.sessionId);
      const terminal = requireTerminal(terminals, params.terminalId);
      return {
        output: terminal.output,
        truncated: terminal.truncated,
        exitStatus: terminal.exitStatus,
      };
    },
    async waitForTerminalExit(params: any) {
      ensureActiveSessionRequest(params.sessionId);
      const terminal = requireTerminal(terminals, params.terminalId);
      return await terminal.exitPromise;
    },
    async killTerminal(params: any) {
      ensureActiveSessionRequest(params.sessionId);
      const terminal = requireTerminal(terminals, params.terminalId);
      terminateChildProcess(terminal.process.pid);
      return {};
    },
    async releaseTerminal(params: any) {
      ensureActiveSessionRequest(params.sessionId);
      const terminal = requireTerminal(terminals, params.terminalId);
      if (!terminal.exitStatus) {
        terminateChildProcess(terminal.process.pid);
      }
      terminals.delete(params.terminalId);
      return {};
    },
  };
}
