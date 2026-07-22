import type { RuntimeEventOrigin } from "../../runtime-types";
import type { AcpSessionUpdateProjectionContext } from "../types";

export function resolveClaudeRuntimeEventOrigin(
  context: AcpSessionUpdateProjectionContext,
): RuntimeEventOrigin | undefined {
  const update = recordFrom(context.update);
  const meta = recordFrom(update._meta);
  const claudeCode = recordFrom(meta.claudeCode);
  const parentToolCallId = claudeCode.parentToolUseId;
  if (typeof parentToolCallId !== "string" || !parentToolCallId.trim()) {
    return undefined;
  }
  return {
    scope: "subagent",
    parentToolCallId: parentToolCallId.trim(),
  };
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
