import { basename, dirname, resolve } from "node:path";
import {
  listAvailableHelms as listConfiguredHelms,
  listAvailableProjects as listConfiguredProjects,
  listAvailableProviders,
  loadTillerConfigStub,
  readTillerConfig,
  saveProjectToConfig,
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
  WorkspaceSummary,
} from "@tiller/shared";
import {
  resolveTillerRuntimeOptions,
  type TillerRuntimeOptions,
} from "../runtime/options";
import {
  createHelmSessionStores,
  resolveSessionStoreBackend,
  type HelmSessionStores,
} from "../sessions/store-factory";
import { type StoredSessionRuntimeDescriptor } from "../sessions/runtime-store";
import { createTrustedDeviceStore } from "../auth/beacon-store";
import type { TillerLogger } from "../logging/logger";

type TillerConfigStub = ReturnType<typeof loadTillerConfigStub>;
type TrustedDeviceStore = ReturnType<typeof createTrustedDeviceStore>;

export type SessionRecord = {
  summary: SessionSummary;
  agent: AcpAgentProvider;
  workspace: WorkspaceSummary;
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
  defaultWorkspaceRoot: string;
  paths: HelmStatePaths;
  runtime: HelmRuntimeOptions;

  trustedDeviceStore: TrustedDeviceStore;

  helms: HelmSummary[];
  workspaces: WorkspaceSummary[];
  agents: AcpAgentProvider[];
  projects: ProjectSummary[];

  sessions: Map<string, SessionRecord>;
  permissionIndex: Map<string, PermissionEntry>;
  projectContextSummaryCache: Map<string, string>;
  openCodeHistoryRefreshes: Map<string, number>;

  reloadHelms(): void;
  reloadWorkspaces(): void;
  reloadAgents(): void;
  reloadProjects(): void;
};

export type CreateHelmStateOptions = {
  configPath: string;
  defaultWorkspaceRoot: string;
  logger: Pick<TillerLogger, "logInfo" | "logError">;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
};

export function createHelmState(options: CreateHelmStateOptions): HelmState {
  const { configPath, defaultWorkspaceRoot, logger } = options;

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
    defaultWorkspaceRoot,
    paths,
    runtime,
    ...sessionStores,
    trustedDeviceStore,
    helms: [],
    workspaces: [],
    agents: [],
    projects: [],
    sessions: new Map(),
    permissionIndex: new Map(),
    projectContextSummaryCache: new Map(),
    openCodeHistoryRefreshes: new Map(),
    reloadHelms() {
      state.helms = loadAvailableHelms(state);
    },
    reloadWorkspaces() {
      state.workspaces = loadAvailableWorkspaces(state);
    },
    reloadAgents() {
      state.agents = listAvailableProviders(state.configPath);
    },
    reloadProjects() {
      state.projects = loadAvailableProjects(state);
    },
  };

  state.reloadHelms();
  state.reloadWorkspaces();
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

export function loadAvailableWorkspaces(state: HelmState): WorkspaceSummary[] {
  const configured = dedupeWorkspaces(readTillerConfig(state.configPath).workspaces ?? []);
  if (configured.length) {
    return configured;
  }
  return [
    {
      id: "current-workspace",
      name: basename(state.defaultWorkspaceRoot),
      path: state.defaultWorkspaceRoot.replace(/\\/g, "/"),
    },
  ];
}

export function loadAvailableProjects(state: HelmState): ProjectSummary[] {
  const configured = listConfiguredProjects(state.configPath);
  const available = listAvailableProviders(state.configPath);
  if (configured.length) {
    return configured.map((project) => ({
      ...project,
      defaultAgentId: resolveDefaultProjectAgentId(available, project.defaultAgentId),
    }));
  }

  const fallbackHelm = state.helms[0] ?? {
    id: "local-helm",
    name: "Local Helm",
    host: state.runtime.host,
    port: state.runtime.port,
  };
  const fallbackWorkspaces = state.workspaces.length
    ? state.workspaces
    : [
        {
          id: "current-workspace",
          name: basename(state.defaultWorkspaceRoot),
          path: state.defaultWorkspaceRoot.replace(/\\/g, "/"),
        },
      ];
  return [
    {
      id: "current-project",
      name: basename(state.defaultWorkspaceRoot),
      helmId: fallbackHelm.id,
      workspaceIds: fallbackWorkspaces.map((workspace) => workspace.id),
      defaultWorkspaceId: fallbackWorkspaces[0]?.id,
      defaultAgentId: resolveDefaultProjectAgentId(available, undefined),
    },
  ];
}

export function resolveDefaultProjectAgentId(
  agents: AcpAgentProvider[],
  existingDefaultAgentId: string | undefined,
): string | undefined {
  const codex = agents.find((agent) => agent.id === "codex");
  return codex?.id ?? existingDefaultAgentId ?? agents[0]?.id;
}

function dedupeWorkspaces(items: WorkspaceSummary[]): WorkspaceSummary[] {
  const seen = new Set<string>();
  const next: WorkspaceSummary[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    next.push(item);
  }
  return next;
}

function normalizeProjectAgentDefaultsOnStartup(
  state: HelmState,
  logger: Pick<TillerLogger, "logInfo">,
) {
  const available = listAvailableProviders(state.configPath);
  let updated = 0;
  for (const project of listConfiguredProjects(state.configPath)) {
    const next = resolveDefaultProjectAgentId(available, project.defaultAgentId);
    if (next && project.defaultAgentId !== next) {
      saveProjectToConfig({ ...project, defaultAgentId: next }, state.configPath);
      updated += 1;
    }
  }
  if (updated) {
    logger.logInfo(`[tiller] project.agent.default updated=${updated} default=codex`);
  }
}
