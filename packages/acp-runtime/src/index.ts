import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  AcpAgentProvider,
  AgentMessage,
  CommandChunk,
  FileDiffSummary,
  PermissionDecision,
  PermissionRequest,
  SessionStatus,
  WorkspaceSummary,
} from "@tiller/shared";

const ACP_INITIALIZE_TIMEOUT_MS = 10_000;
const ACP_EARLY_STDERR_FAILURE = /failed to start server|eaddrinuse|address already in use/i;

export type SessionRuntimeEvent =
  | {
      type: "status";
      status: SessionStatus;
      message?: string;
    }
  | {
      type: "message";
      message: AgentMessage;
    }
  | {
      type: "permission-request";
      request: PermissionRequest;
    }
  | {
      type: "command-output";
      chunk: CommandChunk;
    }
  | {
      type: "diff-update";
      files: FileDiffSummary[];
    }
  | {
      type: "error";
      message: string;
      code?: string;
    };

export type MockAgentRuntimeOptions = {
  sessionId: string;
  workspace: WorkspaceSummary;
  agent: AcpAgentProvider;
  onEvent: (event: SessionRuntimeEvent) => void;
};

export async function testAcpConnection(provider: AcpAgentProvider, cwd = process.cwd()) {
  const launchSpec = resolveLaunchSpec(provider.command, provider.args ?? []);
  const launchCwd = existsSync(provider.cwd ?? "") ? provider.cwd! : existsSync(cwd) ? cwd : process.cwd();
  const childEnv = { ...process.env, ...provider.env };
  delete childEnv.NODE_OPTIONS;
  delete childEnv.TSX_TSCONFIG_PATH;
  delete childEnv.TSX_DISABLE_CACHE;
  const initializeTimeoutMs = provider.initializeTimeoutMs ?? ACP_INITIALIZE_TIMEOUT_MS;

  return new Promise<{ ok: boolean; message: string }>((resolve) => {
    const child = spawn(launchSpec.command, launchSpec.args, {
      cwd: launchCwd,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const finalize = (result: { ok: boolean; message: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.kill();
      resolve(result);
    };

    const tryParseInitialize = (text: string) => {
      if (!text.trim()) {
        return false;
      }

      try {
        const payload = JSON.parse(text);
        if (payload.id === "tiller-init" && payload.result) {
          const agentName = payload.result.agentInfo?.name ?? provider.name;
          const version = payload.result.agentInfo?.version ? ` v${payload.result.agentInfo.version}` : "";
          finalize({ ok: true, message: `ACP initialize passed for ${agentName}${version}.` });
          return true;
        }
      } catch {
        return false;
      }

      return false;
    };

    child.on("error", (error) => {
      finalize({ ok: false, message: `Failed to start ACP command: ${error.message}` });
    });

    child.stderr.on("data", (chunk) => {
      stderrBuffer += String(chunk);
      if (ACP_EARLY_STDERR_FAILURE.test(stderrBuffer)) {
        finalize({ ok: false, message: stderrBuffer.trim() });
      }
    });

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (tryParseInitialize(line)) {
          return;
        }
      }

      tryParseInitialize(stdoutBuffer);
    });

    child.on("exit", (code) => {
      if (!settled) {
        if (tryParseInitialize(stdoutBuffer)) {
          return;
        }
        finalize({
          ok: false,
          message: stderrBuffer.trim() || `ACP command exited before initialize completed (code ${code ?? "unknown"}).`,
        });
      }
    });

    const timeout = setTimeout(() => {
      if (tryParseInitialize(stdoutBuffer)) {
        return;
      }
      finalize({
        ok: false,
        message: stderrBuffer.trim() || "Timed out waiting for ACP initialize response.",
      });
    }, initializeTimeoutMs);

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "tiller-init",
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {
            fs: {
              readTextFile: false,
              writeTextFile: false,
            },
            terminal: false,
          },
          clientInfo: {
            name: "tiller-daemon",
            version: "0.1.0",
          },
        },
      })}\n`,
    );
  });
}

export function createMockAgentRuntime(options: MockAgentRuntimeOptions) {
  let pendingPermissionId: string | null = null;
  let activeTimers: Array<ReturnType<typeof setTimeout>> = [];

  function clearTimers() {
    activeTimers.forEach(clearTimeout);
    activeTimers = [];
  }

  function schedule(delay: number, action: () => void) {
    const timer = setTimeout(action, delay);
    activeTimers.push(timer);
  }

  function prompt(text: string) {
    clearTimers();
    pendingPermissionId = null;

    options.onEvent({ type: "status", status: "running", message: "Mock agent is planning the task" });
    emitMessage(`I received your prompt: “${text}”.`);
    schedule(350, () => emitMessage("I am drafting a small execution plan and keeping the runtime agent-agnostic."));
    schedule(800, () => emitMessage("Next I want to run a safe command to inspect the workspace before editing."));
    schedule(1200, () => {
      pendingPermissionId = `${options.sessionId}-perm-${Date.now()}`;
      options.onEvent({ type: "status", status: "waiting_for_permission", message: "Waiting for remote approval" });
      options.onEvent({
        type: "permission-request",
        request: {
          id: pendingPermissionId,
          command: "pnpm test -- --runInBand",
          reason: "Validate the workspace before continuing the coding task.",
          workspacePath: options.workspace.path,
        },
      });
    });
  }

  function respondPermission(requestId: string, decision: PermissionDecision) {
    if (pendingPermissionId !== requestId) {
      options.onEvent({
        type: "error",
        code: "PERMISSION_NOT_PENDING",
        message: "Permission request is no longer active.",
      });
      return;
    }

    pendingPermissionId = null;
    clearTimers();

    if (decision === "deny") {
      emitMessage("Permission denied. I will stop before executing commands and wait for new instructions.");
      options.onEvent({ type: "status", status: "idle", message: "Stopped after permission denial" });
      return;
    }

    options.onEvent({ type: "status", status: "running", message: "Permission granted, continuing mock workflow" });
    emitMessage("Permission granted. Continuing with the mock execution path.");

    const commandId = `${options.sessionId}-cmd-${Date.now()}`;

    schedule(200, () =>
      options.onEvent({
        type: "command-output",
        chunk: {
          id: `${commandId}-1`,
          commandId,
          text: "$ pnpm test -- --runInBand\nPASS src/mock-agent-flow.test.ts\n",
          stream: "stdout",
          timestamp: timestamp(),
        },
      }),
    );

    schedule(500, () =>
      options.onEvent({
        type: "diff-update",
        files: [
          { path: "apps/daemon/src/index.ts", status: "modified", additions: 18, deletions: 2 },
          { path: "packages/acp-runtime/src/index.ts", status: "modified", additions: 24, deletions: 0 },
          { path: "apps/web/src/App.tsx", status: "modified", additions: 34, deletions: 8 },
        ],
      }),
    );

    schedule(860, () => emitMessage("I updated the local control-plane surfaces and left TODO hooks for real ACP session transport."));
    schedule(1200, () => {
      emitMessage("Mock flow complete. The session is now idle and ready for the next prompt.");
      options.onEvent({ type: "status", status: "idle", message: "Mock flow complete" });
    });
  }

  function cancel() {
    clearTimers();
    pendingPermissionId = null;
    emitMessage("Session cancelled by the operator.");
    options.onEvent({ type: "status", status: "cancelled", message: "Cancelled by remote operator" });
  }

  function emitMessage(text: string) {
    options.onEvent({
      type: "message",
      message: {
        id: `${options.sessionId}-msg-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        role: "assistant",
        text,
        timestamp: timestamp(),
      },
    });
  }

  return {
    prompt,
    respondPermission,
    cancel,
  };
}

function resolveLaunchSpec(command: string, args: string[]) {
  if (process.platform !== "win32") {
    return { command, args };
  }

  const resolvedCommand = resolveWindowsCommand(command);
  if (!resolvedCommand.toLowerCase().endsWith(".cmd")) {
    return { command: resolvedCommand, args };
  }

  const cmdContent = readFileSync(resolvedCommand, "utf8");
  const scriptMatch = cmdContent.match(/"%_prog%"\s+"([^"]+)"\s+%\*/u);
  if (!scriptMatch) {
    return { command: resolvedCommand, args };
  }

  const scriptPath = scriptMatch[1].replace(/%dp0%?/giu, dirname(resolvedCommand).replace(/\\/g, "/"));
  const localNode = join(dirname(resolvedCommand), "node.exe");
  return {
    command: existsSync(localNode) ? localNode : process.execPath,
    args: [scriptPath, ...args],
  };
}

function resolveWindowsCommand(command: string) {
  try {
    const output = execFileSync("where.exe", [command], { encoding: "utf8" });
    const resolved = output.split(/\r?\n/u).find(Boolean)?.trim() ?? command;
    if (!resolved.includes(".") && existsSync(`${resolved}.cmd`)) {
      return `${resolved}.cmd`;
    }
    return resolved;
  } catch {
    return command;
  }
}

function timestamp() {
  return new Date().toISOString();
}

// TODO(real-acp): introduce createAcpRuntime(provider, workspace) using stdio JSON-RPC notifications beyond initialize.
// TODO(real-acp): normalize ACP raw notifications into SessionRuntimeEvent here instead of leaking protocol details upward.
