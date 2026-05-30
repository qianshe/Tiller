import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import type { SessionRuntimeEvent } from "../runtime-types";
import { resolveContainedWorktreePath, sliceTextFileContent } from "../terminal-client";

type ConnectionFileSession = {
  worktree: { path: string };
  onEvent: (event: SessionRuntimeEvent) => void;
};

type ReadConnectionTextFileParams = {
  session: ConnectionFileSession;
  path: string;
  line?: number;
  limit?: number;
};

type WriteConnectionTextFileParams = {
  sessionId: string;
  session: ConnectionFileSession;
  path: string;
  content: string;
  requestPermission: (sessionId: string, command: string, reason: string) => Promise<boolean>;
};

export async function readConnectionTextFile({
  session,
  path,
  line,
  limit,
}: ReadConnectionTextFileParams): Promise<{ content: string }> {
  const filePath = resolveContainedWorktreePath(session.worktree.path, path);
  const content = await readFile(filePath, "utf8");
  return { content: sliceTextFileContent(content, line, limit) };
}

export async function writeConnectionTextFile({
  sessionId,
  session,
  path,
  content,
  requestPermission,
}: WriteConnectionTextFileParams): Promise<Record<string, never>> {
  const cwd = session.worktree.path;
  const filePath = resolveContainedWorktreePath(cwd, path);
  const relativePath = relative(cwd, filePath) || path;
  const allowed = await requestPermission(
    sessionId,
    `Write file: ${relativePath}`,
    "ACP agent requested worktree file write access.",
  );
  if (!allowed) {
    throw new Error(`Denied ACP file write: ${relativePath}`);
  }

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");

  const now = new Date().toISOString();
  session.onEvent({
    type: "tool-call",
    toolCall: {
      id: `fs-write-${Date.now()}`,
      kind: "write",
      title: `Write file: ${relativePath}`,
      status: "completed",
      input: path,
      output: `${String(content).length} chars written`,
      timestamp: now,
      updatedAt: now,
    },
  });

  return {};
}
