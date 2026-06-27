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
  projectName: string;
  branchName: string;
  cwd: string;
  sessionCount: number;
  sessionTitles: string[];
};

export function buildSelectedSessionWorktreeItems({
  sessions,
  activeSession,
  currentGitBranch,
  branchByCwd = {},
  selectedCwd,
}: {
  sessions: MissionWorktreeSummarySession[];
  activeSession?: MissionWorktreeSummarySession | null;
  currentGitBranch?: string | null;
  branchByCwd?: Record<string, string | undefined>;
  selectedCwd?: string | null;
}): MissionWorktreeSummaryItem[] {
  const sourceSessions = sessions.length ? sessions : activeSession ? [activeSession] : [];
  const byCwd = new Map<string, MissionWorktreeSummaryItem>();

  for (const session of sourceSessions) {
    if (!session.cwd) {
      continue;
    }
    const cwdKey = normalizeWorktreePath(session.cwd) ?? session.cwd;
    const activeCwd = selectedCwd
      ? normalizeWorktreePath(selectedCwd)
      : activeSession?.cwd
        ? normalizeWorktreePath(activeSession.cwd)
        : null;
    const projectName = session.projectName?.trim() || "未命名项目";
    const branchName =
      branchByCwd?.[cwdKey] ??
      (activeCwd && cwdKey === activeCwd ? currentGitBranch : null) ??
      session.worktreeName ??
      "未检测分支";
    const existing = byCwd.get(cwdKey);
    if (existing) {
      existing.sessionCount += 1;
      continue;
    }
    byCwd.set(cwdKey, {
      projectName,
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
  selectedCwd?: string | null,
  activeSessionCwd?: string | null,
): string {
  if (!selectedSessionWorktreeItems.length) {
    return `${worktreeCount} Worktrees`;
  }

  const targetCwd = normalizeWorktreePath(selectedCwd) ?? normalizeWorktreePath(activeSessionCwd);
  const selectedItem = targetCwd
    ? selectedSessionWorktreeItems.find(
        (item) => normalizeWorktreePath(item.cwd) === targetCwd,
      )
    : selectedSessionWorktreeItems[0];

  const primaryItem = selectedItem ?? selectedSessionWorktreeItems[0];
  if (!primaryItem) {
    return `${worktreeCount} Worktrees`;
  }
  return `${primaryItem.projectName} / ${primaryItem.branchName}`;
}
