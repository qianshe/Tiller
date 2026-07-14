import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { AgentToolCall } from "@tiller/shared";
import type { SessionRuntimeEvent } from "../../runtime-types";
import type { AcpPromptObservationContext } from "../types";
import {
  fingerprintPromptToolCall,
  safelyReadPromptToolCalls,
  type PromptToolCallReader,
} from "../prompt-observer";
import { extractClaudeToolCallsFromTranscriptText } from "./transcript/tool-calls";
import { resolveClaudeTranscriptPath } from "./transcript/plan";

const MAX_RECENT_SUBAGENT_TRANSCRIPTS = 16;
const MAX_TRANSCRIPT_TAIL_BYTES = 512 * 1024;

export function createClaudePromptToolCallObserver(
  readTranscript: PromptToolCallReader = createCachedClaudeSubagentTranscriptReader(),
) {
  const fingerprintsBySession = new Map<string, Map<string, string>>();

  return {
    begin(context: AcpPromptObservationContext) {
      fingerprintsBySession.set(
        context.runtimeSessionId,
        new Map(
          safelyReadPromptToolCalls(readTranscript, context).map((toolCall) => [
            toolCall.id,
            fingerprintPromptToolCall(toolCall),
          ]),
        ),
      );
    },
    poll(context: AcpPromptObservationContext): SessionRuntimeEvent[] {
      const fingerprints = fingerprintsBySession.get(context.runtimeSessionId);
      if (!fingerprints) {
        this.begin(context);
        return [];
      }
      const events: SessionRuntimeEvent[] = [];
      for (const toolCall of safelyReadPromptToolCalls(readTranscript, context)) {
        const nextFingerprint = fingerprintPromptToolCall(toolCall);
        if (fingerprints.get(toolCall.id) === nextFingerprint) {
          continue;
        }
        fingerprints.set(toolCall.id, nextFingerprint);
        if (
          toolCall.kind !== "subagent" &&
          (toolCall.kind !== "shell" || isOpaqueToolTitle(toolCall.title))
        ) {
          continue;
        }
        const { sequence: _sequence, ...canonicalToolCall } = toolCall;
        events.push({ type: "tool-call", toolCall: canonicalToolCall });
      }
      return events;
    },
    dispose(sessionId: string) {
      fingerprintsBySession.delete(sessionId);
    },
  };
}

function createCachedClaudeSubagentTranscriptReader(): PromptToolCallReader {
  const cache = new Map<string, {
    modifiedAt: number;
    size: number;
    toolCalls: AgentToolCall[];
  }>();

  return (context) => {
    const transcriptPath = resolveClaudeTranscriptPath(context);
    const subagentDir = join(
      dirname(transcriptPath),
      context.runtimeSessionId,
      "subagents",
    );
    const files = [
      ...(existsSync(transcriptPath)
        ? [fileDescriptor(transcriptPath)]
        : []),
      ...(existsSync(subagentDir)
        ? readdirSync(subagentDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
          .map((entry) => fileDescriptor(join(subagentDir, entry.name)))
          .sort((left, right) => right.modifiedAt - left.modifiedAt)
          .slice(0, MAX_RECENT_SUBAGENT_TRANSCRIPTS)
        : []),
    ];

    const activePaths = new Set(files.map((file) => file.path));
    for (const path of cache.keys()) {
      if (!activePaths.has(path)) {
        cache.delete(path);
      }
    }

    return files.flatMap((file) => {
      const cached = cache.get(file.path);
      if (
        cached &&
        cached.modifiedAt === file.modifiedAt &&
        cached.size === file.size
      ) {
        return cached.toolCalls;
      }
      const toolCalls = extractClaudeToolCallsFromTranscriptText(
        readFileTail(file.path, MAX_TRANSCRIPT_TAIL_BYTES),
        { includePending: true },
      );
      cache.set(file.path, {
        modifiedAt: file.modifiedAt,
        size: file.size,
        toolCalls,
      });
      return toolCalls;
    });
  };
}

function fileDescriptor(path: string) {
  const stats = statSync(path);
  return { path, modifiedAt: stats.mtimeMs, size: stats.size };
}

function readFileTail(path: string, maxBytes: number): string {
  const size = statSync(path).size;
  const bytesToRead = Math.min(size, maxBytes);
  const buffer = Buffer.allocUnsafe(bytesToRead);
  const descriptor = openSync(path, "r");
  try {
    readSync(descriptor, buffer, 0, bytesToRead, size - bytesToRead);
    return buffer.toString("utf8");
  } finally {
    closeSync(descriptor);
  }
}

function isOpaqueToolTitle(title: string): boolean {
  return /^tool\s+call\s+call[_-]/i.test(title.trim()) ||
    /^call[_-][a-z0-9_-]+$/i.test(title.trim());
}
