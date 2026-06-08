import type {
  AgentPlan,
  AgentPlanEntryPriority,
  AgentPlanEntryStatus,
} from "@tiller/shared";

export function extractAgentPlan(
  updateType: string | undefined,
  update: any,
  now = new Date().toISOString(),
): AgentPlan | null {
  if (updateType !== "plan") {
    return null;
  }
  const entries = Array.isArray(update?.entries)
    ? update.entries.flatMap(normalizePlanEntry)
    : [];
  return entries.length ? { entries, updatedAt: now } : null;
}

function normalizePlanEntry(entry: unknown) {
  if (!entry || typeof entry !== "object") {
    return [];
  }
  const record = entry as Record<string, unknown>;
  const content = stringFrom(record.content);
  if (!content.trim()) {
    return [];
  }
  return [{
    content,
    priority: normalizePriority(record.priority),
    status: normalizeStatus(record.status),
  }];
}

function normalizePriority(value: unknown): AgentPlanEntryPriority {
  return value === "high" || value === "low" ? value : "medium";
}

function normalizeStatus(value: unknown): AgentPlanEntryStatus {
  if (value === "completed" || value === "in_progress") {
    return value;
  }
  return "pending";
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value : "";
}
