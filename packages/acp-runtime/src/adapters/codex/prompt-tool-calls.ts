import { readFileSync, statSync } from "node:fs";
import type { AgentToolCall } from "@tiller/shared";
import type { SessionRuntimeEvent } from "../../runtime-types";
import type { AcpPromptObservationContext } from "../types";
import { resolveCodexSubagentTitle } from "./tool-calls";
import {
  fingerprintPromptToolCall,
  safelyReadPromptToolCalls,
  type PromptToolCallReader,
} from "../prompt-observer";
import {
  extractCodexToolCallsFromTranscriptText,
  resolveCodexTranscriptPath,
} from "./transcript/tool-calls";

const MAX_CACHED_TRANSCRIPT_SESSIONS = 32;

type CodexSubagentLaunch = {
  id: string;
  title: string;
  input?: string;
  timestamp: string;
  agentId?: string;
};

type CodexPromptObservationState = {
  fingerprints: Map<string, string>;
  launchesByCallId: Map<string, CodexSubagentLaunch>;
  launchesByAgentId: Map<string, CodexSubagentLaunch>;
};

export function createCodexPromptToolCallObserver(
  readTranscript: PromptToolCallReader = createCachedCodexTranscriptReader(),
) {
  const states = new Map<string, CodexPromptObservationState>();

  return {
    begin(context: AcpPromptObservationContext) {
      const toolCalls = safelyReadPromptToolCalls(readTranscript, context);
      const state: CodexPromptObservationState = {
        fingerprints: new Map(
          toolCalls.map((toolCall) => [toolCall.id, fingerprintPromptToolCall(toolCall)]),
        ),
        launchesByCallId: new Map(),
        launchesByAgentId: new Map(),
      };
      for (const toolCall of toolCalls) {
        rememberCodexSubagentLaunch(toolCall, state);
      }
      states.set(context.runtimeSessionId, state);
    },
    poll(context: AcpPromptObservationContext): SessionRuntimeEvent[] {
      const state = states.get(context.runtimeSessionId);
      if (!state) {
        this.begin(context);
        return [];
      }
      const events: SessionRuntimeEvent[] = [];
      for (const toolCall of safelyReadPromptToolCalls(readTranscript, context)) {
        const nextFingerprint = fingerprintPromptToolCall(toolCall);
        if (state.fingerprints.get(toolCall.id) === nextFingerprint) {
          continue;
        }
        state.fingerprints.set(toolCall.id, nextFingerprint);
        const projected = projectCodexSubagentToolCall(toolCall, state);
        if (projected) {
          events.push({ type: "tool-call", toolCall: projected });
        }
      }
      return events;
    },
    dispose(sessionId: string) {
      states.delete(sessionId);
    },
  };
}

function createCachedCodexTranscriptReader(): PromptToolCallReader {
  const cache = new Map<string, {
    path: string;
    size: number;
    modifiedAt: number;
    toolCalls: AgentToolCall[];
  }>();
  return (context) => {
    const cached = cache.get(context.runtimeSessionId);
    const path = cached?.path ?? resolveCodexTranscriptPath(context);
    if (!path) {
      return [];
    }
    const stats = statSync(path);
    if (
      cached &&
      cached.path === path &&
      cached.size === stats.size &&
      cached.modifiedAt === stats.mtimeMs
    ) {
      return cached.toolCalls;
    }
    const toolCalls = extractCodexToolCallsFromTranscriptText(
      readFileSync(path, "utf8"),
    );
    cache.set(context.runtimeSessionId, {
      path,
      size: stats.size,
      modifiedAt: stats.mtimeMs,
      toolCalls,
    });
    while (cache.size > MAX_CACHED_TRANSCRIPT_SESSIONS) {
      const oldestSessionId = cache.keys().next().value;
      if (oldestSessionId === undefined) {
        break;
      }
      cache.delete(oldestSessionId);
    }
    return toolCalls;
  };
}

function projectCodexSubagentToolCall(
  toolCall: AgentToolCall,
  state: CodexPromptObservationState,
): AgentToolCall | null {
  if (toolCall.kind !== "subagent") {
    return null;
  }
  const toolName = toolCall.title.trim();
  const input = parseRecord(toolCall.input);
  const output = parseRecord(toolCall.output);

  if (toolName === "spawn_agent") {
    const {
      sequence: _sequence,
      ...toolCallWithoutSequence
    } = toolCall;
    const launch = rememberCodexSubagentLaunch(toolCall, state)!;
    const targetId = launch.agentId ?? toolCall.id;
    return {
      ...toolCallWithoutSequence,
      id: launch.id,
      commandId: toolCall.id,
      kind: "subagent",
      title: launch.title,
      status: toolCall.status,
      ...(launch.input ? { input: launch.input } : {}),
      subagentOperation: {
        action: "spawn",
        targets: [{ id: targetId, label: launch.title }],
      },
    };
  }

  if (toolName !== "wait_agent" && toolName !== "close_agent") {
    return null;
  }
  const targetIds = collectCodexSubagentTargets(input);
  const targets = targetIds.map((id) => {
    const launch = state.launchesByAgentId.get(id);
    return { id, ...(launch ? { label: launch.title } : {}) };
  });
  const title = targets.length === 1
    ? targets[0]?.label ?? "Subagent"
    : targets.length > 1
      ? `${targets.length} 个 Subagent`
      : "Subagent";
  const waitOutput = toolName === "wait_agent"
    ? formatCodexWaitOutput(output, targets) ?? toolCall.output
    : undefined;
  const {
    output: _output,
    sequence: _sequence,
    ...toolCallWithoutOutput
  } = toolCall;
  return {
    ...toolCallWithoutOutput,
    id: toolCall.id,
    commandId: toolCall.id,
    kind: "subagent",
    title,
    status: toolCall.status,
    ...(toolCall.input ? { input: toolCall.input } : {}),
    ...(toolName === "wait_agent"
      ? {
          ...(waitOutput ? { output: waitOutput } : {}),
          subagentOperation: { action: "wait" as const, targets },
        }
      : {
          ...(toolCall.output ? { output: toolCall.output } : {}),
          subagentOperation: { action: "close" as const, targets },
        }),
  };
}

function rememberCodexSubagentLaunch(
  toolCall: AgentToolCall,
  state: CodexPromptObservationState,
) {
  if (toolCall.kind !== "subagent" || toolCall.title.trim() !== "spawn_agent") {
    return undefined;
  }
  const input = parseRecord(toolCall.input);
  const output = parseRecord(toolCall.output);
  const existing = state.launchesByCallId.get(toolCall.id);
  const title = resolveCodexSubagentTitle(
    input,
    firstString(
      output?.nickname,
      output?.name,
      existing?.title,
    ),
  );
  const launch: CodexSubagentLaunch = existing ?? {
    id: toolCall.id,
    title,
    ...(toolCall.input ? { input: toolCall.input } : {}),
    timestamp: toolCall.timestamp,
  };
  launch.title = title;
  launch.agentId = firstString(output?.agent_id, output?.agentId) ?? launch.agentId;
  state.launchesByCallId.set(toolCall.id, launch);
  if (launch.agentId) {
    state.launchesByAgentId.set(launch.agentId, launch);
  }
  return launch;
}

function collectCodexSubagentTargets(input: Record<string, unknown> | null) {
  const targets = [
    firstString(input?.target, input?.agent_id, input?.agentId),
    ...(Array.isArray(input?.targets)
      ? input.targets.map((target) => firstString(target))
      : []),
    ...(Array.isArray(input?.receiverThreadIds)
      ? input.receiverThreadIds.map((target) => firstString(target))
      : []),
    ...(Array.isArray(input?.receiver_thread_ids)
      ? input.receiver_thread_ids.map((target) => firstString(target))
      : []),
    ...(Array.isArray(input?.ids)
      ? input.ids.map((target) => firstString(target))
      : []),
  ].filter((target): target is string => Boolean(target));
  return [...new Set(targets)];
}

function formatCodexWaitOutput(
  output: Record<string, unknown> | null,
  targets: Array<{ id: string; label?: string }>,
) {
  const completions = targets.flatMap((target) => {
    const completion = extractCodexWaitCompletion(output, target.id);
    return completion === undefined ? [] : [{ ...target, completion }];
  });
  if (completions.length === 1) {
    return completions[0]?.completion;
  }
  if (completions.length > 1) {
    return completions
      .map(({ id, label, completion }) => `### ${label ?? id}\n\n${completion}`)
      .join("\n\n");
  }
  return undefined;
}

function extractCodexWaitCompletion(
  output: Record<string, unknown> | null,
  target: string,
) {
  const status = recordFrom(output?.status);
  const targetStatus = recordFrom(status?.[target]);
  return firstString(targetStatus?.completed, targetStatus?.failed, targetStatus?.cancelled);
}

function parseRecord(value: string | undefined) {
  if (!value) {
    return null;
  }
  try {
    return recordFrom(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const nested: string | undefined = firstString(
        record.id,
        record.agent_id,
        record.agentId,
        record.thread_id,
        record.threadId,
      );
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}
