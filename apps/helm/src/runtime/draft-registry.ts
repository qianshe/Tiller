import type {
  AcpAgentProvider,
  AcpModelState,
  AvailableCommand,
  HelmSummary,
  ProjectSummary,
  SessionConfigOptionValue,
  SessionReasoningEffort,
  WorktreeSummary,
} from "@tiller/shared";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import { performDraftRuntimeCleanup } from "./draft-lifecycle";
import type { ProviderLifecyclePort } from "./provider-lifecycle";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "./session-config-options";

const RUNTIME_DRAFT_TTL_MS = 3 * 60_000;

export type SessionRuntimeConfig = {
  agentMode?: string;
  model?: string;
  reasoningEffort?: SessionReasoningEffort;
};

export type RuntimeDraftReason = "scope-change" | "tab-disconnect" | "ttl" | "shutdown" | "user" | "obsolete";

// Owns draft runtime bookkeeping: per Deck client scope, pending draft creation,
// TTL/disconnect timers, and handoff from draft runtime to real session.
export type RuntimeDraft = {
  draftId: string;
  deckClientId: string;
  scopeKey: string;
  logicalScopeKey: string;
  project: ProjectSummary;
  helm: HelmSummary;
  worktree: WorktreeSummary;
  agent: AcpAgentProvider;
  runtime: Awaited<ReturnType<ProviderLifecyclePort["createRuntime"]>>;
  attach: (sessionId: string) => void;
  expiresTimer: ReturnType<typeof setTimeout>;
  createdAt: string;
  expiresAt: string;
  modelState?: AcpModelState;
  configState: Extract<SessionRuntimeEvent, { type: "config-options" }>["state"];
  configOptions: Extract<SessionRuntimeEvent, { type: "config-options" }>["options"];
  availableCommands: AvailableCommand[];
};

type PendingRuntimeDraft = {
  deckClientId: string;
  scopeKey: string;
  promise: Promise<RuntimeDraft>;
  obsolete: boolean;
};

type RuntimeDraftRegistryOptions = {
  providerLifecycle: ProviderLifecyclePort;
  handleRuntimeEvent(sessionId: string, event: SessionRuntimeEvent): void;
  logConnectionLifecycle(event: Parameters<ProviderLifecyclePort["createRuntime"]>[0] extends { onConnectionLifecycleEvent?: infer Handler }
    ? Handler extends (event: infer Event) => void
      ? Event
      : never
    : never): void;
  logInfo(message: string): void;
  logError(message: string): void;
};

export function createRuntimeDraftRegistry(options: RuntimeDraftRegistryOptions) {
  const runtimeDrafts = new Map<string, RuntimeDraft>();
  const runtimeDraftsById = new Map<string, RuntimeDraft>();
  const pendingRuntimeDrafts = new Map<string, PendingRuntimeDraft>();
  const deckDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function resolveRuntimeDraftKeys(params: {
    deckClientId: string;
    worktree: WorktreeSummary;
    agent: AcpAgentProvider;
  }) {
    const logicalScopeKey = `${params.worktree.path}:${params.agent.id}`;
    return {
      logicalScopeKey,
      scopeKey: `${params.deckClientId}:${logicalScopeKey}`,
    };
  }

  function runtimeDraftPayload(draft: RuntimeDraft, reused: boolean, message: string) {
    return {
      ok: true,
      draftId: draft.draftId,
      deckClientId: draft.deckClientId,
      projectId: draft.project.id,
      cwd: draft.worktree.path,
      providerId: draft.agent.id,
      scopeKey: draft.scopeKey,
      logicalScopeKey: draft.logicalScopeKey,
      runtimeSessionId: draft.runtime.runtimeSessionId,
      state: draft.configState,
      modelOptions: draft.modelState?.options ?? [],
      configOptions: draft.configOptions,
      availableCommands: draft.availableCommands,
      createdAt: draft.createdAt,
      expiresAt: draft.expiresAt,
      reused,
      message,
    };
  }

  async function cleanupDraftRuntime(draft: RuntimeDraft, reason: RuntimeDraftReason) {
    clearTimeout(draft.expiresTimer);
    runtimeDrafts.delete(draft.scopeKey);
    runtimeDraftsById.delete(draft.draftId);
    return performDraftRuntimeCleanup({
      draft,
      reason,
      activeDrafts: runtimeDraftsById.size,
      cleanupDraftRuntime: options.providerLifecycle.cleanupDraftRuntime,
      logInfo: options.logInfo,
    });
  }

  async function discardExistingDraftsForDeck(deckClientId: string, keepScopeKey?: string) {
    const staleDrafts = Array.from(runtimeDrafts.values()).filter(
      (draft) => draft.deckClientId === deckClientId && draft.scopeKey !== keepScopeKey,
    );
    await Promise.all(staleDrafts.map((draft) => cleanupDraftRuntime(draft, "scope-change")));
    for (const pending of pendingRuntimeDrafts.values()) {
      if (pending.deckClientId === deckClientId && pending.scopeKey !== keepScopeKey) {
        pending.obsolete = true;
      }
    }
  }

  async function createRuntimeDraft(params: {
    deckClientId: string;
    project: ProjectSummary;
    helm: HelmSummary;
    worktree: WorktreeSummary;
    agent: AcpAgentProvider;
    sessionConfig?: SessionRuntimeConfig;
  }) {
    const { scopeKey, logicalScopeKey } = resolveRuntimeDraftKeys(params);
    const reconnectTimer = deckDisconnectTimers.get(params.deckClientId);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      deckDisconnectTimers.delete(params.deckClientId);
    }
    await discardExistingDraftsForDeck(params.deckClientId, scopeKey);

    const existing = runtimeDrafts.get(scopeKey);
    if (existing) {
      options.logInfo(
        `[tiller] draft.reuse draft=${existing.draftId} deck=${params.deckClientId} scope=${scopeKey} runtime=${existing.runtime.runtimeSessionId} activeDrafts=${runtimeDraftsById.size}`,
      );
      return runtimeDraftPayload(existing, true, "ACP runtime draft is already ready.");
    }

    const pending = pendingRuntimeDrafts.get(scopeKey);
    if (pending) {
      const draft = await pending.promise;
      return runtimeDraftPayload(draft, true, "ACP runtime draft creation is already in progress.");
    }

    const draftId = `draft-${params.agent.id}-${Date.now()}`;
    let attachedSessionId: string | null = null;
    let modelState: AcpModelState | undefined;
    let configState: Extract<SessionRuntimeEvent, { type: "config-options" }>["state"] = {};
    let configOptions: Extract<SessionRuntimeEvent, { type: "config-options" }>["options"] = [];
    let availableCommands: AvailableCommand[] = [];
    let readyDraft: RuntimeDraft | undefined;
    options.logInfo(
      `[tiller] draft.create.start draft=${draftId} deck=${params.deckClientId} scope=${scopeKey} provider=${params.agent.id} cwd=${params.worktree.path}`,
    );

    const pendingDraft: PendingRuntimeDraft = {
      deckClientId: params.deckClientId,
      scopeKey,
      obsolete: false,
      promise: options.providerLifecycle.createRuntime({
        sessionId: draftId,
        worktree: params.worktree,
        agent: params.agent,
        sessionConfig: params.sessionConfig,
        onConnectionLifecycleEvent: options.logConnectionLifecycle,
        onEvent: (event) => {
          if (attachedSessionId) {
            options.handleRuntimeEvent(attachedSessionId, event);
            return;
          }
          if (event.type === "model-options") {
            modelState = event.state;
            if (readyDraft) {
              readyDraft.modelState = event.state;
            }
            return;
          }
          if (event.type === "config-options") {
            const previousState = readyDraft?.configState ?? configState;
            const nextModel = previousState.model ?? event.state.model;
            const resolvedConfigOptions = resolveConfigOptionsForSelection({
              incomingOptions: event.options,
              previousOptions: readyDraft?.configOptions ?? configOptions,
              selectedModel: nextModel,
            });
            const nextOptions = resolvedConfigOptions.options ?? [];
            const nextReasoning = resolveConfigReasoningEffortForOptions(
              previousState.reasoningEffort ?? event.state.reasoningEffort,
              resolvedConfigOptions,
            );
            configState = {
              ...event.state,
              model: nextModel,
              reasoningEffort: nextReasoning,
            };
            configOptions = nextOptions;
            if (readyDraft) {
              readyDraft.configState = configState;
              readyDraft.configOptions = configOptions;
            }
            return;
          }
          if (event.type === "available-commands") {
            availableCommands = event.commands;
            if (readyDraft) {
              readyDraft.availableCommands = event.commands;
            }
            return;
          }
          if (event.type === "error") {
            options.logError(
              `[tiller] draft.error draft=${draftId} provider=${params.agent.id} code=${event.code ?? "UNKNOWN"} message=${event.message}`,
            );
          }
        },
      }).then(async (runtime) => {
        const createdAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + RUNTIME_DRAFT_TTL_MS).toISOString();
        const expiresTimer = setTimeout(() => {
          const expired = runtimeDraftsById.get(draftId);
          if (expired) {
            void cleanupDraftRuntime(expired, "ttl");
          }
        }, RUNTIME_DRAFT_TTL_MS);
        expiresTimer.unref?.();
        const draft: RuntimeDraft = {
          draftId,
          deckClientId: params.deckClientId,
          scopeKey,
          logicalScopeKey,
          project: params.project,
          helm: params.helm,
          worktree: params.worktree,
          agent: params.agent,
          runtime,
          attach: (sessionId: string) => {
            runtime.attachTillerSession(sessionId);
            attachedSessionId = sessionId;
          },
          expiresTimer,
          createdAt,
          expiresAt,
          modelState: modelState ?? runtime.sessionModelState,
          configState: Object.keys(configState).length ? configState : runtime.sessionConfigState,
          configOptions: configOptions.length ? configOptions : runtime.sessionConfigOptions,
          availableCommands,
        };
        readyDraft = draft;
        if (pendingDraft.obsolete) {
          await cleanupDraftRuntime(draft, "obsolete");
          throw new Error("Draft became obsolete before creation completed.");
        }
        runtimeDrafts.set(scopeKey, draft);
        runtimeDraftsById.set(draftId, draft);
        options.logInfo(
          `[tiller] draft.create.done draft=${draftId} deck=${params.deckClientId} runtime=${runtime.runtimeSessionId} provider=${params.agent.id} activeDrafts=${runtimeDraftsById.size}`,
        );
        return draft;
      }),
    };
    pendingRuntimeDrafts.set(scopeKey, pendingDraft);

    try {
      const draft = await pendingDraft.promise;
      return runtimeDraftPayload(draft, false, "ACP runtime draft ready.");
    } catch (error) {
      options.logError(
        `[tiller] draft.create.failed draft=${draftId} deck=${params.deckClientId} provider=${params.agent.id} message=${error instanceof Error ? error.message : "Failed to create ACP draft."}`,
      );
      throw error;
    } finally {
      pendingRuntimeDrafts.delete(scopeKey);
    }
  }

  async function discardRuntimeDraft(params: {
    deckClientId: string;
    draftId?: string;
    scopeKey?: string;
    reason: RuntimeDraftReason;
  }) {
    const draft = params.draftId
      ? runtimeDraftsById.get(params.draftId)
      : params.scopeKey
        ? runtimeDrafts.get(params.scopeKey)
        : undefined;
    if (!params.draftId && !params.scopeKey) {
      await discardRuntimeDraftsForDeckClient(params.deckClientId, params.reason);
      return {
        ok: true,
        discarded: true,
        message: "Runtime drafts for deck client discarded.",
      };
    }
    if (!draft || draft.deckClientId !== params.deckClientId) {
      return {
        ok: true,
        discarded: false,
        draftId: params.draftId,
        message: "Runtime draft was not found or was already discarded.",
      };
    }
    const cleanup = await cleanupDraftRuntime(draft, params.reason);
    return {
      ok: true,
      discarded: true,
      draftId: draft.draftId,
      cleanup,
      message: "Runtime draft discarded.",
    };
  }

  async function discardRuntimeDraftsForDeckClient(deckClientId: string, reason: RuntimeDraftReason) {
    const drafts = Array.from(runtimeDrafts.values()).filter((draft) => draft.deckClientId === deckClientId);
    await Promise.all(drafts.map((draft) => cleanupDraftRuntime(draft, reason)));
    for (const pending of pendingRuntimeDrafts.values()) {
      if (pending.deckClientId === deckClientId) {
        pending.obsolete = true;
      }
    }
  }

  function scheduleDeckClientDraftDiscard(deckClientId: string, delayMs = 30_000) {
    const existing = deckDisconnectTimers.get(deckClientId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      void discardRuntimeDraftsForDeckClient(deckClientId, "tab-disconnect");
      deckDisconnectTimers.delete(deckClientId);
    }, delayMs);
    timer.unref?.();
    deckDisconnectTimers.set(deckClientId, timer);
  }

  function takeRuntimeDraft(draftId: string) {
    const draft = runtimeDraftsById.get(draftId);
    if (!draft) {
      return undefined;
    }
    clearTimeout(draft.expiresTimer);
    runtimeDrafts.delete(draft.scopeKey);
    runtimeDraftsById.delete(draft.draftId);
    options.logInfo(
      `[tiller] draft.take draft=${draft.draftId} deck=${draft.deckClientId} runtime=${draft.runtime.runtimeSessionId} provider=${draft.agent.id} activeDrafts=${runtimeDraftsById.size}`,
    );
    return draft;
  }

  async function configureRuntimeDraft(params: {
    draftId: string;
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
    configId?: string;
    value?: SessionConfigOptionValue;
  }) {
    const draft = runtimeDraftsById.get(params.draftId);
    if (!draft) {
      throw new Error("Runtime draft not found");
    }
    const result = await draft.runtime.configure({
      agentMode: params.agentMode,
      model: params.model,
      reasoningEffort: params.reasoningEffort,
      configId: params.configId,
      value: params.value,
    });
    const nextModel = params.model ?? draft.configState.model ?? result.state.model;
    const resolvedConfigOptions = resolveConfigOptionsForSelection({
      incomingOptions: result.options ?? draft.runtime.sessionConfigOptions,
      previousOptions: draft.configOptions,
      selectedModel: nextModel,
    });
    const nextConfigOptions = resolvedConfigOptions.options ?? [];
    const nextReasoning = resolveConfigReasoningEffortForOptions(
      params.reasoningEffort ?? result.state.reasoningEffort ?? draft.configState.reasoningEffort,
      resolvedConfigOptions,
    );
    draft.configState = {
      ...draft.configState,
      ...result.state,
      agentMode: params.agentMode ?? result.state.agentMode ?? draft.configState.agentMode,
      model: nextModel,
      reasoningEffort: nextReasoning,
    };
    draft.modelState = result.modelState ?? draft.modelState;
    draft.configOptions = nextConfigOptions;
    options.logInfo(
      `[tiller] draft.configure draft=${draft.draftId} model=${result.state.model ?? "<none>"} mode=${result.state.agentMode ?? "<none>"}`,
    );
    return {
      draftId: draft.draftId,
      ok: true,
      state: draft.configState,
      options: draft.configOptions,
      message: result.runtimeApplied ? "Runtime draft config updated." : "Runtime draft config saved.",
    };
  }

  return {
    configureRuntimeDraft,
    createRuntimeDraft,
    discardRuntimeDraft,
    discardRuntimeDraftsForDeckClient,
    scheduleDeckClientDraftDiscard,
    takeRuntimeDraft,
  };
}
