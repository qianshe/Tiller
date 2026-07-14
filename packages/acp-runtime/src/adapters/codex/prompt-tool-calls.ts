import { readFileSync, statSync } from "node:fs";
import type { AgentToolCall } from "@tiller/shared";
import type { SessionRuntimeEvent } from "../../runtime-types";
import type { AcpPromptObservationContext } from "../types";
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
  commandId?: string;
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
      states.set(context.runtimeSessionId, {
        fingerprints: new Map(
          toolCalls.map((toolCall) => [toolCall.id, fingerprintPromptToolCall(toolCall)]),
        ),
        launchesByCallId: new Map(),
        launchesByAgentId: new Map(),
      });
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
      output: _output,
      sequence: _sequence,
      ...toolCallWithoutOutput
    } = toolCall;
    const launch = state.launchesByCallId.get(toolCall.id) ?? {
      id: toolCall.id,
      title: firstString(input?.task_name, input?.taskName) ?? "Subagent",
      ...(toolCall.input ? { input: toolCall.input } : {}),
      timestamp: toolCall.timestamp,
    };
    state.launchesByCallId.set(toolCall.id, launch);
    const agentId = firstString(output?.agent_id, output?.agentId);
    if (agentId) {
      launch.commandId = `subagent:${agentId}`;
      state.launchesByAgentId.set(agentId, launch);
    }
    return {
      ...toolCallWithoutOutput,
      id: launch.id,
      kind: "subagent",
      title: launch.title,
      status: toolCall.status === "failed" ? "failed" : "running",
      ...(launch.input ? { input: launch.input } : {}),
      ...(launch.commandId ? { commandId: launch.commandId } : {}),
      ...(toolCall.status === "failed" && toolCall.output
        ? { output: toolCall.output }
        : {}),
    };
  }

  if (toolName !== "wait_agent") {
    return null;
  }
  const target = firstString(
    input?.target,
    Array.isArray(input?.targets) ? input.targets[0] : undefined,
  );
  const launch = target ? state.launchesByAgentId.get(target) : undefined;
  const completion = target
    ? extractCodexWaitCompletion(output, target)
    : undefined;
  const timedOut = output?.timed_out === true || output?.timedOut === true;
  const {
    output: _output,
    sequence: _sequence,
    ...toolCallWithoutOutput
  } = toolCall;
  return {
    ...toolCallWithoutOutput,
    id: launch?.id ?? toolCall.id,
    kind: "subagent",
    title: launch?.title ?? "Subagent",
    status: toolCall.status === "failed"
      ? "failed"
      : completion !== undefined
        ? "completed"
        : timedOut
          ? "running"
          : toolCall.status,
    ...(launch?.input ? { input: launch.input } : {}),
    ...(target ? { commandId: `subagent:${target}` } : {}),
    ...(completion !== undefined
      ? { output: completion }
      : {}),
    timestamp: launch?.timestamp ?? toolCall.timestamp,
  };
}

function extractCodexWaitCompletion(
  output: Record<string, unknown> | null,
  target: string,
) {
  const status = recordFrom(output?.status);
  const targetStatus = recordFrom(status?.[target]);
  return firstString(targetStatus?.completed);
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

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}
