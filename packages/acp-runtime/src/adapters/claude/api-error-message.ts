import { existsSync, readFileSync } from "node:fs";
import type { AcpSessionUpdateProjectionContext } from "../types";
import { resolveClaudeTranscriptPath } from "./transcript/plan";

export const CLAUDE_API_ERROR_CODE = "ACP_AGENT_API_ERROR";

type ClaudeApiErrorLookupInput = {
  runtimeSessionId: string;
  cwd: string;
  messageId: string;
};

type ClaudeApiErrorLookup = (input: ClaudeApiErrorLookupInput) => boolean;

export function createClaudeApiErrorMessageProjector(
  lookup: ClaudeApiErrorLookup = isClaudeApiErrorMessageOnDisk,
) {
  return {
    mapUpdate(context: AcpSessionUpdateProjectionContext) {
      if (context.updateType !== "agent_message_chunk") {
        return null;
      }
      const message = context.text;
      if (!message || !isCandidateClaudeApiError(message)) {
        return null;
      }
      const messageId = resolveMessageId(context.update);
      if (
        messageId &&
        context.cwd &&
        lookup({
          runtimeSessionId: context.sessionId,
          cwd: context.cwd,
          messageId,
        })
      ) {
        return {
          type: "error" as const,
          code: CLAUDE_API_ERROR_CODE,
          message,
        };
      }
      return looksLikeAuthenticationApiError(message)
        ? {
          type: "error" as const,
          code: CLAUDE_API_ERROR_CODE,
          message,
        }
        : null;
    },
  };
}

export function isClaudeApiErrorMessageInTranscript(
  raw: string,
  messageId: string,
) {
  for (const line of raw.split(/\r?\n/u)) {
    const record = recordFrom(parseJson(line));
    if (record.isApiErrorMessage !== true) {
      continue;
    }
    const message = recordFrom(record.message);
    if (message.id === messageId && message.role === "assistant") {
      return true;
    }
  }
  return false;
}

function isClaudeApiErrorMessageOnDisk(input: ClaudeApiErrorLookupInput) {
  try {
    const path = resolveClaudeTranscriptPath(input);
    return existsSync(path) && isClaudeApiErrorMessageInTranscript(
      readFileSync(path, "utf8"),
      input.messageId,
    );
  } catch {
    return false;
  }
}

function resolveMessageId(update: unknown) {
  const record = recordFrom(update);
  const message = recordFrom(record.message);
  return firstString(record.messageId, record.message_id, message.id);
}

function looksLikeAuthenticationApiError(text: string | null) {
  return Boolean(
    text && /^Failed to authenticate\.\s+API Error:\s*\d{3}\b[\s\S]*\(request id:\s*[A-Za-z0-9_-]+\)\s*$/u.test(text),
  );
}

function isCandidateClaudeApiError(text: string | null) {
  return Boolean(
    text && (
      /^Failed to authenticate\.\s+API Error:/u.test(text) ||
      /^API Error:/u.test(text) ||
      /^Prompt is too long\s*$/u.test(text)
    ),
  );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}
