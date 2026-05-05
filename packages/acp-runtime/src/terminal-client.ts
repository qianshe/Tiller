import { spawn } from "node:child_process";
import * as acp from "@agentclientprotocol/sdk";
import { isAbsolute, relative, resolve } from "node:path";
import type { SessionRuntimeEvent } from "./runtime-types";

export type ManagedSdkTerminal = {
  id: string;
  process: ReturnType<typeof spawn>;
  output: string;
  truncated: boolean;
  outputByteLimit: number;
  exitStatus?: { exitCode: number | null; signal: string | null };
  exitPromise: Promise<{ exitCode: number | null; signal: string | null }>;
};

export function resolveContainedWorkspacePath(workspaceRoot: string, requestPath: string) {
  const root = resolve(workspaceRoot);
  const candidate = resolve(root, requestPath);
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`ACP client file path escapes workspace: ${requestPath}`);
  }
  return candidate;
}

export function sliceTextFileContent(content: string, line?: number | null, limit?: number | null) {
  if (!line && !limit) {
    return content;
  }
  const lines = content.split(/\r?\n/u);
  const start = Math.max((line ?? 1) - 1, 0);
  const end = limit && limit > 0 ? start + limit : undefined;
  return lines.slice(start, end).join("\n");
}

export function formatTerminalCommand(command: string, args: string[]) {
  return [command, ...args].map((value) => (/\s/u.test(value) ? JSON.stringify(value) : value)).join(" ");
}

export function mergeTerminalEnv(baseEnv: NodeJS.ProcessEnv, env: acp.EnvVariable[]) {
  const merged: NodeJS.ProcessEnv = { ...baseEnv };
  for (const item of env) {
    merged[item.name] = item.value;
  }
  return merged;
}

export function requireTerminal(terminals: Map<string, ManagedSdkTerminal>, terminalId: string) {
  const terminal = terminals.get(terminalId);
  if (!terminal) {
    throw new Error(`Unknown ACP terminal: ${terminalId}`);
  }
  return terminal;
}

export function emitTerminalChunk(
  terminal: ManagedSdkTerminal,
  stream: "stdout" | "stderr",
  text: string,
  onEvent: (event: SessionRuntimeEvent) => void,
) {
  if (!text) {
    return;
  }
  const retained = retainTerminalOutput(`${terminal.output}${text}`, terminal.outputByteLimit);
  terminal.output = retained.output;
  terminal.truncated = terminal.truncated || retained.truncated;
  onEvent({
    type: "command-output",
    chunk: {
      id: `${terminal.id}-${Date.now()}-${stream}`,
      commandId: terminal.id,
      text,
      stream,
      timestamp: new Date().toISOString(),
    },
  });
}

export function formatAcpError(error: { message?: string; data?: unknown }) {
  const detail =
    typeof error?.data === "string"
      ? error.data
      : typeof (error?.data as { details?: unknown } | undefined)?.details === "string"
        ? (error.data as { details: string }).details
        : null;

  return detail ? `${error?.message ?? "ACP request failed"}: ${detail}` : error?.message ?? "ACP request failed";
}

function retainTerminalOutput(output: string, limit: number) {
  if (limit <= 0 || Buffer.byteLength(output, "utf8") <= limit) {
    return { output, truncated: false };
  }

  let retained = output;
  while (retained.length > 0 && Buffer.byteLength(retained, "utf8") > limit) {
    retained = retained.slice(1);
  }
  return { output: retained, truncated: true };
}
