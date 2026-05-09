import type {
  AgentMessage,
  AgentToolCall,
  PermissionRequest,
  ProjectFileSummary,
  SessionStatus,
} from "@tiller/shared";
import { resolvePendingToolActivity } from "../../logbook";
import type { MissionPanelPage } from "../ui/panels";
import { isSessionExecutionPending } from "./session-state";

export function buildMissionPanelPages(
  diffCount: number,
  logCount: number,
  customPages: MissionPanelPage[],
): MissionPanelPage[] {
  return [
    { id: "overview", title: "概览" },
    { id: "logbook", title: `航行日志 (${logCount})` },
    ...(diffCount > 0 ? [{ id: "diff-detail", title: "Diff 详情" }] : []),
    ...customPages,
  ];
}

export function selectMissionPanelPage(
  pages: MissionPanelPage[],
  selectedPageId: string,
): MissionPanelPage {
  return pages.find((page) => page.id === selectedPageId) ?? pages[0]!;
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
  const pendingToolActivity = resolvePendingToolActivity(toolCalls);
  if (pendingToolActivity) return pendingToolActivity;
  if (pendingPermission) return null;
  if (!isSessionExecutionPending(status)) return null;
  return shouldShowAgentResponseFallback(messages)
    ? { title: "Agent 响应", status }
    : null;
}

function shouldShowAgentResponseFallback(messages: AgentMessage[]) {
  const sortedMessages = [...messages].sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
  const latestUser = findLastMessageByRole(sortedMessages, "user");
  if (!latestUser) return false;
  const latestAssistant = findLastMessageByRole(sortedMessages, "assistant");
  if (!latestAssistant) return true;
  return Date.parse(latestUser.timestamp) > Date.parse(latestAssistant.timestamp);
}

function findLastMessageByRole(
  messages: AgentMessage[],
  role: AgentMessage["role"],
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === role) return message;
  }
  return null;
}
