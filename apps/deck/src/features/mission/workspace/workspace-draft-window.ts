import type { SessionSummary } from "@tiller/shared";
import { normalizeWorktreePath } from "./runtime-display";

export type PendingDraftWindow = {
  projectId: string;
  cwd: string | null;
  agentId?: string | null;
};

export function shouldAttachDraftWindowToSession(
  pendingDraftWindow: PendingDraftWindow | null | undefined,
  session: SessionSummary | null | undefined,
): boolean {
  if (!pendingDraftWindow || !session?.id) {
    return false;
  }
  const sameProject = session.projectId === pendingDraftWindow.projectId;
  const sameCwd = normalizeWorktreePath(session.cwd) === normalizeWorktreePath(pendingDraftWindow.cwd ?? undefined);
  const sameAgent = !pendingDraftWindow.agentId || session.agentId === pendingDraftWindow.agentId;
  return sameProject && sameCwd && sameAgent;
}
