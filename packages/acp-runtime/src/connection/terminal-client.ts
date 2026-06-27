import { spawn } from "node:child_process";
import { terminateChildProcess } from "../process";
import type { SessionRuntimeEvent } from "../runtime-types";
import {
  emitTerminalChunk,
  formatTerminalCommand,
  mergeTerminalEnv,
  requireTerminal,
  resolveContainedWorktreePath,
  type ManagedSdkTerminal,
} from "../terminal-client";

type ConnectionTerminalSession = {
  worktree: { path: string };
  onEvent: (event: SessionRuntimeEvent) => void;
};

type ConnectionTerminalClientOptions = {
  resolveSession: (runtimeSessionId: string) => ConnectionTerminalSession;
  requestPermission: (sessionId: string, command: string, reason: string) => Promise<boolean>;
};

export class ConnectionTerminalClient {
  private terminalCounter = 0;
  private readonly terminals = new Map<string, ManagedSdkTerminal>();

  constructor(private readonly options: ConnectionTerminalClientOptions) {}

  async create(params: any): Promise<{ terminalId: string }> {
    const session = this.options.resolveSession(params.sessionId);
    const sessionCwd = session.worktree.path;
    const cwd = params.cwd ? resolveContainedWorktreePath(sessionCwd, params.cwd) : sessionCwd;
    const commandLine = formatTerminalCommand(params.command, params.args ?? []);
    const allowed = await this.options.requestPermission(
      params.sessionId,
      commandLine,
      "ACP agent requested terminal execution.",
    );
    if (!allowed) {
      throw new Error(`Denied ACP terminal command: ${commandLine}`);
    }

    this.terminalCounter += 1;
    const terminalId = `sdk-terminal-${this.terminalCounter}`;
    const terminalProcess = spawn(params.command, params.args ?? [], {
      cwd,
      env: mergeTerminalEnv(process.env, params.env ?? []),
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

    terminal.exitPromise = new Promise((resolveExit) => {
      terminalProcess.once("exit", (code, signal) => {
        terminal.exitStatus = { exitCode: code, signal };
        const now = new Date().toISOString();
        session.onEvent({
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
        resolveExit(terminal.exitStatus);
      });
    });

    this.terminals.set(terminalId, terminal);
    const startedAt = new Date().toISOString();
    session.onEvent({
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
    terminalProcess.stdout.on("data", (chunk) => emitTerminalChunk(terminal, "stdout", String(chunk), session.onEvent));
    terminalProcess.stderr.on("data", (chunk) => emitTerminalChunk(terminal, "stderr", String(chunk), session.onEvent));
    terminalProcess.once("error", (error) => emitTerminalChunk(terminal, "stderr", error.message, session.onEvent));
    return { terminalId };
  }

  async output(params: any) {
    const terminal = requireTerminal(this.terminals, params.terminalId);
    return { output: terminal.output, truncated: terminal.truncated, exitStatus: terminal.exitStatus };
  }

  async waitForExit(params: any) {
    return await requireTerminal(this.terminals, params.terminalId).exitPromise;
  }

  async kill(params: any) {
    terminateChildProcess(requireTerminal(this.terminals, params.terminalId).process.pid);
    return {};
  }

  async release(params: any) {
    const terminal = requireTerminal(this.terminals, params.terminalId);
    if (!terminal.exitStatus) {
      terminateChildProcess(terminal.process.pid);
    }
    this.terminals.delete(params.terminalId);
    return {};
  }
}
