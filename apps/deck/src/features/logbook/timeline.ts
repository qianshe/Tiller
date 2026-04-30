import type { AgentMessage, AgentToolCall, CommandChunk } from "@tiller/shared";

export type ConversationTimelineItem =
  | { kind: "message"; timestamp: string; message: AgentMessage }
  | ConversationToolCallItem;

export type ConversationToolCallItem = {
  kind: "tool";
  id: string;
  commandId: string;
  timestamp: string;
  title: string;
  status: AgentToolCall["status"];
  toolKind: AgentToolCall["kind"];
  text: string;
  streams: Array<CommandChunk["stream"]>;
};

export function buildConversationTimeline(messages: AgentMessage[], commandChunks: CommandChunk[], toolCalls: AgentToolCall[]): ConversationTimelineItem[] {
  const messageItems: ConversationTimelineItem[] = coalesceDisplayMessages(messages).map((message) => ({
    kind: "message",
    timestamp: message.timestamp,
    message,
  }));
  const sourceToolCalls = toolCalls.length ? toolCalls : commandChunks.map(commandChunkToToolCall);
  const toolItems = groupToolCalls(sourceToolCalls);
  return [...messageItems, ...toolItems].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

export function groupToolCalls(calls: AgentToolCall[]): ConversationToolCallItem[] {
  const groups = new Map<string, ConversationToolCallItem>();
  for (const call of calls) {
    const key = call.commandId ?? call.id;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        kind: "tool",
        id: call.id,
        commandId: key,
        title: resolveDisplayToolTitle(call, key),
        status: call.status,
        toolKind: call.kind,
        timestamp: call.timestamp,
        text: call.output ?? "",
        streams: call.stream ? [call.stream] : [],
      });
      continue;
    }

    current.text = `${current.text}${call.output ?? ""}`;
    if (Date.parse(call.timestamp) < Date.parse(current.timestamp)) {
      current.timestamp = call.timestamp;
    }
    current.status = call.status;
    current.toolKind = call.kind === "unknown" ? current.toolKind : call.kind;
    current.title = resolveMergedToolTitle(current.title, resolveDisplayToolTitle(call, key), call.id);
    if (call.stream && !current.streams.includes(call.stream)) {
      current.streams.push(call.stream);
    }
  }
  return Array.from(groups.values());
}


function resolveDisplayToolTitle(call: AgentToolCall, fallback: string) {
  if (call.kind === "terminal") {
    return summarizeCommand(call.input ?? call.title ?? fallback);
  }
  return isInformativeToolTitle(call.title, call.id) ? call.title : fallback;
}

function resolveMergedToolTitle(currentTitle: string, incomingTitle: string, id: string) {
  return isInformativeToolTitle(incomingTitle, id) ? incomingTitle : currentTitle || incomingTitle || id;
}

function isInformativeToolTitle(title: string | undefined, id: string) {
  const normalized = title?.trim();
  return Boolean(normalized && normalized !== id && !/^call_[A-Za-z0-9]+$/u.test(normalized));
}

function summarizeCommand(input: string) {
  const command = extractCommandFromInput(input).replace(/\s+/g, " ").trim();
  if (!command) {
    return "Shell command";
  }
  const skillName = extractSkillNameFromCommand(command);
  if (skillName) {
    return `Skill: ${skillName}`;
  }
  return command.length > 72 ? `${command.slice(0, 72)}…` : command;
}

function extractSkillNameFromCommand(command: string) {
  const normalized = command.replace(/\\/gu, "/");
  const pluginSkill = normalized.match(/\/plugins\/cache\/[^/]+\/([^/]+)\/[^/]+\/skills\/([^/]+)\/skill\.md/iu);
  if (pluginSkill?.[1] && pluginSkill[2]) {
    return `${pluginSkill[1]}:${pluginSkill[2]}`;
  }
  const systemSkill = normalized.match(/\/skills\/\.system\/([^/]+)\/skill\.md/iu);
  if (systemSkill?.[1]) {
    return systemSkill[1];
  }
  const localSkill = normalized.match(/\/skills\/([^/]+)\/skill\.md/iu);
  if (localSkill?.[1]) {
    return localSkill[1];
  }
  return undefined;
}

function extractCommandFromInput(input: string) {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    const parsedCommand = Array.isArray(parsed.parsed_cmd) ? parsed.parsed_cmd[0] : undefined;
    const command = parsed.command ?? parsed.cmd ?? parsed.script ?? parsed.shell ?? parsed.args ?? (isRecord(parsedCommand) ? parsedCommand.cmd : undefined);
    if (Array.isArray(command)) {
      return command.map((item) => String(item)).join(" ");
    }
    if (typeof command === "string" || typeof command === "number" || typeof command === "boolean") {
      return String(command);
    }
  } catch {
    // Plain shell commands are already displayable.
  }
  return input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function commandChunkToToolCall(chunk: CommandChunk): AgentToolCall {
  return {
    id: `tool-${chunk.commandId}`,
    kind: "terminal",
    title: chunk.commandId,
    status: chunk.stream === "stderr" ? "failed" : "running",
    commandId: chunk.commandId,
    output: chunk.text,
    stream: chunk.stream,
    timestamp: chunk.timestamp,
    updatedAt: chunk.timestamp,
  };
}

export function mergeToolCallHistory(current: AgentToolCall[], incoming: AgentToolCall[]) {
  const merged = [...current];
  for (const next of incoming) {
    const index = merged.findIndex((item) => item.id === next.id);
    if (index === -1) {
      merged.push(next);
      continue;
    }

    const existing = merged[index];
    merged[index] = {
      ...existing,
      ...next,
      title: resolveMergedToolTitle(existing.title, next.title, next.id),
      output: `${existing.output ?? ""}${next.output ?? ""}`,
      input: next.input ?? existing.input,
      timestamp: Date.parse(next.timestamp) < Date.parse(existing.timestamp) ? next.timestamp : existing.timestamp,
      updatedAt: next.updatedAt,
      status: next.status,
    };
  }
  return merged.sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
}

export function coalesceDisplayMessages(items: AgentMessage[]) {
  return items.reduce<AgentMessage[]>((merged, item) => mergeAgentMessages(merged, item), []);
}

export function mergeAgentMessages(items: AgentMessage[], incoming: AgentMessage) {
  const last = items.at(-1);
  if (!last) {
    return [incoming];
  }

  if (last.role === incoming.role && last.role !== "system") {
    return [
      ...items.slice(0, -1),
      {
        ...last,
        text: `${last.text}${incoming.text}`,
        timestamp: incoming.timestamp,
      },
    ];
  }

  if (last.role === "system" && incoming.role === "system" && last.text === incoming.text) {
    return items;
  }

  return [...items, incoming];
}
