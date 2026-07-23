import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import { createRuntimeDraftRegistry } from "./draft-registry";

test("runtime draft reports ACP-confirmed config instead of requested values", async () => {
  let emitRuntimeEvent: ((event: SessionRuntimeEvent) => void) | undefined;
  const runtimeOptions = [
    {
      id: "model",
      category: "model",
      currentValue: "default",
      options: [
        { value: "default", label: "Default" },
        { value: "sonnet", label: "Sonnet" },
        { value: "opus", label: "Opus" },
      ],
    },
  ];
  const registry = createRuntimeDraftRegistry({
    providerLifecycle: {
      createRuntime: async (params: any) => {
        emitRuntimeEvent = params.onEvent;
        params.onEvent({
          type: "config-options",
          state: { model: "default" },
          options: runtimeOptions,
        });
        return {
          runtimeSessionId: "runtime-draft",
          sessionConfigState: { model: "default" },
          sessionConfigOptions: runtimeOptions,
          sessionModelState: {
            currentModelId: "default",
            options: runtimeOptions[0].options.map((option) => ({
              id: option.value,
              name: option.label,
            })),
          },
          attachTillerSession: () => undefined,
          configure: async () => ({
            runtimeApplied: true,
            state: { model: "sonnet" },
            modelState: {
              currentModelId: "sonnet",
              options: runtimeOptions[0].options.map((option) => ({
                id: option.value,
                name: option.label,
              })),
            },
            options: [{ ...runtimeOptions[0], currentValue: "sonnet" }],
          }),
        };
      },
      cleanupDraftRuntime: async () => ({ kind: "closed" }),
    },
    handleRuntimeEvent: () => undefined,
    logConnectionLifecycle: () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
  } as any);

  const created = await registry.createRuntimeDraft({
    deckClientId: "deck-1",
    project: { id: "project-1", name: "Tiller", helmId: "helm-1" },
    helm: { id: "helm-1", name: "Local" },
    worktree: { name: "main", path: "D:/repo" },
    agent: {
      id: "claude-code",
      name: "Claude Code",
      command: "claude-code",
      transport: "stdio",
      protocol: "acp",
    },
    sessionConfig: { model: "opus" },
  } as any);

  assert.equal(created.state.model, "default");

  const configured = await registry.configureRuntimeDraft({
    draftId: created.draftId,
    model: "opus",
  });
  assert.equal(configured.state.model, "sonnet");

  emitRuntimeEvent?.({
    type: "model-options",
    state: {
      currentModelId: "runtime-model",
      options: [{ id: "runtime-model", name: "Runtime Model" }],
    },
  });
  const reused = await registry.createRuntimeDraft({
    deckClientId: "deck-1",
    project: { id: "project-1", name: "Tiller", helmId: "helm-1" },
    helm: { id: "helm-1", name: "Local" },
    worktree: { name: "main", path: "D:/repo" },
    agent: {
      id: "claude-code",
      name: "Claude Code",
      command: "claude-code",
      transport: "stdio",
      protocol: "acp",
    },
  } as any);
  assert.equal(reused.state.model, "runtime-model");

  registry.takeRuntimeDraft(created.draftId);
});

test("concurrent callers receive one notification when shared draft creation fails", async () => {
  const notifications: Array<Record<string, unknown>> = [];
  let rejectRuntime: (error: Error) => void = () => undefined;
  const runtimeResult = new Promise<never>((_resolve, reject) => {
    rejectRuntime = reject;
  });
  const registry = createRuntimeDraftRegistry({
    providerLifecycle: {
      createRuntime: () => runtimeResult,
      cleanupDraftRuntime: async () => ({ kind: "closed" }),
    },
    handleRuntimeEvent: () => undefined,
    logConnectionLifecycle: () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
    notify: (notification: Record<string, unknown>) => {
      notifications.push(notification);
    },
  } as any);
  const params = {
    deckClientId: "deck-1",
    project: { id: "project-1", name: "Tiller", helmId: "helm-1" },
    helm: { id: "helm-1", name: "Local" },
    worktree: { name: "main", path: "D:/repo" },
    agent: {
      id: "claude-code",
      name: "Claude Code",
      command: "claude-code",
      transport: "stdio",
      protocol: "acp",
    },
  } as any;

  const first = registry.createRuntimeDraft(params);
  const second = registry.createRuntimeDraft(params);
  rejectRuntime(new Error("Claude startup failed"));

  await assert.rejects(first, /Claude startup failed/u);
  await assert.rejects(second, /Claude startup failed/u);
  assert.deepEqual(notifications, [{
    kind: "error",
    source: "session",
    code: "ACP_DRAFT_START_FAILED",
    message: "Claude startup failed",
  }]);
});
