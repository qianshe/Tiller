import { existsSync, statSync } from "node:fs";
import type { AgentPlan, AgentToolCall } from "@tiller/shared";
import type { SessionRuntimeEvent } from "../../runtime-types";
import type { AcpPromptObservationContext } from "../types";
import {
  readClaudeTaskToolCallsFromDisk,
  resolveClaudeTranscriptPath,
} from "./transcript/plan";

type ClaudePromptPlanReconciler = (
  context: AcpPromptObservationContext,
  toolCalls: readonly AgentToolCall[],
) => AgentPlan | null;

type ClaudePromptTaskToolCallSnapshot = {
  revision: string;
  toolCalls: AgentToolCall[];
};

type ClaudePromptTaskToolCallReader = {
  dispose?(sessionId: string): void;
  read(
    context: AcpPromptObservationContext,
  ): ClaudePromptTaskToolCallSnapshot | null;
};

export function createClaudePromptPlanObserver(
  reconcilePlan: ClaudePromptPlanReconciler,
  reader: ClaudePromptTaskToolCallReader = createCachedClaudeTranscriptReader(),
) {
  const observedRevisions = new Map<string, string>();

  return {
    poll(context: AcpPromptObservationContext): SessionRuntimeEvent[] {
      const snapshot = safelyReadTaskToolCalls(reader, context);
      if (
        !snapshot ||
        observedRevisions.get(context.runtimeSessionId) === snapshot.revision
      ) {
        return [];
      }
      observedRevisions.set(context.runtimeSessionId, snapshot.revision);
      const plan = reconcilePlan(context, snapshot.toolCalls);
      return plan ? [{ type: "plan-update", plan }] : [];
    },
    dispose(sessionId: string) {
      observedRevisions.delete(sessionId);
      reader.dispose?.(sessionId);
    },
  };
}

function createCachedClaudeTranscriptReader(): ClaudePromptTaskToolCallReader {
  const cache = new Map<string, ClaudePromptTaskToolCallSnapshot & {
    path: string;
  }>();

  return {
    read(context) {
      const path = resolveClaudeTranscriptPath(context);
      try {
        if (!existsSync(path)) {
          cache.delete(context.runtimeSessionId);
          return null;
        }
        const stat = statSync(path);
        const revision = `${stat.mtimeMs}:${stat.size}`;
        const cached = cache.get(context.runtimeSessionId);
        if (cached?.path === path && cached.revision === revision) {
          return cached;
        }
        const snapshot = {
          path,
          revision,
          toolCalls: readClaudeTaskToolCallsFromDisk(context),
        };
        cache.set(context.runtimeSessionId, snapshot);
        return snapshot;
      } catch {
        return null;
      }
    },
    dispose(sessionId) {
      cache.delete(sessionId);
    },
  };
}

function safelyReadTaskToolCalls(
  reader: ClaudePromptTaskToolCallReader,
  context: AcpPromptObservationContext,
) {
  try {
    return reader.read(context);
  } catch {
    return null;
  }
}
