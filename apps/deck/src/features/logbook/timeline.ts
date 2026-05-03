import type { AgentMessage, AgentToolCall, CommandChunk } from "@tiller/shared";

export function sortAgentMessagesByTimeline(items: AgentMessage[]) {
  return items
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const timestampDelta = Date.parse(left.message.timestamp) - Date.parse(right.message.timestamp);
      return timestampDelta === 0 ? left.index - right.index : timestampDelta;
    })
    .map((entry) => entry.message);
}

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
  const sourceToolCalls = toolCalls.length ? toolCalls : commandChunks.map(commandChunkToToolCall);
  const toolItems = groupToolCalls(sourceToolCalls);
  const messageItems: ConversationTimelineItem[] = coalesceDisplayMessages(
    messages,
    toolItems.map((item) => item.timestamp),
  ).map((message) => ({
    kind: "message",
    timestamp: message.timestamp,
    message,
  }));
  return [...messageItems, ...toolItems].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

export function resolvePendingToolActivity(calls: AgentToolCall[]) {
  const pending = calls
    .filter((call) => call.status === "pending" || call.status === "running" || call.status === "waiting_for_permission")
    .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))
    .at(-1);
  if (!pending) {
    return null;
  }

  return {
    title: resolveDisplayToolTitle(pending, pending.commandId ?? pending.id),
    status: pending.status,
  };
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
  // Some agents (notably Codex) report a SKILL.md read as kind:"tool" with the
  // `Get-Content -Raw 'C:\...\skills\<name>\SKILL.md'` shell command stuffed
  // into either the title or a JSON-encoded `input`. Try to recognise the skill
  // name from those fields regardless of the reported tool kind first, so the
  // timeline does not show a truncated raw command.
  const skillNameFromCommand = extractSkillNameFromCommandSources(call);
  if (skillNameFromCommand) {
    return `Skill: ${skillNameFromCommand}`;
  }
  if (call.kind !== "terminal") {
    const openCodeSkillName = extractOpenCodeSkillNameFromToolOutput(call.output);
    if (openCodeSkillName) {
      return `Skill: ${openCodeSkillName}`;
    }
  }
  if (call.kind === "terminal") {
    return summarizeCommand(call.input ?? call.title ?? fallback);
  }
  return isInformativeToolTitle(call.title, call.id) ? call.title : fallback;
}

function extractSkillNameFromCommandSources(call: AgentToolCall) {
  // Claude Code (and any ACP bridge that mirrors the Anthropic tool_use shape)
  // invokes a built-in `Skill` tool whose input is `{skill: "<name>"}`. The tool
  // name itself does not carry a path and there is no shell command to scan, so
  // we have to read the structured input directly.
  const skillNameFromInput = extractSkillNameFromStructuredInput(call.input);
  if (skillNameFromInput) {
    return skillNameFromInput;
  }
  const inputCommand = call.input ? extractCommandFromInput(call.input) : undefined;
  const candidates = [inputCommand, call.title].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const skillName = extractSkillNameFromCommand(candidate);
    if (skillName) {
      return skillName;
    }
  }
  return undefined;
}

function extractSkillNameFromStructuredInput(input: string | undefined) {
  if (!input) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const candidate = record.skill ?? record.skill_name ?? record.skillName;
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed && !/[\\/]/u.test(trimmed)) {
      // Avoid swallowing values that are themselves paths or commands - those
      // belong to the path-based fallback below.
      return trimmed;
    }
  }
  return undefined;
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

function extractOpenCodeSkillNameFromToolOutput(output: string | undefined) {
  if (!output) {
    return undefined;
  }
  const decoded = extractOutputPayload(output).replace(/\\n/gu, "\n");
  const match = decoded.match(/^#+\s*Skill[:\s]\s*([^\r\n"]+)|^Skill:\s*([^\r\n"]+)/imu);
  const skillName = (match?.[1] ?? match?.[2])?.trim();
  if (skillName) {
    return skillName;
  }
  // Codex `Get-Content -Raw '...\SKILL.md'` returns the file body whose YAML
  // frontmatter starts with `name: <skill>`. Recognise that pattern as a
  // last-ditch hint when the tool name itself does not carry a path.
  const frontmatter = decoded.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/u);
  const frontmatterBody = frontmatter?.[1];
  if (frontmatterBody) {
    const nameMatch = frontmatterBody.match(/^\s*name\s*:\s*["']?([^"'\r\n]+?)["']?\s*$/imu);
    const frontmatterName = nameMatch?.[1]?.trim();
    if (frontmatterName) {
      return frontmatterName;
    }
  }
  return undefined;
}

function extractOutputPayload(output: string) {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    if (typeof parsed.output === "string") {
      return parsed.output;
    }
  } catch {
    // OpenCode may already provide plain stdout text.
  }
  return output;
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

export function coalesceDisplayMessages(items: AgentMessage[], boundaryTimestamps: string[] = []) {
  const boundaryTimes = boundaryTimestamps.map((timestamp) => Date.parse(timestamp)).filter(Number.isFinite);
  return items.reduce<AgentMessage[]>((merged, item) => mergeAgentMessages(merged, item, boundaryTimes), []);
}

export function mergeAgentMessages(items: AgentMessage[], incoming: AgentMessage, boundaryTimes: number[] = []) {
  const last = items.at(-1);
  if (!last) {
    return [incoming];
  }

  if (last.role === incoming.role && last.role !== "system") {
    const hasBoundary = hasTimelineBoundaryBetween(last.timestamp, incoming.timestamp, boundaryTimes);
    if (hasBoundary) {
      if (incoming.text.startsWith(last.text)) {
        const deltaText = incoming.text.slice(last.text.length);
        return deltaText ? [...items, { ...incoming, text: deltaText }] : items;
      }
      return [...items, incoming];
    }

    if (last.id === incoming.id || shouldMergeAssistantStreamChunk(last, incoming)) {
      const isCumulativeSnapshot = incoming.text.startsWith(last.text);
      const nextText = isCumulativeSnapshot ? incoming.text : `${last.text}${incoming.text}`;
      return [
        ...items.slice(0, -1),
        {
          ...last,
          ...incoming,
          id: last.id,
          text: collapseRepeatedAssistantText(nextText),
          timestamp: incoming.timestamp,
        },
      ];
    }
  }

  if (last.role === "system" && incoming.role === "system" && last.text === incoming.text) {
    return items;
  }

  return [...items, incoming];
}

export type MergeMessageHistoryOptions = {
  mode?: "append" | "prepend";
};

export function mergeMessageHistory(current: AgentMessage[], incoming: AgentMessage[], options: MergeMessageHistoryOptions = {}) {
  const merged = [...current];
  const source = options.mode === "prepend" ? [...incoming].reverse() : incoming;

  for (const message of source) {
    const index = merged.findIndex((item) => item.id === message.id);
    const equivalentIndex = index === -1 ? merged.findIndex((item) => isEquivalentMessage(item, message)) : -1;
    const mergeIndex = index === -1 ? equivalentIndex : index;
    if (mergeIndex === -1) {
      if (options.mode === "prepend") {
        merged.unshift(message);
      } else {
        merged.push(message);
      }
      continue;
    }

    merged[mergeIndex] = {
      ...merged[mergeIndex],
      ...message,
      text: merged[mergeIndex]!.text === message.text || merged[mergeIndex]!.text.endsWith(message.text) ? merged[mergeIndex]!.text : `${merged[mergeIndex]!.text}${message.text}`,
      timestamp: merged[mergeIndex]!.timestamp,
    };
  }

  return merged;
}

function isEquivalentMessage(left: AgentMessage, right: AgentMessage) {
  if (left.role !== right.role || left.text !== right.text) {
    return false;
  }
  const delta = Math.abs(Date.parse(left.timestamp) - Date.parse(right.timestamp));
  return Number.isFinite(delta) && delta < 10_000;
}

function shouldMergeAssistantStreamChunk(current: AgentMessage, incoming: AgentMessage) {
  return current.role === "assistant" && incoming.role === "assistant" && isRuntimeGeneratedMessageId(current.id) && isRuntimeGeneratedMessageId(incoming.id);
}

function isRuntimeGeneratedMessageId(id: string) {
  return /-msg-\d+$/u.test(id);
}

function hasTimelineBoundaryBetween(leftTimestamp: string, rightTimestamp: string, boundaryTimes: number[]) {
  const leftTime = Date.parse(leftTimestamp);
  const rightTime = Date.parse(rightTimestamp);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return false;
  }
  const minTime = Math.min(leftTime, rightTime);
  const maxTime = Math.max(leftTime, rightTime);
  return boundaryTimes.some((boundaryTime) => boundaryTime > minTime && boundaryTime <= maxTime);
}

function collapseRepeatedAssistantText(text: string) {
  const firstLine = text.split(/\r?\n/u)[0]?.trim();
  if (!firstLine || firstLine.length < 8) {
    return text;
  }

  const repeatIndex = text.indexOf(firstLine, firstLine.length);
  if (repeatIndex === -1) {
    return text;
  }

  const bridgeIndex = text.lastIndexOf("我会按 `superpowers`", repeatIndex);
  const cutIndex = bridgeIndex !== -1 && repeatIndex - bridgeIndex < 240 ? bridgeIndex : repeatIndex;
  return text.slice(0, cutIndex).trimEnd();
}
