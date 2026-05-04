export function projectFilesKey(
  projectId: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return `${projectId ?? "none"}::${workspaceId ?? "none"}`;
}
