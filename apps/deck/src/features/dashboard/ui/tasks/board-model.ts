import type { DashboardActivitySession } from "../activity/stream";

export type TaskBoardColumnId = "ready" | "running" | "attention" | "idle";

export type TaskBoardColumnTone = "primary" | "idle" | "active" | "danger";

export type TaskBoardColumnDefinition = {
  id: TaskBoardColumnId;
  label: string;
  tone: TaskBoardColumnTone;
};

export const TASK_BOARD_COLUMNS: readonly TaskBoardColumnDefinition[] = [
  { id: "ready", label: "准备", tone: "idle" },
  { id: "running", label: "进行中", tone: "primary" },
  { id: "idle", label: "空闲", tone: "idle" },
  { id: "attention", label: "待处理", tone: "danger" },
];

export function resolveTaskBoardColumn(
  session: Pick<DashboardActivitySession, "agentName" | "status">,
): TaskBoardColumnId {
  const status = session.status ?? "";

  if (status === "starting" || status === "running") {
    return "running";
  }
  if (status === "waiting_for_permission" || status === "error" || status === "cancelled") {
    return "attention";
  }
  if (!session.agentName && (status === "idle" || status === "completed" || status === "")) {
    return "ready";
  }
  if (status === "idle" || status === "completed") {
    return "idle";
  }
  return "ready";
}
