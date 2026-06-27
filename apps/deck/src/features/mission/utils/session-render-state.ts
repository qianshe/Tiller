import type {
  AgentMessage,
  AgentToolCall,
  PermissionRequest,
  ProjectFileSummary,
  SessionStatus,
} from "@tiller/shared";
import { resolvePendingToolActivity } from "../../logbook";
import type { MissionPanelPage } from "../display/panels";
import { isSessionExecutionPending } from "./session-state";

export function buildMissionDisplayTabs(
  _diffCount: number,
  _logCount: number,
): MissionPanelPage[] {
  return [
    { id: "graph", title: "图表" },
    { id: "diff-detail", title: "Diff 详情" },
  ];
}

export function selectMissionDisplayTab(
  tabs: MissionPanelPage[],
  selectedTabId: string,
): MissionPanelPage {
  return tabs.find((tab) => tab.id === selectedTabId) ?? tabs[0]!;
}

export function resolveVisibleProjectFiles(
  projectFiles: ProjectFileSummary[],
  filter: string,
  expandedDirectories: Set<string>,
) {
  const filterText = filter.trim().toLowerCase();
  return projectFiles.filter((file) => {
    if (filterText) {
      return file.path.toLowerCase().includes(filterText);
    }
    const parts = file.path.split("/");
    const ancestorPaths = parts
      .slice(0, -1)
      .map((_, index) => parts.slice(0, index + 1).join("/"));
    return ancestorPaths.every((path) => expandedDirectories.has(path));
  });
}

export function joinClassNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function resolveMissionActivityLoading({
  status,
  messages,
  toolCalls,
  pendingPermission,
}: {
  status: SessionStatus;
  messages: AgentMessage[];
  toolCalls: AgentToolCall[];
  pendingPermission: PermissionRequest | null;
}) {
  if (!isSessionExecutionPending(status)) return null;
  const pendingToolActivity = resolvePendingToolActivity(
    toolCalls.filter((toolCall) => toolCall.kind !== "think"),
  );
  if (pendingToolActivity) return pendingToolActivity;
  if (toolCalls.some(isPendingThinkingToolCall)) return null;
  if (pendingPermission) return null;
  return { title: "ACP 正在运行", status };
}

function isPendingThinkingToolCall(toolCall: AgentToolCall) {
  return (
    toolCall.kind === "think" &&
    (toolCall.status === "pending" || toolCall.status === "running")
  );
}
