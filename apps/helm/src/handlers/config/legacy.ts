import {
  listAvailableProviders,
  saveHelmToConfig,
  saveProjectToConfig,
  saveProviderToConfig,
  saveWorkspaceToConfig,
} from "@tiller/agent-registry";
import type { ClientToHelm } from "@tiller/sync-protocol";
import { isProjectRootBranchWorkspace } from "../../sessions/project/binding";
import { listProjectFiles, resolveProjectFileRoot } from "./project-files";
import type { HelmMessageHandler } from "../context";

import {
  createProjectWorktree,
  listGitBranches,
  persistProjectGitInfo,
  persistProjectGitInfoIfAvailable,
  projectWorkspaceItems,
  refreshProjectGitBranches,
  resolveGitRoot,
  resolveProjectRoot,
} from "./project-git";
export { resolveProjectFileRoot } from "./project-files";
export {
  persistProjectGitInfo,
  resolveProjectWorkspaceId,
  shouldPersistProjectGitInfo,
} from "./project-git";

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
    case "project.files.list": {
      const projects = await context.loadAvailableProjectsWithSemanticSummaries();
      const workspaces = context.loadAvailableWorkspaces();
      context.setProjects(projects);
      context.setWorkspaces(workspaces);
      const project = context.resolveProjectById(payload.projectId, projects);
      if (!project) {
        context.emit(socket, {
          type: "project.files.result",
          requestId: payload.requestId,
          ok: false,
          projectId: payload.projectId,
          workspaceId: payload.workspaceId,
          files: [],
          message: "Project not found",
        });
        return true;
      }
      const projectRoot = resolveProjectFileRoot(project, workspaces, payload.workspaceId);
      if (!projectRoot) {
        context.emit(socket, {
          type: "project.files.result",
          requestId: payload.requestId,
          ok: false,
          projectId: project.id,
          workspaceId: payload.workspaceId,
          files: [],
          message: "Project has no path or workspace path",
        });
        return true;
      }
      try {
        const result = await listProjectFiles(projectRoot);
        context.emit(socket, {
          type: "project.files.result",
          requestId: payload.requestId,
          ok: true,
          projectId: project.id,
          workspaceId: payload.workspaceId,
          files: result.files,
          message: result.message,
        });
      } catch (error) {
        context.emit(socket, {
          type: "project.files.result",
          requestId: payload.requestId,
          ok: false,
          projectId: project.id,
          workspaceId: payload.workspaceId,
          files: [],
          message: error instanceof Error ? error.message : "Failed to list project files",
        });
      }
      return true;
    }
    case "project.save": {
      try {
        const result = saveProjectToConfig(payload.project, context.configPath);
        const savedWorkspaces = context.loadAvailableWorkspaces();
        try {
          await persistProjectGitInfoIfAvailable(
            payload.project,
            savedWorkspaces,
            context.configPath,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to refresh project Git branches";
          context.logError(
            `[tiller] project.save.git.refresh.failed project=${payload.project.id} message=${message}`,
          );
        }

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
        context.emit(socket, {
          type: "project.list.result",
          requestId: `project-list-${Date.now()}`,
          projects,
        });
        context.emit(socket, {
          type: "workspace.list.result",
          requestId: `workspace-list-${Date.now()}`,
          workspaces,
        });
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
      context.emit(socket, {
        type: "workspace.list.result",
        requestId: payload.requestId,
        workspaces,
      });
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
        context.emit(socket, {
          type: "workspace.git.result",
          requestId: payload.requestId,
          ok: false,
          projectId: payload.projectId,
          branches: [],
          workspaces: [],
          message: "Project not found",
        });
        return true;
      }
      const projectRoot = resolveProjectRoot(project, workspaces);
      try {
        const gitRoot = projectRoot ? await resolveGitRoot(projectRoot) : undefined;
        const gitInfo = gitRoot
          ? await listGitBranches(gitRoot)
          : { branches: [], currentBranch: undefined };
        if (gitInfo.branches.length && projectRoot) {
          persistProjectGitInfo(project, gitInfo, projectRoot, context.configPath);
          const nextProjects = await context.loadAvailableProjectsWithSemanticSummaries();
          const nextWorkspaces = context.loadAvailableWorkspaces();
          context.setProjects(nextProjects);
          context.setWorkspaces(nextWorkspaces);
          context.emit(socket, {
            type: "project.list.result",
            requestId: `project-list-${Date.now()}`,
            projects: nextProjects,
          });
          context.emit(socket, {
            type: "workspace.list.result",
            requestId: `workspace-list-${Date.now()}`,
            workspaces: nextWorkspaces,
          });
        }
        const latestWorkspaces = context.loadAvailableWorkspaces();
        context.emit(socket, {
          type: "workspace.git.result",
          requestId: payload.requestId,
          ok: true,
          projectId: project.id,
          branches: gitInfo.branches,
          currentBranch: gitInfo.currentBranch,
          workspaces: projectWorkspaceItems(
            context.resolveProjectById(project.id, context.getProjects()) ?? project,
            latestWorkspaces,
          ),
          selectedWorkspaceId: gitInfo.currentBranch ?? project.defaultWorkspaceId,
          message: gitRoot ? "Git worktrees loaded" : "Project has no workspace path",
        });
      } catch (error) {
        context.emit(socket, {
          type: "workspace.git.result",
          requestId: payload.requestId,
          ok: false,
          projectId: project.id,
          branches: [],
          workspaces: projectWorkspaceItems(project, workspaces),
          message: error instanceof Error ? error.message : "Failed to list Git worktrees",
        });
      }
      return true;
    }
    case "workspace.git.create": {
      const projects = await context.loadAvailableProjectsWithSemanticSummaries();
      const workspaces = context.loadAvailableWorkspaces();
      const project = context.resolveProjectById(payload.projectId, projects);
      if (!project) {
        context.emit(socket, {
          type: "workspace.git.result",
          requestId: payload.requestId,
          ok: false,
          projectId: payload.projectId,
          branches: [],
          workspaces: [],
          message: "Project not found",
        });
        return true;
      }
      try {
        const workspace = await createProjectWorktree(
          project,
          workspaces,
          payload.branchName,
          context.configPath,
        );
        const nextProjects = await context.loadAvailableProjectsWithSemanticSummaries();
        const nextWorkspaces = context.loadAvailableWorkspaces();
        context.setProjects(nextProjects);
        context.setWorkspaces(nextWorkspaces);
        const gitRoot = await resolveGitRoot(workspace.path);
        const gitInfo = await listGitBranches(gitRoot);
        const nextProject = context.resolveProjectById(project.id, nextProjects) ?? project;
        if (gitInfo.branches.length) {
          persistProjectGitInfo(nextProject, gitInfo, workspace.path, context.configPath);
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
        context.emit(socket, {
          type: "workspace.list.result",
          requestId: `workspace-list-${Date.now()}`,
          workspaces: nextWorkspaces,
        });
        context.emit(socket, {
          type: "project.list.result",
          requestId: `project-list-${Date.now()}`,
          projects: nextProjects,
        });
      } catch (error) {
        context.emit(socket, {
          type: "workspace.git.result",
          requestId: payload.requestId,
          ok: false,
          projectId: project.id,
          branches: [],
          workspaces: projectWorkspaceItems(project, workspaces),
          message: error instanceof Error ? error.message : "Failed to create Git worktree",
        });
      }
      return true;
    }
    case "agent.list": {
      const agents = context.loadAvailableAgents();
      context.setAgents(agents);
      context.emit(socket, { type: "agent.list.result", requestId: payload.requestId, agents });
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
      const workspaces = context.getWorkspaces();
      const baseWorkspace = workspaces.find((item) => item.id === payload.workspaceId);
      const project = payload.projectId
        ? context.resolveProjectById(payload.projectId, context.getProjects())
        : undefined;
      const workspace =
        project && baseWorkspace && project.path && isProjectRootBranchWorkspace(project, baseWorkspace)
          ? { ...baseWorkspace, path: project.path }
          : baseWorkspace;
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
