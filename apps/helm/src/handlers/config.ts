import { listAvailableProviders, saveHelmToConfig, saveProjectToConfig, saveProviderToConfig, saveWorkspaceToConfig } from "@tiller/agent-registry";
import type { ClientToHelm } from "@tiller/sync-protocol";
import type { HelmMessageHandler } from "./context";

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