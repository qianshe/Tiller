import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AcpAgentProvider, AgentMessage, AgentToolCall } from "@tiller/shared";
import type { AcpAuthoritativeHistory } from "../types";

const execFileAsync = promisify(execFile);
const OPENCODE_EXPORT_TIMEOUT_MS = 20_000;
const OPENCODE_EXPORT_MAX_BUFFER = 16 * 1024 * 1024;

export async function loadOpenCodeExportHistory(
  agent: AcpAgentProvider,
  runtimeSessionId: string,
  cwd: string,
): Promise<AcpAuthoritativeHistory | null> {
  if (!isOpenCodeCommand(agent.command)) {
    return null;
  }

  const stdout = await runOpenCodeExport(agent, runtimeSessionId, cwd);
  return parseOpenCodeExportHistory(stdout);
}

async function runOpenCodeExport(agent: AcpAgentProvider, runtimeSessionId: string, cwd: string) {
  const options = {
    cwd,
    env: { ...process.env, ...agent.env },
    timeout: agent.initializeTimeoutMs ?? OPENCODE_EXPORT_TIMEOUT_MS,
    maxBuffer: OPENCODE_EXPORT_MAX_BUFFER,
    windowsHide: true,
  };
  try {
    const { stdout } = await execFileAsync(agent.command, ["export", runtimeSessionId], options);
    return stdout;
  } catch (error) {
    if (process.platform !== "win32" || !isNoEntryError(error)) {
      throw error;
    }
    const command = `& ${quotePowerShellArg(agent.command)} ${quotePowerShellArg("export")} ${quotePowerShellArg(runtimeSessionId)}`;
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      options,
    );
    return stdout;
  }
}

function isNoEntryError(error: unknown) {
  return Boolean(
    error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT",
  );
}

function quotePowerShellArg(value: string) {
  return `'${value.replace(/'/gu, "''")}'`;
}

export function parseOpenCodeExportHistory(raw: string): AcpAuthoritativeHistory {
  const parsed = JSON.parse(raw);
  const messages: AgentMessage[] = [];
  const toolCalls: AgentToolCall[] = [];

  for (const message of Array.isArray(parsed?.messages) ? parsed.messages : []) {
    const messageId = stringFrom(message?.id ?? message?.info?.id);
    const role = normalizeMessageRole(message?.info?.role ?? message?.role);
    const timestamp = timestampFromMillis(message?.info?.time?.created ?? message?.time?.created);
    const text = collectTextParts(message?.parts);
    if (messageId && role && timestamp && text) {
      messages.push({ id: messageId, role, text, timestamp });
    }

    for (const toolCall of collectToolCalls(message)) {
      toolCalls.push(toolCall);
    }
  }

  return {
    messages: sortByTimestamp(messages),
    toolCalls: sortByTimestamp(toolCalls),
  };
}

function collectToolCalls(message: any): AgentToolCall[] {
  const calls: AgentToolCall[] = [];
  for (const part of Array.isArray(message?.parts) ? message.parts : []) {
    if (part?.type !== "tool") {
      continue;
    }
    const id = stringFrom(part.callID ?? part.callId ?? part.id);
    const state = part.state ?? {};
    const start = timestampFromMillis(
      state?.time?.start ?? part?.time?.start ?? state?.time?.created ?? part?.time?.created,
    );
    const end =
      timestampFromMillis(
        state?.time?.end ?? part?.time?.end ?? state?.time?.updated ?? part?.time?.updated,
      ) ?? start;
    if (!id || !start || !end) {
      continue;
    }
    const toolName = stringFrom(part.tool) ?? "tool";
    const title = stringFrom(state.title) || toolName || id;
    const input = stringifyToolPayload(state.input);
    const output = stringFrom(state.output);
    calls.push({
      id,
      commandId: id,
      kind: inferOpenCodeToolKind(toolName, title),
      title,
      status: normalizeToolStatus(state.status),
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
      timestamp: start,
      updatedAt: end,
    });
  }
  return calls;
}

function collectTextParts(parts: unknown) {
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function normalizeMessageRole(role: unknown): AgentMessage["role"] | null {
  return role === "user" || role === "assistant" || role === "system" ? role : null;
}

function normalizeToolStatus(status: unknown): AgentToolCall["status"] {
  const raw = String(status ?? "completed").toLowerCase();
  if (raw === "error" || raw === "failed") {
    return "failed";
  }
  if (raw === "cancelled" || raw === "canceled") {
    return "cancelled";
  }
  if (raw === "pending") {
    return "pending";
  }
  if (raw === "running") {
    return "running";
  }
  return "completed";
}

function inferOpenCodeToolKind(toolName: string, title: string): AgentToolCall["kind"] {
  const raw = `${toolName} ${title}`.toLowerCase();
  if (/bash|shell|terminal|execute/u.test(raw)) {
    return "terminal";
  }
  if (/edit|patch|write|file/u.test(raw)) {
    return "edit";
  }
  if (/task|agent|subagent|background/u.test(raw)) {
    return "subagent";
  }
  if (/tool|mcp/u.test(raw)) {
    return "tool";
  }
  return "unknown";
}

function stringifyToolPayload(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function timestampFromMillis(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : undefined;
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function sortByTimestamp<T extends { timestamp: string; id: string }>(items: T[]) {
  return [...items].sort((left, right) => {
    const delta = Date.parse(left.timestamp) - Date.parse(right.timestamp);
    return delta === 0 ? left.id.localeCompare(right.id) : delta;
  });
}

function isOpenCodeCommand(command: string) {
  return /^opencode(?:\.exe)?$/iu.test(command);
}
