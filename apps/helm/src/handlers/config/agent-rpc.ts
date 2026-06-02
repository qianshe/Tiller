import {
  deleteProviderFromConfig,
  listAvailableProviders,
  saveProviderToConfig,
} from "@tiller/agent-registry";
import type { AcpAgentProvider } from "@tiller/shared";
import { isProjectRootBranchWorktree } from "../../sessions/facade";
import type { HelmHandlerContext } from "../context";

export function listAgents(context: HelmHandlerContext) {
  const agents = context.loadAvailableAgents();
  context.setAgents(agents);
  return { agents };
}

export async function saveAgent(params: { provider: AcpAgentProvider }, context: HelmHandlerContext) {
  const provider = {
    id: params.provider.id,
    name: params.provider.name,
    kind: params.provider.kind,
    command: params.provider.command,
    args: params.provider.args,
    env: params.provider.env,
    cwd: params.provider.cwd,
    initializeTimeoutMs: params.provider.initializeTimeoutMs,
    defaultAgent: params.provider.defaultAgent,
    transport: "stdio" as const,
    protocol: "acp" as const,
    installHint: params.provider.installHint,
  };
  const result = saveProviderToConfig(provider, context.configPath);
  context.setAgents(listAvailableProviders(context.configPath));
  context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
  return {
    ok: true,
    providerId: provider.id,
    message: `Saved provider to ${result.configPath}`,
  };
}

export async function deleteAgent(params: { providerId: string }, context: HelmHandlerContext) {
  const result = deleteProviderFromConfig(params.providerId, context.configPath);
  context.setAgents(listAvailableProviders(context.configPath));
  context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
  return {
    ok: result.deleted,
    providerId: params.providerId,
    message: result.deleted
      ? `Deleted provider from ${result.configPath}`
      : `Provider not found in ${result.configPath}`,
  };
}

export async function testAgent(params: { providerId: string }, context: HelmHandlerContext) {
  const agent = context.resolveProviderById(params.providerId, context.getAgents());
  if (!agent) {
    return {
      ok: false,
      providerId: params.providerId,
      message: "Provider not found",
    };
  }
  const worktree = context.getWorktrees()[0];
  const result = await context.testAcpConnection(agent, worktree?.path);
  return {
    ok: result.ok,
    providerId: params.providerId,
    message: result.message,
  };
}

export function listAgentConnections(context: HelmHandlerContext) {
  return { connections: context.listAcpConnectionInventory() };
}

export async function connectAgent(
  params: { providerId: string; cwd?: string; projectId?: string },
  context: HelmHandlerContext,
) {
  const { agent, worktree } = resolveAgentWorktree(params, context);
  if (!agent || !worktree) {
    return {
      ok: false,
      providerId: params.providerId,
      cwd: params.cwd,
      connections: context.listAcpConnectionInventory(),
      message: !agent ? "Provider not found" : "Worktree not found",
    };
  }

  logAgentInfo(context, "acp.connection.requested", {
    providerId: agent.id,
    cwd: worktree.path,
  });
  try {
    const connection = await context.connectAcpConnection({
      sessionId: `connect-${agent.id}-${Date.now()}`,
      agent,
      worktree,
      onEvent: () => undefined,
      onConnectionLifecycleEvent: (event) => {
        logAgentInfo(context, "acp.connection.opened", {
          providerId: event.providerId,
          key: event.key,
          cwd: event.cwd,
        });
      },
    });
    const inventory = connection.inventory();
    return {
      ok: true,
      providerId: agent.id,
      cwd: worktree.path,
      runtimeConnectionId: inventory.runtimeConnectionId,
      connection: inventory,
      connections: context.listAcpConnectionInventory(),
      message: "ACP provider connected.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to connect ACP provider";
    logAgentError(context, "acp.connection.failed", {
      providerId: agent.id,
      cwd: worktree.path,
      message,
    });
    return {
      ok: false,
      providerId: agent.id,
      cwd: worktree.path,
      connections: context.listAcpConnectionInventory(),
      message,
    };
  }
}

export async function reconnectAgent(
  params: { providerId: string; cwd?: string; projectId?: string },
  context: HelmHandlerContext,
) {
  const { agent, worktree } = resolveAgentWorktree(params, context);

  if (!agent || !worktree) {
    return {
      ok: false,
      providerId: params.providerId,
      cwd: params.cwd,
      message: !agent ? "Provider not found" : "Worktree not found",
    };
  }

  logAgentInfo(context, "acp.connection.reconnect_requested", {
    providerId: agent.id,
    cwd: worktree.path,
  });
  try {
    const connection = await context.reconnectAcpConnection({
      sessionId: `reconnect-${agent.id}-${Date.now()}`,
      agent,
      worktree,
      onEvent: () => undefined,
      onConnectionLifecycleEvent: (event) => {
        logAgentInfo(context, "acp.connection.lifecycle", {
          type: event.type,
          providerId: event.providerId,
          key: event.key,
          cwd: event.cwd,
        });
      },
    });
    const inventory = connection.inventory();
    logAgentInfo(context, "acp.connection.reconnect_completed", {
      providerId: agent.id,
      cwd: worktree.path,
      runtimeConnectionId: inventory.runtimeConnectionId,
    });
    return {
      ok: true,
      providerId: agent.id,
      cwd: worktree.path,
      runtimeConnectionId: inventory.runtimeConnectionId,
      connection: inventory,
      connections: context.listAcpConnectionInventory(),
      message: "ACP provider reconnected.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reconnect ACP provider";
    logAgentError(context, "acp.connection.reconnect_failed", {
      providerId: agent.id,
      cwd: worktree.path,
      message,
    });
    return {
      ok: false,
      providerId: agent.id,
      cwd: worktree.path,
      connections: context.listAcpConnectionInventory(),
      message,
    };
  }
}

function resolveAgentWorktree(
  params: { providerId: string; cwd?: string; projectId?: string },
  context: HelmHandlerContext,
) {
  const agent = context.resolveProviderById(params.providerId, context.getAgents());
  const worktrees = context.getWorktrees();
  const requestedCwd = params.cwd?.trim();
  const baseWorktree = requestedCwd
    ? (worktrees.find((item) => normalizeWorktreePath(item.path) === normalizeWorktreePath(requestedCwd)) ?? {
        name: requestedCwd.split(/[\\/]/u).filter(Boolean).at(-1) ?? "cwd",
        path: requestedCwd,
      })
    : worktrees[0];
  const project = params.projectId
    ? context.resolveProjectById(params.projectId, context.getProjects())
    : undefined;
  const worktree =
    requestedCwd
      ? baseWorktree
      : project && baseWorktree && project.path && isProjectRootBranchWorktree(project, baseWorktree)
        ? { ...baseWorktree, path: project.path }
        : baseWorktree;
  return { agent, worktree };
}

function logAgentInfo(context: HelmHandlerContext, event: string, fields: Record<string, unknown>) {
  if (context.logger) {
    if (event === "acp.connection.lifecycle") {
      context.logger.debug(event, fields);
      return;
    }
    context.logger.info(event, fields);
    return;
  }
  context.logInfo(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function logAgentError(context: HelmHandlerContext, event: string, fields: Record<string, unknown>) {
  if (context.logger) {
    context.logger.error(event, fields);
    return;
  }
  context.logError(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function formatLogFields(fields: Record<string, unknown>) {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

function normalizeWorktreePath(path: string) {
  return path.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}
