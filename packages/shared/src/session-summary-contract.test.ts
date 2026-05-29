import type { RuntimeSessionSummary, SessionSummary } from "./types";

const runtimeSummary = {
  id: "session-1",
  projectId: "project-1",
  projectName: "Project",
  helmId: "local",
  cwd: "D:/repo",
  worktreeName: "main",
  agentId: "codex",
  agentName: "Codex",
  agentMode: "build",
  model: "gpt-5.1-codex",
  modelOptions: [{ id: "gpt-5.1-codex", name: "GPT-5.1 Codex" }],
  configOptions: [{ id: "reasoning", selectedValue: "medium" }],
  reasoningEffort: "medium",
  status: "running",
  createdAt: "2026-05-29T00:00:00.000Z",
  updatedAt: "2026-05-29T00:00:01.000Z",
  messageCount: 1,
  runtimeSessionId: "runtime-1",
  title: "Architecture",
  lastMessagePreview: "hello",
  imageInput: true,
  availableCommands: [{ name: "test", kind: "command" }],
} satisfies RuntimeSessionSummary;

const legacySummary: SessionSummary = runtimeSummary;

void legacySummary;
