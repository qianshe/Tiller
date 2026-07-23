import { existsSync, readFileSync } from "node:fs";
import type { AgentPlan, AgentToolCall } from "@tiller/shared";
import { extractCodexPlanFromToolCall, isCodexPlanToolName } from "../plan-events";
import {
  resolveCodexTranscriptPath,
  type CodexTranscriptToolCallOptions,
} from "./tool-calls";

export type CodexTranscriptPlanOptions = CodexTranscriptToolCallOptions;

export function readCodexTranscriptPlanFromDisk(
  options: CodexTranscriptPlanOptions,
): AgentPlan | null {
  const path = resolveCodexTranscriptPath(options);
  if (!path || !existsSync(path)) {
    return null;
  }
  return extractCodexPlanFromTranscriptText(readFileSync(path, "utf8"));
}

export function extractCodexPlanFromTranscriptText(raw: string): AgentPlan | null {
  let latestPlan: AgentPlan | null = null;

  for (const line of raw.split(/\r?\n/u)) {
    const record = parseLine(line);
    if (!record) {
      continue;
    }
    const timestamp = firstString(record.timestamp) || new Date(0).toISOString();
    if (firstString(record.type) !== "response_item") {
      continue;
    }
    const payload = asRecord(record.payload);
    if (!payload) {
      continue;
    }
    const payloadType = firstString(payload.type);
    if (payloadType !== "function_call" && payloadType !== "custom_tool_call") {
      continue;
    }
    const name = firstString(payload.name);
    const namespace = firstString(payload.namespace);
    const qualifiedName = namespace && name ? `${namespace}.${name}` : name;
    if (!isCodexPlanToolName(qualifiedName || name)) {
      continue;
    }
    const input = stringifyValue(payload.arguments ?? payload.input);
    const plan = extractCodexPlanFromToolCall({
      id: firstString(payload.call_id) || `codex-plan-${timestamp}`,
      kind: "todo",
      title: qualifiedName || name,
      status: normalizeToolStatus(firstString(payload.status)) ?? "completed",
      ...(input ? { input } : {}),
      timestamp,
      updatedAt: timestamp,
    } satisfies AgentToolCall);
    if (plan) {
      latestPlan = plan;
    }
  }

  return latestPlan;
}

function parseLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringifyValue(value: unknown): string | undefined {
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

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeToolStatus(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "completed") return "completed";
  if (normalized === "failed") return "failed";
  if (normalized === "pending") return "pending";
  if (normalized === "running" || normalized === "in_progress") return "running";
  return undefined;
}
