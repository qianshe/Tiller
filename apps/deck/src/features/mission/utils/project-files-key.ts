export function projectFilesKey(
  projectId: string | null | undefined,
  worktreeId: string | null | undefined,
) {
  return `${projectId ?? "none"}::${worktreeId ?? "none"}`;
}
