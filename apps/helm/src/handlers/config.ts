import { exec, execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { listAvailableProviders, saveHelmToConfig, saveProjectToConfig, saveProviderToConfig, saveWorkspaceToConfig } from "@tiller/agent-registry";
import type { AcpAgentProvider, ProjectSummary, WorkspaceSummary } from "@tiller/shared";
import type { ClientToHelm } from "@tiller/sync-protocol";
import type { HelmMessageHandler } from "./context";


const ACP_REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 8000;

function normalizeGitBranchName(input: string) {
  return input.trim().replace(/\s+/g, "-");
}

function validateGitBranchName(branchName: string) {
  if (!branchName || branchName.includes("..") || branchName.startsWith("/") || branchName.endsWith("/") || !/^[A-Za-z0-9._/-]+$/.test(branchName)) {
    throw new Error("Branch name can only contain letters, numbers, dot, slash, underscore and dash.");
  }
}

function safeWorktreeSlug(branchName: string) {
  return branchName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "worktree";
}

async function runGit(cwd: string, args: string[]) {
  return execFileAsync("git", ["-C", cwd, ...args], { timeout: GIT_COMMAND_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 });
}

async function resolveGitRoot(path: string) {
  const result = await runGit(path, ["rev-parse", "--show-toplevel"]);
  return result.stdout.trim() || path;
}

async function listGitBranches(root: string) {
  const [branchesResult, currentResult] = await Promise.all([
    runGit(root, ["branch", "--format=%(refname:short)"]),
    runGit(root, ["branch", "--show-current"]).catch(() => ({ stdout: "" })),
  ]);
  return {
    branches: branchesResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    currentBranch: currentResult.stdout.trim() || undefined,
  };
}

function resolveProjectRoot(project: ProjectSummary, workspaces: WorkspaceSummary[]) {
  if (project.path) {
    return project.path;
  }
  const workspace = workspaces.find((item) => item.id === project.defaultWorkspaceId) ?? workspaces.find((item) => project.workspaceIds?.includes(item.id));
  return workspace?.path;
}

function projectWorkspaceItems(project: ProjectSummary, workspaces: WorkspaceSummary[]) {
  if (!project.workspaceIds?.length) {
    return workspaces;
  }
  return workspaces.filter((workspace) => project.workspaceIds?.includes(workspace.id));
}

async function createProjectWorktree(project: ProjectSummary, workspaces: WorkspaceSummary[], branchNameInput: string, configPath: string) {
  const branchName = normalizeGitBranchName(branchNameInput);
  validateGitBranchName(branchName);
  const projectRoot = resolveProjectRoot(project, workspaces);
  if (!projectRoot) {
    throw new Error("Project has no path or workspace path to create a Git worktree from.");
  }
  const gitRoot = await resolveGitRoot(projectRoot);
  const { branches } = await listGitBranches(gitRoot);
  const branchExists = branches.includes(branchName);
  const worktreePath = join(gitRoot, ".tiller", "worktrees", safeWorktreeSlug(branchName));
  await mkdir(join(gitRoot, ".tiller", "worktrees"), { recursive: true });
  await runGit(gitRoot, branchExists ? ["worktree", "add", worktreePath, branchName] : ["worktree", "add", "-b", branchName, worktreePath]);

  const workspaceId = `${project.id}-worktree-${safeWorktreeSlug(branchName)}`;
  const workspace: WorkspaceSummary = { id: workspaceId, name: branchName, path: worktreePath.replace(/\\/g, "/") };
  saveWorkspaceToConfig(workspace, configPath);
  saveProjectToConfig({
    ...project,
    workspaceIds: Array.from(new Set([...(project.workspaceIds ?? []), workspaceId])),
    defaultWorkspaceId: project.defaultWorkspaceId ?? workspaceId,
  }, configPath);
  return workspace;
}


type RegistryAgent = {
  id?: string;
  name?: string;
  distribution?: {
    binary?: Record<string, { cmd?: string; args?: string[] }>;
  };
};

function currentRegistryPlatformKey() {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  return `${os}-${arch}`;
}

function normalizeRegistryCommand(command: string) {
  const executable = command.replace(/^\.\\?/, "").replace(/^\.\//, "").split(/[\\/]/).pop() ?? command;
  return executable.replace(/\.exe$/i, "");
}

function discoveryCommandKey(command: string) {
  return normalizeRegistryCommand(command).toLowerCase();
}

function providerFromRegistryAgent(agent: RegistryAgent): AcpAgentProvider | null {
  if (!agent.id || !agent.name) {
    return null;
  }

  const platformBinary = agent.distribution?.binary?.[currentRegistryPlatformKey()];
  if (!platformBinary?.cmd) {
    return null;
  }

  const command = normalizeRegistryCommand(platformBinary.cmd);
  return {
    id: agent.id,
    name: agent.name,
    kind: "custom",
    command,
    args: platformBinary.args ?? [],
    transport: "stdio",
    protocol: "acp",
    installHint: `Install ${agent.name} and make \`${command}\` available on PATH.`,
  };
}

async function loadRegistryDiscoveryCandidates() {
  try {
    const response = await fetch(ACP_REGISTRY_URL, { signal: AbortSignal.timeout(3500) });
    if (!response.ok) {
      throw new Error(`ACP registry responded ${response.status}`);
    }
    const registry = (await response.json()) as { agents?: RegistryAgent[] };
    const providers = (registry.agents ?? []).map(providerFromRegistryAgent).filter((agent): agent is AcpAgentProvider => Boolean(agent));
    return providers;
  } catch {
    return [];
  }
}

function discoverProbeCommands(command: string) {
  const normalized = normalizeRegistryCommand(command).trim();
  if (!normalized || /[\/:]/.test(normalized)) {
    return [];
  }
  return [normalized];
}

async function commandHasHelpOutput(command: string) {
  const commands = discoverProbeCommands(command);
  const candidates = ["-h", "--help"];
  for (const probeCommand of commands) {
    for (const arg of candidates) {
      const output = await new Promise<string>((resolve) => {
        exec(`${probeCommand} ${arg}`, { timeout: 2500, windowsHide: true }, (error, stdout, stderr) => {
          if (error) {
            resolve("");
            return;
          }
          resolve(`${stdout ?? ""}${stderr ?? ""}`.trim());
        });
      });
      if (output) {
        return true;
      }
    }
  }
  return false;
}

async function discoverAcpAgents(configuredAgents: AcpAgentProvider[]) {
  const configuredById = new Map(configuredAgents.map((agent) => [agent.id, agent]));
  const configuredCommands = new Set(configuredAgents.map((agent) => discoveryCommandKey(agent.command)));
  const registryCandidates = await loadRegistryDiscoveryCandidates();
  const candidateResults = await Promise.all(
    registryCandidates.map(async (candidate) => ({
      agent: candidate,
      available: await commandHasHelpOutput(candidate.command),
      configured: configuredById.has(candidate.id) || configuredCommands.has(discoveryCommandKey(candidate.command)),
    })),
  );
  const discovered = candidateResults.filter((result) => result.available).map((result) => result.agent);
  const candidates = candidateResults.map((result) => ({
    id: result.agent.id,
    name: result.agent.name,
    command: result.agent.command,
    args: result.agent.args,
    available: result.available,
    configured: result.configured,
  }));

  return { discovered, agents: configuredAgents, candidates };
}

export const handleConfigMessage: HelmMessageHandler = async (socket, payload, context) => {
  switch (payload.type) {
    case "helm.list": {
      const helms = context.loadAvailableHelms();
      context.setHelms(helms);
      context.emit(socket, { type: "helm.list.result", requestId: payload.requestId, helms });
      return true;
    }
    case "helm.save": {
      const result = saveHelmToConfig(payload.helm, context.configPath);
      context.setHelms(context.loadAvailableHelms());
      context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
      context.emit(socket, {
        type: "helm.save.result",
        requestId: payload.requestId,
        ok: true,
        helmId: payload.helm.id,
        message: `Saved Helm model config to ${result.configPath}`,
      });
      return true;
    }
    case "project.list": {
      const projects = await context.loadAvailableProjectsWithSemanticSummaries();
      context.setProjects(projects);
      context.emit(socket, { type: "project.list.result", requestId: payload.requestId, projects });
      return true;
    }
    case "project.save": {
      try {
        const result = saveProjectToConfig(payload.project, context.configPath);
        const workspaces = context.loadAvailableWorkspaces();
        const projects = await context.loadAvailableProjectsWithSemanticSummaries();
        context.setWorkspaces(workspaces);
        context.setProjects(projects);
        context.emit(socket, {
          type: "project.save.result",
          requestId: payload.requestId,
          ok: true,
          projectId: payload.project.id,
          message: `Saved project to ${result.configPath}`,
        });
        context.emit(socket, { type: "project.list.result", requestId: `project-list-${Date.now()}`, projects });
        context.emit(socket, { type: "workspace.list.result", requestId: `workspace-list-${Date.now()}`, workspaces });
      } catch (error) {
        context.emit(socket, {
          type: "error",
          requestId: payload.requestId,
          message: error instanceof Error ? error.message : "Failed to save project.",
        });
      }
      return true;
    }
    case "workspace.list": {
      const workspaces = context.loadAvailableWorkspaces();
      context.setWorkspaces(workspaces);
      context.emit(socket, { type: "workspace.list.result", requestId: payload.requestId, workspaces });
      return true;
    }
    case "workspace.save": {
      const result = saveWorkspaceToConfig(payload.workspace, context.configPath);
      const workspaces = context.loadAvailableWorkspaces();
      const projects = await context.loadAvailableProjectsWithSemanticSummaries();
      context.setWorkspaces(workspaces);
      context.setProjects(projects);
      context.emit(socket, {
        type: "workspace.save.result",
        requestId: payload.requestId,
        ok: true,
        workspaceId: payload.workspace.id,
        message: `Saved workspace to ${result.configPath}`,
      });
      return true;
    }

    case "workspace.git.list": {
      const projects = await context.loadAvailableProjectsWithSemanticSummaries();
      const workspaces = context.loadAvailableWorkspaces();
      context.setProjects(projects);
      context.setWorkspaces(workspaces);
      const project = context.resolveProjectById(payload.projectId, projects);
      if (!project) {
        context.emit(socket, { type: "workspace.git.result", requestId: payload.requestId, ok: false, projectId: payload.projectId, branches: [], workspaces: [], message: "Project not found" });
        return true;
      }
      const projectRoot = resolveProjectRoot(project, workspaces);
      try {
        const gitRoot = projectRoot ? await resolveGitRoot(projectRoot) : undefined;
        const gitInfo = gitRoot ? await listGitBranches(gitRoot) : { branches: [], currentBranch: undefined };
        if (gitInfo.branches.length) {
          saveProjectToConfig({ ...project, gitBranches: gitInfo.branches }, context.configPath);
          const nextProjects = await context.loadAvailableProjectsWithSemanticSummaries();
          context.setProjects(nextProjects);
          context.emit(socket, { type: "project.list.result", requestId: `project-list-${Date.now()}`, projects: nextProjects });
        }
        context.emit(socket, {
          type: "workspace.git.result",
          requestId: payload.requestId,
          ok: true,
          projectId: project.id,
          branches: gitInfo.branches,
          currentBranch: gitInfo.currentBranch,
          workspaces: projectWorkspaceItems(project, workspaces),
          selectedWorkspaceId: project.defaultWorkspaceId,
          message: gitRoot ? "Git worktrees loaded" : "Project has no workspace path",
        });
      } catch (error) {
        context.emit(socket, { type: "workspace.git.result", requestId: payload.requestId, ok: false, projectId: project.id, branches: [], workspaces: projectWorkspaceItems(project, workspaces), message: error instanceof Error ? error.message : "Failed to list Git worktrees" });
      }
      return true;
    }
    case "workspace.git.create": {
      const projects = await context.loadAvailableProjectsWithSemanticSummaries();
      const workspaces = context.loadAvailableWorkspaces();
      const project = context.resolveProjectById(payload.projectId, projects);
      if (!project) {
        context.emit(socket, { type: "workspace.git.result", requestId: payload.requestId, ok: false, projectId: payload.projectId, branches: [], workspaces: [], message: "Project not found" });
        return true;
      }
      try {
        const workspace = await createProjectWorktree(project, workspaces, payload.branchName, context.configPath);
        const nextProjects = await context.loadAvailableProjectsWithSemanticSummaries();
        const nextWorkspaces = context.loadAvailableWorkspaces();
        context.setProjects(nextProjects);
        context.setWorkspaces(nextWorkspaces);
        const gitRoot = await resolveGitRoot(workspace.path);
        const gitInfo = await listGitBranches(gitRoot);
        const nextProject = context.resolveProjectById(project.id, nextProjects) ?? project;
        if (gitInfo.branches.length) {
          saveProjectToConfig({ ...nextProject, gitBranches: gitInfo.branches }, context.configPath);
        }
        context.emit(socket, {
          type: "workspace.git.result",
          requestId: payload.requestId,
          ok: true,
          projectId: project.id,
          branches: gitInfo.branches,
          currentBranch: payload.branchName,
          workspaces: projectWorkspaceItems(nextProject, nextWorkspaces),
          selectedWorkspaceId: workspace.id,
          message: `Created worktree ${payload.branchName}`,
        });
        context.emit(socket, { type: "workspace.list.result", requestId: `workspace-list-${Date.now()}`, workspaces: nextWorkspaces });
        context.emit(socket, { type: "project.list.result", requestId: `project-list-${Date.now()}`, projects: nextProjects });
      } catch (error) {
        context.emit(socket, { type: "workspace.git.result", requestId: payload.requestId, ok: false, projectId: project.id, branches: [], workspaces: projectWorkspaceItems(project, workspaces), message: error instanceof Error ? error.message : "Failed to create Git worktree" });
      }
      return true;
    }
    case "agent.list": {
      const agents = context.loadAvailableAgents();
      context.setAgents(agents);
      context.emit(socket, { type: "agent.list.result", requestId: payload.requestId, agents });
      return true;
    }
    case "agent.discover": {
      const configuredAgents = context.loadAvailableAgents();
      const result = await discoverAcpAgents(configuredAgents);
      context.setAgents(result.agents);
      context.emit(socket, {
        type: "agent.discover.result",
        requestId: payload.requestId,
        agents: result.agents,
        discoveredCount: result.discovered.length,
        candidates: result.candidates,
        message: result.discovered.length
          ? `Discovered ${result.discovered.length} ACP agent${result.discovered.length === 1 ? "" : "s"}.`
          : "No ACP agents discovered on PATH.",
      });
      return true;
    }
    case "agent.save": {
      const provider = {
        id: payload.provider.id,
        name: payload.provider.name,
        kind: payload.provider.kind,
        command: payload.provider.command,
        args: payload.provider.args,
        env: payload.provider.env,
        cwd: payload.provider.cwd,
        initializeTimeoutMs: payload.provider.initializeTimeoutMs,
        defaultAgent: payload.provider.defaultAgent,
        transport: "stdio" as const,
        protocol: "acp" as const,
        installHint: payload.provider.installHint,
      };
      const result = saveProviderToConfig(provider, context.configPath);
      context.setAgents(listAvailableProviders(context.configPath));
      context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
      context.emit(socket, {
        type: "agent.save.result",
        requestId: payload.requestId,
        ok: true,
        providerId: provider.id,
        message: `Saved provider to ${result.configPath}`,
      });
      return true;
    }
    case "agent.test": {
      const agent = context.resolveProviderById(payload.providerId, context.getAgents());
      if (!agent) {
        context.emit(socket, {
          type: "agent.test.result",
          requestId: payload.requestId,
          ok: false,
          providerId: payload.providerId,
          message: "Provider not found",
        });
        return true;
      }
      const workspace = context.getWorkspaces()[0];
      const result = await context.testAcpConnection(agent, workspace?.path);
      context.emit(socket, {
        type: "agent.test.result",
        requestId: payload.requestId,
        ok: result.ok,
        providerId: payload.providerId,
        message: result.message,
      });
      return true;
    }
    case "agent.model.options.get": {
      const agent = context.resolveProviderById(payload.providerId, context.getAgents());
      const workspace = context.getWorkspaces().find((item) => item.id === payload.workspaceId);
      if (!agent || !workspace) {
        context.emit(socket, {
          type: "agent.model.options.result",
          requestId: payload.requestId,
          ok: false,
          providerId: payload.providerId,
          workspaceId: payload.workspaceId,
          message: !agent ? "Provider not found" : "Workspace not found",
          modelOptions: [],
          configOptions: [],
          state: {},
        });
        return true;
      }
      const result = await context.probeAgentModelOptions(agent, workspace);
      context.emit(socket, {
        type: "agent.model.options.result",
        requestId: payload.requestId,
        providerId: agent.id,
        workspaceId: workspace.id,
        ...result,
      });
      return true;
    }
    default:
      return false;
  }
};
