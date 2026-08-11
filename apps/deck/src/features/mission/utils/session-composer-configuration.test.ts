import assert from "node:assert/strict";
import test from "node:test";
import type { SessionConfigOption, SessionSummary } from "@tiller/shared";
import { resolveSessionComposerConfiguration } from "./session-composer-configuration";

function session(
  id: string,
  agentId: string,
  model: string,
): SessionSummary {
  return {
    id,
    agentId,
    model,
    projectId: "project-1",
    projectName: "Project",
    helmId: "helm-1",
    cwd: "D:/workspace/project-1",
    worktreeName: "Worktree",
    agentName: agentId,
    status: "idle",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    messageCount: 0,
  };
}

function modelOptions(model: string): SessionConfigOption[] {
  return [{
    id: "model",
    category: "model",
    currentValue: model,
    options: [{ value: model, label: model }],
  }];
}

test("session composer configuration stays scoped to the requested session", () => {
  const claude = session("session-claude", "claude-code", "claude-sonnet-4");
  const codex = session("session-codex", "codex", "gpt-5.4");
  const opencode = session("session-opencode", "opencode", "openai/gpt-5.4-mini");
  const sessionConfigOptions = {
    [claude.id]: modelOptions("claude-sonnet-4"),
    [codex.id]: modelOptions("gpt-5.4"),
    [opencode.id]: modelOptions("openai/gpt-5.4-mini"),
  };

  const codexConfiguration = resolveSessionComposerConfiguration({
    session: codex,
    sessions: [claude, codex, opencode],
    sessionConfigOptions,
  });
  const opencodeConfiguration = resolveSessionComposerConfiguration({
    session: opencode,
    sessions: [claude, codex, opencode],
    sessionConfigOptions,
  });

  assert.deepEqual(codexConfiguration.draftConfigOptions, sessionConfigOptions[codex.id]);
  assert.equal(codexConfiguration.draftModelPickerLabel, "gpt-5.4");
  assert.equal(codexConfiguration.effectiveDraftModelBase, "gpt-5.4");
  assert.deepEqual(
    opencodeConfiguration.draftConfigOptions,
    sessionConfigOptions[opencode.id],
  );
  assert.equal(opencodeConfiguration.draftModelPickerLabel, "openai/gpt-5.4-mini");
  assert.equal(
    opencodeConfiguration.effectiveDraftModelBase,
    "openai/gpt-5.4-mini",
  );
});
