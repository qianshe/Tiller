import type { ConversationToolCallItem } from "../../logbook";

type CodexSubagentStatusBadge = {
  className: string;
  label: string;
};

export type CodexSubagentPresentation = {
  label: string;
  summary: string;
  text: string;
  statusBadge: CodexSubagentStatusBadge;
};

export function resolveCodexSubagentPresentation(
  item: ConversationToolCallItem,
): CodexSubagentPresentation | null {
  const operation = item.subagentOperation;
  if (!operation) {
    return null;
  }
  const previousStatus = operation.action === "close"
    ? resolvePreviousStatus(item.text)
    : null;
  return {
    label: resolveSubagentTitle(item),
    summary: previousStatus ? `关闭前${previousStatus.label}` : "",
    text: operation.action === "spawn"
      ? formatSpawnContent(item)
      : operation.action === "wait"
        ? formatWaitContent(item)
        : formatCloseContent(item, previousStatus),
    statusBadge: resolveOperationStatusBadge(item),
  };
}

function resolveSubagentTitle(item: ConversationToolCallItem) {
  const title = item.title.trim();
  if (title && title !== "Subagent") {
    return title;
  }
  const action = item.subagentOperation?.action;
  return action ? `Subagent: ${action}` : "Subagent";
}

function resolveOperationStatusBadge(item: ConversationToolCallItem): CodexSubagentStatusBadge {
  const action = item.subagentOperation!.action;
  if (item.status === "failed") {
    return {
      className: "bg-danger-soft text-danger",
      label: action === "spawn" ? "创建失败" : action === "wait" ? "等待失败" : "关闭失败",
    };
  }
  if (item.status === "cancelled") {
    return {
      className: "bg-surface-sunken text-muted-foreground",
      label: "已取消",
    };
  }
  if (item.status === "pending" || item.status === "running" || item.status === "waiting_for_permission") {
    return {
      className: "bg-accent/10 text-accent",
      label: action === "spawn" ? "创建中" : action === "wait" ? "等待中" : "关闭中",
    };
  }
  if (action === "wait" && isTimedOut(item.text)) {
    return {
      className: "bg-surface-sunken text-muted-foreground",
      label: "已超时",
    };
  }
  return {
    className: "bg-success/10 text-success",
    label: action === "spawn" ? "已创建" : action === "wait" ? "已返回" : "已关闭",
  };
}

function formatSpawnContent(item: ConversationToolCallItem) {
  const input = parseRecord(item.input);
  const task = firstString(input?.message, input?.prompt, input?.description);
  return [
    task ? `任务：${task}` : "",
    formatTargetDetails(item),
  ].filter(Boolean).join("\n\n") || "Subagent 已创建";
}

function formatWaitContent(item: ConversationToolCallItem) {
  const output = parseRecord(item.text);
  if (isTimedOut(item.text)) {
    return [
      "等待已超时，Subagent 仍可能继续运行。",
      formatTargetDetails(item),
    ].filter(Boolean).join("\n\n");
  }
  const status = recordFrom(output?.status);
  if (status) {
    const replies = (item.subagentOperation?.targets ?? []).flatMap((target) => {
      const targetStatus = recordFrom(status[target.id]);
      const reply = firstString(
        targetStatus?.completed,
        targetStatus?.failed,
        targetStatus?.cancelled,
      );
      return reply ? [{ target, reply }] : [];
    });
    if (replies.length === 1) {
      return replies[0]?.reply ?? "";
    }
    if (replies.length > 1) {
      return replies
        .map(({ target, reply }) => `### ${target.label ?? target.id}\n\n${reply}`)
        .join("\n\n");
    }
  }
  return item.text.trim() || formatTargetDetails(item) || "等待 Subagent 回复";
}

function formatCloseContent(
  item: ConversationToolCallItem,
  previousStatus: { label: string; detail?: string } | null,
) {
  return [
    formatTargetDetails(item),
    previousStatus ? `关闭前状态：${previousStatus.label}` : "",
    previousStatus?.detail ? `关闭前回复：${previousStatus.detail}` : "",
  ].filter(Boolean).join("\n\n") || "Subagent 已关闭";
}

function formatTargetDetails(item: ConversationToolCallItem) {
  const targets = item.subagentOperation?.targets ?? [];
  if (targets.length === 1) {
    const target = targets[0];
    if (!target) return "";
    return target.label && target.label !== target.id
      ? `Subagent：${target.label}\n\nAgent ID：\`${target.id}\``
      : `Subagent：${target.label ?? target.id}`;
  }
  return targets.length > 1
    ? ["目标：", ...targets.map((target) => `- ${target.label ?? target.id}`)].join("\n")
    : "";
}

function resolvePreviousStatus(text: string) {
  const output = parseRecord(text);
  const previous = output?.previous_status ?? output?.previousStatus;
  if (typeof previous === "string") {
    return { label: formatPreviousStatusLabel(previous) };
  }
  const record = recordFrom(previous);
  if (!record) {
    return null;
  }
  for (const status of ["completed", "running", "failed", "cancelled", "pending"] as const) {
    if (Object.prototype.hasOwnProperty.call(record, status)) {
      const detail = firstString(record[status]);
      return {
        label: formatPreviousStatusLabel(status),
        ...(detail ? { detail } : {}),
      };
    }
  }
  return null;
}

function formatPreviousStatusLabel(status: string) {
  if (status === "completed") return "已完成";
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已取消";
  if (status === "pending") return "等待中";
  return status;
}

function isTimedOut(text: string) {
  const output = parseRecord(text);
  return output?.timed_out === true || output?.timedOut === true;
}

function parseRecord(value: string) {
  if (!value.trim()) {
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
