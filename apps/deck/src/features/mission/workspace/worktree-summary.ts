function normalizeWorktreePath(path: string | undefined | null) {
  return path?.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase() ?? null;
}

export type MissionWorktreeSummarySession = {
  id?: string;
  cwd?: string | null;
  projectName?: string | null;
  worktreeName?: string | null;
};

export type MissionWorktreeSummaryItem = {
  branchName: string;
  cwd: string;
  sessionCount: number;
  sessionTitles: string[];
};

export function buildSelectedSessionWorktreeItems({
  sessions,
  activeSession,
  currentGitBranch,
}: {
  sessions: MissionWorktreeSummarySession[];
  activeSession?: MissionWorktreeSummarySession | null;
  currentGitBranch?: string | null;
}): MissionWorktreeSummaryItem[] {
  const sourceSessions = sessions.length ? sessions : activeSession ? [activeSession] : [];
  const byCwd = new Map<string, MissionWorktreeSummaryItem>();

  for (const session of sourceSessions) {
    if (!session.cwd) {
      continue;
    }
    const cwdKey = normalizeWorktreePath(session.cwd) ?? session.cwd;
    const activeCwd = activeSession?.cwd ? normalizeWorktreePath(activeSession.cwd) : null;
    const branchName =
      session.worktreeName ??
      (activeCwd && cwdKey === activeCwd ? currentGitBranch : null) ??
      session.projectName ??
      "未检测分支";
    const existing = byCwd.get(cwdKey);
    if (existing) {
      existing.sessionCount += 1;
      continue;
    }
    byCwd.set(cwdKey, {
      branchName,
      cwd: session.cwd,
      sessionCount: 1,
      sessionTitles: [],
    });
  }

  return Array.from(byCwd.values());
}

export function formatInspectorWorktreeSummaryLabel(
  selectedSessionWorktreeItems: MissionWorktreeSummaryItem[],
  worktreeCount: number,
): string {
  return selectedSessionWorktreeItems.length
    ? `${selectedSessionWorktreeItems
        .slice(0, 2)
        .map((item) => item.branchName)
        .join(" / ")}${selectedSessionWorktreeItems.length > 2 ? ` +${selectedSessionWorktreeItems.length - 2}` : ""}`
    : `${worktreeCount} Worktrees`;
}
