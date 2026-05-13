import { basename, dirname, resolve } from "node:path";
import {
  listAvailableHelms as listConfiguredHelms,
  listAvailableProjects as listConfiguredProjects,
  listAvailableProviders,
  loadTillerConfigStub,
  readTillerConfig,
  saveProjectToConfig,
  ensureTillerConfigDefaults,
} from "@tiller/agent-registry";
import type {
  AcpAgentProvider,
  AcpModelState,
  AgentPromptContent,
  HelmSummary,
  PermissionRequest,
  ProjectSummary,
  SessionReasoningEffort,
  SessionSummary,
  WorktreeSummary,
} from "@tiller/shared";
import { resolveTillerRuntimeOptions, type TillerRuntimeOptions } from "../runtime/options";
import {
  createHelmSessionStores,
  resolveSessionStoreBackend,
  type HelmSessionStores,
  type StoredSessionRuntimeDescriptor,
} from "../sessions/facade";
import { createTrustedDeviceStore } from "../auth/beacon-store";
import type { TillerLogger } from "../logging/logger";

type TillerConfigStub = ReturnType<typeof loadTillerConfigStub>;
type TrustedDeviceStore = ReturnType<typeof createTrustedDeviceStore>;

export type SessionRecord = {
  summary: SessionSummary;
  agent: AcpAgentProvider;
  worktree: WorktreeSummary;
  runtime: {
    runtimeSessionId: string;
    sessionCapabilities?: StoredSessionRuntimeDescriptor["capabilities"];
    sessionConfigState?: {
      model?: string;
      reasoningEffort?: SessionReasoningEffort;
    };
    sessionModelState?: AcpModelState;
    prompt: (text: string, content?: AgentPromptContent[]) => void;
    configure: (next: { model?: string; reasoningEffort?: SessionReasoningEffort }) => Promise<{
      runtimeApplied: boolean;
      state: { model?: string; reasoningEffort?: SessionReasoningEffort };
      modelState?: AcpModelState;
    }>;
    respondPermission: (requestId: string, decision: "allow" | "deny") => void;
    cancel: () => void;
    supportsPermissionResponses: boolean;
  };
};

export type PermissionEntry = { sessionId: string; request: PermissionRequest };

export type HelmStatePaths = {
  sessions: string;
  sessionMessages: string;
  sessionArtifacts: string;
  sessionRuntimes: string;
  sessionsSqlite: string;
  trustedDevices: string;
  logs: string;
};

export type HelmRuntimeOptions = TillerRuntimeOptions;

export type HelmState = HelmSessionStores & {
  configPath: string;
  configStub: TillerConfigStub;
  tillerConfig: ReturnType<typeof readTillerConfig>;
  defaultWorktreeRoot: string;
  paths: HelmStatePaths;
  runtime: HelmRuntimeOptions;

  trustedDeviceStore: TrustedDeviceStore;

  helms: HelmSummary[];
  worktrees: WorktreeSummary[];
  agents: AcpAgentProvider[];
  projects: ProjectSummary[];

  sessions: Map<string, SessionRecord>;
  permissionIndex: Map<string, PermissionEntry>;
  projectContextSummaryCache: Map<string, string>;

  reloadHelms(): void;
  reloadWorktrees(): void;
  reloadAgents(): void;
  reloadProjects(): void;
};

export type CreateHelmStateOptions = {
  configPath: string;
  defaultWorktreeRoot: string;
  logger: Pick<TillerLogger, "logInfo" | "logError">;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
};

export function createHelmState(options: CreateHelmStateOptions): HelmState {
  const { configPath, defaultWorktreeRoot, logger } = options;

  const configDir = dirname(configPath);
  const paths: HelmStatePaths = {
    sessions: resolve(configDir, "sessions.json"),
    sessionMessages: resolve(configDir, "session-messages"),
    sessionArtifacts: resolve(configDir, "session-artifacts"),
    sessionRuntimes: resolve(configDir, "session-runtimes.json"),
    sessionsSqlite: resolve(configDir, "sessions.sqlite"),
    trustedDevices: resolve(configDir, "trusted-devices.json"),
    logs: resolve(configDir, "logs"),
  };

  ensureTillerConfigDefaults(configPath);
  const configStub = loadTillerConfigStub(configPath);
  const tillerConfig = readTillerConfig(configPath);
  const runtime = resolveTillerRuntimeOptions({
    config: tillerConfig,
    argv: options.argv,
    env: options.env,
  });

  const sessionStores = createHelmSessionStores({
    backend: resolveSessionStoreBackend(),
    sqlitePath: paths.sessionsSqlite,
    jsonPaths: {
      sessionHistoryPath: paths.sessions,
      sessionMessagesPath: paths.sessionMessages,
      sessionArtifactsPath: paths.sessionArtifacts,
      sessionRuntimesPath: paths.sessionRuntimes,
    },
    logInfo: logger.logInfo,
    logError: logger.logError,
  });
  const trustedDeviceStore = createTrustedDeviceStore(paths.trustedDevices);

  const state: HelmState = {
    configPath,
    configStub,
    tillerConfig,
    defaultWorktreeRoot,
    paths,
    runtime,
    ...sessionStores,
    trustedDeviceStore,
    helms: [],
    worktrees: [],
    agents: [],
    projects: [],
    sessions: new Map(),
    permissionIndex: new Map(),
    projectContextSummaryCache: new Map(),
    reloadHelms() {
      state.helms = loadAvailableHelms(state);
    },
    reloadWorktrees() {
      state.worktrees = loadAvailableWorktrees(state);
    },
    reloadAgents() {
      state.agents = listAvailableProviders(state.configPath);
    },
    reloadProjects() {
      state.projects = loadAvailableProjects(state);
    },
  };

  state.reloadHelms();
  state.reloadWorktrees();
  state.reloadAgents();
  state.reloadProjects();
  normalizeProjectAgentDefaultsOnStartup(state, logger);
  state.reloadProjects();

  return state;
}

export function loadAvailableHelms(state: HelmState): HelmSummary[] {
  const configured = listConfiguredHelms(state.configPath);
  if (configured.length) {
    return configured;
  }
  return [
    {
      id: "local-helm",
      name: "Local Helm",
      host: state.runtime.host,
      port: state.runtime.port,
    },
  ];
}

export function loadAvailableWorktrees(state: HelmState): WorktreeSummary[] {
  const configured = dedupeWorktrees(readTillerConfig(state.configPath).worktrees ?? []);
  if (configured.length) {
    return configured;
  }
  return [
    {
      name: basename(state.defaultWorktreeRoot),
      path: state.defaultWorktreeRoot.replace(/\\/g, "/"),
    },
  ];
}

export function loadAvailableProjects(state: HelmState): ProjectSummary[] {
  const configured = listConfiguredProjects(state.configPath);
  if (configured.length) {
    return configured;
  }

  const fallbackHelm = state.helms[0] ?? {
    id: "local-helm",
    name: "Local Helm",
    host: state.runtime.host,
    port: state.runtime.port,
  };
  const fallbackWorktrees = state.worktrees.length
    ? state.worktrees
    : [
        {
          name: basename(state.defaultWorktreeRoot),
          path: state.defaultWorktreeRoot.replace(/\\/g, "/"),
        },
      ];
  return [
    {
      id: "current-project",
      name: basename(state.defaultWorktreeRoot),
      helmId: fallbackHelm.id,
      path: state.defaultWorktreeRoot.replace(/\\/g, "/"),
      worktrees: fallbackWorktrees,
    },
  ];
}


function dedupeWorktrees(items: WorktreeSummary[]): WorktreeSummary[] {
  const seen = new Set<string>();
  const next: WorktreeSummary[] = [];
  for (const item of items) {
    if (seen.has(item.path)) {
      continue;
    }
    seen.add(item.path);
    next.push(item);
  }
  return next;
}

function normalizeProjectAgentDefaultsOnStartup(
  state: HelmState,
  logger: Pick<TillerLogger, "logInfo">,
) {
  void state;
  void logger;
}
