import {
  createAcpRuntime,
  loadAdapterAuthoritativeHistory,
  type AcpConnectionLifecycleEvent,
  type SessionRuntimeEvent,
} from "@tiller/acp-runtime";
import { resolveProviderById } from "@tiller/agent-registry";
import type {
  AcpAgentProvider,
  AcpModelState,
  AgentMessage,
  AvailableCommand,
  AgentPromptContent,
  FileDiffSummary,
  HelmSummary,
  PermissionRequest,
  SessionReasoningEffort,
  SessionResumeInfo,
  SessionSummary,
  WorktreeSummary,
  SessionConfigOptionValue,
} from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import {
  alignSessionProjectBinding,
  alignSessionWorktreeBinding,
  createHelmSessionStores,
  normalizeDiffPath,
  readWorktreeGitDiffs,
  type StoredSessionRuntimeDescriptor,
} from "../sessions/facade";
import {
  planProviderHistorySync,
  shouldRepairProviderHistorySnapshot,
  toParagraphMessages,
} from "../sessions/provider-history-sync.js";
import { broadcastSessionUpdate } from "../rpc/notifications";
import { cleanupDraftProviderRuntime } from "../providers/draft-cleanup";
import { summarizeLargeDiffs } from "./diff-limits";
import { handleRuntimeEvent as dispatchRuntimeEvent } from "./events";
import {
  buildSessionResumeInfo,
  markSessionResumeUnavailable,
  resolveSessionRestoreCapabilities,
} from "./resume-info";
import {
  resolveProviderHistorySnapshot,
  type ProviderHistorySnapshot,
  type ProviderHistorySnapshotContent,
} from "./provider-history-source";
import { createRestoreReplayBuffer } from "./replay-event-buffer";

type HelmSessionStores = ReturnType<typeof createHelmSessionStores>;

type SessionRuntimeConfig = {
  agentMode?: string;
  model?: string;
  reasoningEffort?: SessionReasoningEffort;
};

type ResumePreconditionInput = {
  agent: AcpAgentProvider | undefined;
  worktree: WorktreeSummary | undefined;
  runtimeSessionId?: string;
  restoreMethod?: SessionResumeInfo["restoreMethod"];
  agentId: string;
  cwd?: string;
};

function resolveResumeUnavailableReason({
  agent,
  worktree,
  runtimeSessionId,
  restoreMethod,
  agentId,
  cwd,
}: ResumePreconditionInput): string | null {
  if (!agent) {
    return `Agent provider ${agentId} is not configured.`;
  }
  if (!worktree) {
    return cwd
      ? `Worktree path ${cwd} is not configured or does not exist.`
      : "Worktree cwd is not configured.";
  }
  if (!runtimeSessionId) {
    return "ACP runtime session id is missing.";
  }
  if (restoreMethod !== "session/load" && restoreMethod !== "session/resume") {
    return `ACP restore method ${restoreMethod ?? "none"} is unsupported.`;
  }
  return null;
}

export type SessionRecord = {
  summary: SessionSummary;
  agent: AcpAgentProvider;
  worktree: WorktreeSummary;
  runtime: Awaited<ReturnType<typeof createAcpRuntime>>;
};

type SessionServicesOptions = {
  sessions: Map<string, SessionRecord>;
  permissionIndex: Map<string, { sessionId: string; request: PermissionRequest }>;
  sessionStore: HelmSessionStores["sessionStore"];
  sessionMessageStore: HelmSessionStores["sessionMessageStore"];
  sessionArtifactStore: HelmSessionStores["sessionArtifactStore"];
  sessionRuntimeStore: HelmSessionStores["sessionRuntimeStore"];
  getAgents: () => AcpAgentProvider[];
  getProjects: () => ProjectSummary[];
  getWorktrees: () => WorktreeSummary[];
  createHandlerContext: () => HelmHandlerContext;
  broadcastNotification: (method: string, params: unknown) => void;
  logInfo: (message: string) => void;
  logError: (message: string) => void;
};

type ProjectSummary = import("@tiller/shared").ProjectSummary;

type RuntimeDraftReason = "scope-change" | "tab-disconnect" | "ttl" | "shutdown" | "user" | "obsolete";

type RuntimeDraft = {
  draftId: string;
  deckClientId: string;
  scopeKey: string;
  logicalScopeKey: string;
  project: ProjectSummary;
  helm: HelmSummary;
  worktree: WorktreeSummary;
  agent: AcpAgentProvider;
  runtime: SessionRecord["runtime"];
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
  obsolete: boolean;
  promise: Promise<RuntimeDraft>;
};

const RUNTIME_DRAFT_TTL_MS = 10 * 60_000;

export function createSessionServices(options: SessionServicesOptions) {
  const providerHistoryRefreshes = new Map<string, number>();

  function resolveStoredSessionWorktree(summary: SessionSummary) {
    const worktrees = options.getWorktrees();
    const normalizedSummaryPath = normalizeWorktreePath(summary.cwd);
    const pathWorktree = normalizedSummaryPath
      ? worktrees.find((item) => normalizeWorktreePath(item.path) === normalizedSummaryPath)
      : undefined;
    if (pathWorktree) {
      return { ...pathWorktree, path: summary.cwd ?? pathWorktree.path };
    }

    const project = options.getProjects().find((item) => item.id === summary.projectId);
    if (project?.path) {
      return {
        name: summary.worktreeName || project.name,
        path: summary.cwd || project.path,
      } satisfies WorktreeSummary;
    }

    return undefined;
  }

  function normalizeWorktreePath(path: string | undefined) {
    return path?.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
  }

  function logConnectionLifecycle(event: AcpConnectionLifecycleEvent) {
    const phaseMap: Record<AcpConnectionLifecycleEvent["type"], string> = {
      "connection-open": "ACP连接新建",
      "connection-reuse": "ACP连接复用",
      "connection-pending": "ACP连接等待",
      "connection-replace": "ACP连接替换",
      "connection-reconnect": "ACP连接重连",
    };
    options.logInfo(
      `[tiller] 阶段=${phaseMap[event.type]} provider=${event.providerId} key=${event.key} session=${event.sessionId ?? "<none>"} cwd=${event.cwd}`,
    );
  }

  const runtimeDrafts = new Map<string, RuntimeDraft>();
  const runtimeDraftsById = new Map<string, RuntimeDraft>();
  const pendingRuntimeDrafts = new Map<string, PendingRuntimeDraft>();
  const deckDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function handleRuntimeEvent(sessionId: string, event: SessionRuntimeEvent) {
    dispatchRuntimeEvent(sessionId, event, options.createHandlerContext());
  }

  function clearPermissionRequestsForSession(sessionId: string) {
    for (const [requestId, permission] of options.permissionIndex.entries()) {
      if (permission.sessionId === sessionId) {
        options.permissionIndex.delete(requestId);
      }
    }
  }

  function deleteLocalSessionData(sessionId: string) {
    options.sessionStore.remove(sessionId);
    options.sessionMessageStore.remove(sessionId);
    options.sessionArtifactStore.remove(sessionId);
    options.sessionRuntimeStore.remove(sessionId);
  }

  function persistSessionMessage(sessionId: string, message: AgentMessage) {
    options.sessionMessageStore.append(sessionId, message);
  }

  function updateSessionSummary(
    sessionId: string,
    mutate: (summary: SessionSummary) => SessionSummary,
  ) {
    const activeSummary = options.sessions.get(sessionId)?.summary;
    const persistedSummary = options.sessionStore.list().find((item) => item.id === sessionId);
    const base = activeSummary ?? persistedSummary;
    if (!base) {
      return undefined;
    }

    const next = hydrateSessionSummary(mutate(base));
    const record = options.sessions.get(sessionId);
    if (record) {
      record.summary = next;
    }
    options.sessionStore.upsert(next);
    persistRuntimeDescriptor(
      next,
      record?.agent ?? resolveProviderById(next.agentId, options.getAgents()),
      record?.runtime.sessionCapabilities,
    );
    return next;
  }

  function hydrateSessionSummary(summary: SessionSummary): SessionSummary {
    const aligned = alignSessionWorktreeBinding(
      alignSessionProjectBinding(summary, options.getProjects()),
      options.getWorktrees(),
    );
    const record = options.sessions.get(summary.id);
    const agent = record?.agent ?? resolveProviderById(aligned.agentId, options.getAgents());
    const descriptor = options.sessionRuntimeStore.get(summary.id);
    const capabilities = resolveSessionRestoreCapabilities(
      agent,
      descriptor,
      record?.runtime.sessionCapabilities,
    );
    return {
      ...aligned,
      configOptions: record?.runtime.sessionConfigOptions ?? aligned.configOptions,
      imageInput: capabilities.imageInput,
      resume: buildResumeInfo(aligned, agent),
    };
  }

  function migrateStoredSessionSummary(summary: SessionSummary) {
    const hydrated = hydrateSessionSummary(summary);
    if (
      hydrated.projectId !== summary.projectId ||
      hydrated.projectName !== summary.projectName ||
      hydrated.helmId !== summary.helmId ||
      hydrated.cwd !== summary.cwd ||
      hydrated.worktreeName !== summary.worktreeName ||
      hydrated.cwd !== summary.cwd
    ) {
      options.sessionStore.upsert(hydrated);
    }
    return hydrated;
  }

  function buildResumeInfo(
    summary: SessionSummary,
    agent: AcpAgentProvider | undefined,
  ): SessionResumeInfo {
    return buildSessionResumeInfo(
      summary,
      agent,
      options.sessions.get(summary.id),
      options.sessionRuntimeStore.get(summary.id),
    );
  }

  async function importAuthoritativeProviderHistory(
    sessionId: string,
    agent: AcpAgentProvider,
    runtimeSessionId: string,
    cwd: string,
  ) {
    try {
      const historySnapshot = await resolveProviderHistorySnapshot([
        {
          source: "adapter-authoritative-history",
          load: () => loadAdapterHistoryContent(agent, runtimeSessionId, cwd),
        },
      ]);
      if (!historySnapshot) {
        return false;
      }
      applyAuthoritativeProviderHistory(sessionId, agent, runtimeSessionId, historySnapshot);
      return true;
    } catch (error) {
      options.logError(
        `[tiller] provider.export.history failed session=${sessionId}: ${error instanceof Error ? error.message : "Provider history export failed."}`,
      );
      return false;
    }
  }

  async function loadAdapterHistoryContent(
    agent: AcpAgentProvider,
    runtimeSessionId: string,
    cwd: string,
  ): Promise<ProviderHistorySnapshotContent | null> {
    const history = await loadAdapterAuthoritativeHistory(agent, runtimeSessionId, cwd);
    if (!history) {
      return null;
    }
    return {
      messages: history.messages,
      toolCalls: history.toolCalls,
      outputs: [],
      diffs: [],
    };
  }

  function applyAuthoritativeProviderHistory(
    sessionId: string,
    agent: AcpAgentProvider,
    runtimeSessionId: string,
    history: ProviderHistorySnapshot,
  ) {
    if (!history.messages.length) {
      if (history.toolCalls.length) {
        options.sessionArtifactStore.replaceToolCalls(sessionId, history.toolCalls);
      }
      options.logInfo(
        `[tiller] provider.export.history session=${sessionId} runtime=${runtimeSessionId} action=skip_empty providerMessages=0 localMessages=0 toolCalls=${history.toolCalls.length}`,
      );
      return;
    }

    const descriptor = options.sessionRuntimeStore.get(sessionId);
    const syncDecision = planProviderHistorySync({
      currentState: descriptor?.providerHistory,
      providerMessages: history.messages,
      syncedAt: history.syncedAt,
    });

    let localMessageCount = syncDecision.action === "skip" ? 0 : syncDecision.messages.length;
    let logAction: "append" | "repair" | "replace" | "skip" = syncDecision.action;
    if (syncDecision.action === "replace") {
      if (syncDecision.messages.length) {
        options.sessionMessageStore.replace(sessionId, syncDecision.messages);
      }
    } else if (syncDecision.action === "append") {
      for (const message of syncDecision.messages) {
        options.sessionMessageStore.append(sessionId, message);
      }
    } else {
      const localMessages = options.sessionMessageStore.list(sessionId);
      if (shouldRepairProviderHistorySnapshot(localMessages, history.messages)) {
        const repairedMessages = toParagraphMessages(history.messages);
        options.sessionMessageStore.replace(sessionId, repairedMessages);
        localMessageCount = repairedMessages.length;
        logAction = "repair";
      }
    }

    persistProviderHistoryState(sessionId, agent, runtimeSessionId, syncDecision.nextState);
    if (history.toolCalls.length) {
      options.sessionArtifactStore.replaceToolCalls(sessionId, history.toolCalls);
    }
    options.logInfo(
      `[tiller] provider.export.history session=${sessionId} runtime=${runtimeSessionId} action=${logAction} providerMessages=${history.messages.length} localMessages=${localMessageCount} toolCalls=${history.toolCalls.length}`,
    );
  }

  function hasHistoryContent(history: ProviderHistorySnapshotContent) {
    return Boolean(
      history.messages.length || history.toolCalls.length || history.outputs.length || history.diffs.length,
    );
  }

  function readLocalProviderHistory(sessionId: string): ProviderHistorySnapshotContent {
    const artifacts = options.sessionArtifactStore.get(sessionId);
    return {
      messages: options.sessionMessageStore.list(sessionId),
      toolCalls: artifacts.toolCalls,
      outputs: artifacts.outputs,
      diffs: artifacts.diffs,
    };
  }

  function persistProviderHistoryState(
    sessionId: string,
    agent: AcpAgentProvider,
    runtimeSessionId: string,
    providerHistory: StoredSessionRuntimeDescriptor["providerHistory"],
  ) {
    if (!providerHistory) {
      return;
    }

    const descriptor = options.sessionRuntimeStore.get(sessionId);
    if (descriptor) {
      options.sessionRuntimeStore.upsert({
        ...descriptor,
        providerHistory,
        lastSeenAt: providerHistory.syncedAt,
      });
      return;
    }

    const summary =
      options.sessions.get(sessionId)?.summary ??
      options.sessionStore.list().find((item) => item.id === sessionId);
    if (!summary) {
      return;
    }

    options.sessionRuntimeStore.upsert({
      sessionId,
      projectId: summary.projectId,
      helmId: summary.helmId,
      providerId: summary.agentId,
      runtimeSessionId,
      capabilities: resolveSessionRestoreCapabilities(agent, null),
      providerHistory,
      lastSeenAt: providerHistory.syncedAt,
      state: summary.status === "error" || summary.status === "cancelled" ? "stale" : "resumeable",
    });
  }

  async function refreshAuthoritativeSessionHistory(sessionId: string) {
    const lastRefresh = providerHistoryRefreshes.get(sessionId);
    if (lastRefresh && Date.now() - lastRefresh < 30_000) {
      return;
    }

    const activeRecord = options.sessions.get(sessionId);
    const summary =
      activeRecord?.summary ?? options.sessionStore.list().find((item) => item.id === sessionId);
    if (!summary) {
      return;
    }
    const agent = activeRecord?.agent ?? resolveProviderById(summary.agentId, options.getAgents());
    const worktree =
      activeRecord?.worktree ?? options.getWorktrees().find((item) => normalizeWorktreePath(item.path) === normalizeWorktreePath(summary.cwd));
    const runtimeSessionId =
      activeRecord?.runtime.runtimeSessionId ??
      summary.runtimeSessionId ??
      options.sessionRuntimeStore.get(sessionId)?.runtimeSessionId;
    if (!agent || !worktree || !runtimeSessionId) {
      return;
    }

    const refreshed = await importAuthoritativeProviderHistory(
      sessionId,
      agent,
      runtimeSessionId,
      worktree.path,
    );
    if (refreshed) {
      providerHistoryRefreshes.set(sessionId, Date.now());
    }
  }

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
    const cleanup = await cleanupDraftProviderRuntime(draft.runtime, draft.agent);
    options.logInfo(
      `[tiller] draft.discard draft=${draft.draftId} deck=${draft.deckClientId} reason=${reason} runtime=${draft.runtime.runtimeSessionId} provider=${draft.agent.id} cleanup=${cleanup.kind} activeDrafts=${runtimeDraftsById.size}`,
    );
    return cleanup;
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
    options.logInfo(
      `[tiller] draft.create.start draft=${draftId} deck=${params.deckClientId} scope=${scopeKey} provider=${params.agent.id} cwd=${params.worktree.path}`,
    );

    const pendingDraft: PendingRuntimeDraft = {
      deckClientId: params.deckClientId,
      scopeKey,
      obsolete: false,
      promise: createAcpRuntime({
        sessionId: draftId,
        worktree: params.worktree,
        agent: params.agent,
        sessionConfig: params.sessionConfig,
        onConnectionLifecycleEvent: logConnectionLifecycle,
        onEvent: (event) => {
          if (attachedSessionId) {
            handleRuntimeEvent(attachedSessionId, event);
            return;
          }
          if (event.type === "model-options") {
            modelState = event.state;
            return;
          }
          if (event.type === "config-options") {
            configState = event.state;
            configOptions = event.options;
            return;
          }
          if (event.type === "available-commands") {
            availableCommands = event.commands;
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
    draft.configState = result.state;
    draft.modelState = result.modelState ?? draft.modelState;
    draft.configOptions = result.options ?? draft.runtime.sessionConfigOptions ?? draft.configOptions;
    options.logInfo(
      `[tiller] draft.configure draft=${draft.draftId} model=${result.state.model ?? "<none>"} mode=${result.state.agentMode ?? "<none>"}`,
    );
    return {
      draftId: draft.draftId,
      ok: true,
      state: result.state,
      options: draft.configOptions,
      message: result.runtimeApplied ? "Runtime draft config updated." : "Runtime draft config saved.",
    };
  }

  async function startSessionResume(sessionId: string) {
    const activeRecord = options.sessions.get(sessionId);
    if (activeRecord) {
      await refreshAuthoritativeSessionHistory(sessionId);
      const resume = buildResumeInfo(activeRecord.summary, activeRecord.agent);
      options.logInfo(
        `[tiller] client reconnect session=${sessionId} runtime=${resume.runtimeSessionId ?? "unknown"}`,
      );
      return {
        ok: true,
        resume,
        message: "Client reconnected to the still-running Helm session; no ACP restore was needed.",
      };
    }

    const summary = options.sessionStore.list().find((item) => item.id === sessionId);
    if (!summary) {
      const now = new Date().toISOString();
      return {
        ok: false,
        resume: {
          mode: "none" as const,
          state: "resume-unavailable" as const,
          reason: "Session not found.",
          checkedAt: now,
        },
        message: "Session not found.",
      };
    }

    const agent = resolveProviderById(summary.agentId, options.getAgents());
    const worktree = resolveStoredSessionWorktree(summary);
    const resume = buildResumeInfo(summary, agent);
    const unavailableReason = resolveResumeUnavailableReason({
      agent,
      worktree,
      runtimeSessionId: resume.runtimeSessionId,
      restoreMethod: resume.restoreMethod,
      agentId: summary.agentId,
      cwd: summary.cwd ?? options.getProjects().find((item) => item.id === summary.projectId)?.path,
    });
    if (unavailableReason) {
      return {
        ok: false,
        resume: markSessionResumeUnavailable(resume, unavailableReason),
        message: unavailableReason,
      };
    }
    const restoreAgent = agent as AcpAgentProvider;
    const restoreWorktree = worktree as WorktreeSummary;
    const restoreRuntimeSessionId = resume.runtimeSessionId as string;
    const restoreMethod = resume.restoreMethod as "session/load" | "session/resume";

    try {
      options.logInfo(
        `[tiller] 阶段=恢复旧会话开始 session=${sessionId} runtime=${restoreRuntimeSessionId} method=${restoreMethod}`,
      );
      // ACP transcript is provider-owned. Helm stores metadata and a disposable view cache.
      // Restore replay is cache repair only; live events still use handleRuntimeEvent.
      const restoreReplayBuffer = createRestoreReplayBuffer(
        sessionId,
        options.createHandlerContext(),
      );
      options.logInfo(
        `[tiller] 阶段=恢复重放缓存打开 session=${sessionId}`,
      );
      const runtime = await createAcpRuntime({
        sessionId,
        worktree: restoreWorktree,
        agent: restoreAgent,
        sessionConfig: {
          model: summary.model,
          reasoningEffort: summary.reasoningEffort,
        },
        restore: {
          runtimeSessionId: restoreRuntimeSessionId,
          strategy: restoreMethod === "session/load" ? "load" : "resume",
          replayBaselineMessages: options.sessionMessageStore.list(sessionId),
        },
        onEvent: (event) => handleRuntimeEvent(sessionId, event),
        onRestoreReplayEvent: (event) => {
          restoreReplayBuffer.add(event);
        },
        onConnectionLifecycleEvent: logConnectionLifecycle,
      });
      const replaySnapshot = restoreReplayBuffer.snapshot();
      const replayCounts = restoreReplayBuffer.flush();
      options.logInfo(
        `[tiller] 阶段=恢复重放缓存完成 session=${sessionId} messages=${replayCounts.messages} toolCalls=${replayCounts.toolCalls} outputs=${replayCounts.outputs} diffs=${replayCounts.diffs}`,
      );
      const historySnapshot = await resolveProviderHistorySnapshot([
        {
          source: "acp-session-load",
          load: async () => (hasHistoryContent(replaySnapshot) ? replaySnapshot : null),
        },
        {
          source: "adapter-authoritative-history",
          load: async () => {
            try {
              return await loadAdapterHistoryContent(restoreAgent, restoreRuntimeSessionId, restoreWorktree.path);
            } catch (error) {
              options.logError(
                `[tiller] provider.export.history failed session=${sessionId}: ${error instanceof Error ? error.message : "Provider history export failed."}`,
              );
              return null;
            }
          },
        },
        {
          source: "local-cache",
          load: async () => readLocalProviderHistory(sessionId),
        },
      ]);
      if (historySnapshot?.source === "acp-session-load") {
        options.logInfo(
          `[tiller] history.cache source=acp-session-load session=${sessionId} messages=${historySnapshot.messages.length} toolCalls=${historySnapshot.toolCalls.length} outputs=${historySnapshot.outputs.length} diffs=${historySnapshot.diffs.length}`,
        );
      } else if (historySnapshot?.source === "adapter-authoritative-history") {
        applyAuthoritativeProviderHistory(sessionId, restoreAgent, restoreRuntimeSessionId, historySnapshot);
      }
      const restoredSummary = hydrateSessionSummary({
        ...summary,
        model: runtime.sessionConfigState?.model ?? summary.model,
        modelOptions: runtime.sessionModelState?.options ?? summary.modelOptions,
        configOptions: runtime.sessionConfigOptions ?? summary.configOptions,
        reasoningEffort: runtime.sessionConfigState?.reasoningEffort ?? summary.reasoningEffort,
        runtimeSessionId: runtime.runtimeSessionId,
        status: "idle",
        updatedAt: new Date().toISOString(),
      });
      options.sessions.set(sessionId, { summary: restoredSummary, agent: restoreAgent, worktree: restoreWorktree, runtime });
      options.sessionStore.upsert(restoredSummary);
      persistRuntimeDescriptor(restoredSummary, restoreAgent, runtime.sessionCapabilities);
      options.logInfo(
        `[tiller] 阶段=恢复旧会话完成 session=${sessionId} runtime=${runtime.runtimeSessionId} method=${restoreMethod}`,
      );
      return {
        ok: true,
        resume: buildResumeInfo(restoredSummary, restoreAgent),
        message: `ACP ${restoreMethod} completed for this session.`,
      };
    } catch (error) {
      options.logError(
        `[tiller] 阶段=恢复旧会话失败 session=${sessionId} message=${error instanceof Error ? error.message : "ACP restore failed."}`,
      );
      return {
        ok: false,
        resume: {
          ...resume,
          state: "resume-unavailable" as const,
          reason: error instanceof Error ? error.message : "ACP restore failed.",
          checkedAt: new Date().toISOString(),
        },
        message: error instanceof Error ? error.message : "ACP restore failed.",
      };
    }
  }

  function persistRuntimeDescriptor(
    summary: SessionSummary,
    agent: AcpAgentProvider | undefined,
    capabilities?: StoredSessionRuntimeDescriptor["capabilities"],
  ) {
    const existingDescriptor = options.sessionRuntimeStore.get(summary.id);
    const resolvedCapabilities = resolveSessionRestoreCapabilities(
      agent,
      existingDescriptor,
      capabilities,
    );
    if (
      !summary.runtimeSessionId &&
      !resolvedCapabilities.sessionLoad &&
      !resolvedCapabilities.sessionResume &&
      !resolvedCapabilities.sessionList &&
      !resolvedCapabilities.sessionClose &&
      !resolvedCapabilities.sessionDelete &&
      !resolvedCapabilities.imageInput
    ) {
      return;
    }

    options.sessionRuntimeStore.upsert({
      sessionId: summary.id,
      projectId: summary.projectId,
      helmId: summary.helmId,
      providerId: summary.agentId,
      runtimeSessionId: summary.runtimeSessionId,
      capabilities: resolvedCapabilities,
      providerHistory: existingDescriptor?.providerHistory,
      lastSeenAt: summary.updatedAt,
      state: summary.status === "error" || summary.status === "cancelled" ? "stale" : "resumeable",
    });
  }

  async function publishDiffUpdate(sessionId: string, files: FileDiffSummary[]) {
    const diffs = summarizeLargeDiffs(await hydrateDiffsFromWorktreeGit(sessionId, files));
    options.sessionArtifactStore.replaceDiffs(sessionId, diffs);
    broadcastSessionUpdate(options.createHandlerContext(), sessionId, {
      kind: "diff_update",
      files: diffs,
    });
  }

  async function hydrateDiffsFromWorktreeGit(sessionId: string, files: FileDiffSummary[]) {
    const worktree = resolveSessionWorktree(sessionId);
    if (!worktree) {
      return files;
    }

    const gitDiffs = await readWorktreeGitDiffs(worktree.path);
    if (!gitDiffs.length) {
      return files;
    }

    if (!files.length) {
      return gitDiffs;
    }

    const gitByPath = new Map(gitDiffs.map((file) => [normalizeDiffPath(file.path), file]));
    return files.map((file) => {
      const fromGit = gitByPath.get(normalizeDiffPath(file.path));
      return fromGit
        ? {
            ...file,
            additions: fromGit.additions,
            deletions: fromGit.deletions,
            patch: file.patch ?? fromGit.patch,
          }
        : file;
    });
  }

  function resolveSessionWorktree(sessionId: string) {
    const liveWorktree = options.sessions.get(sessionId)?.worktree;
    if (liveWorktree) {
      return liveWorktree;
    }

    const summary = options.sessionStore.list().find((item) => item.id === sessionId);
    return summary
      ? (options.getWorktrees().find((worktree) => normalizeWorktreePath(worktree.path) === normalizeWorktreePath(summary.cwd)) ?? null)
      : null;
  }

  return {
    buildResumeInfo,
    clearPermissionRequestsForSession,
    deleteLocalSessionData,
    handleRuntimeEvent,
    hydrateDiffsFromWorktreeGit,
    hydrateSessionSummary,
    migrateStoredSessionSummary,
    configureRuntimeDraft,
    createRuntimeDraft,
    discardRuntimeDraft,
    discardRuntimeDraftsForDeckClient,
    persistRuntimeDescriptor,
    persistSessionMessage,
    publishDiffUpdate,
    refreshAuthoritativeSessionHistory,
    scheduleDeckClientDraftDiscard,
    startSessionResume,
    takeRuntimeDraft,
    updateSessionSummary,
  };
}
