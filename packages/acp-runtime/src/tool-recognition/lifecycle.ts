import type { AgentToolCall } from "@tiller/shared";
import type { ToolEvidence, ToolObservation } from "./types";

type SubagentEntity = {
  id: string;
  title: string;
  input?: string;
  commandId?: string;
  aliases: Set<string>;
};

type SessionLifecycle = {
  byAlias: Map<string, SubagentEntity>;
  running: Set<SubagentEntity>;
};

export function createToolLifecycleCorrelator() {
  const sessions = new Map<string, SessionLifecycle>();
  return {
    project(
      observation: ToolObservation,
      toolCall: AgentToolCall,
      evidence: ToolEvidence[],
    ): AgentToolCall[] {
      const semantic = strongestSubagentEvidence(evidence);
      if (toolCall.subagentOperation) {
        return [toolCall];
      }
      if (toolCall.kind !== "subagent" || !semantic?.subagent || !observation.sessionId) {
        return [toolCall];
      }
      const sessionKey = `${observation.providerId ?? "generic"}\u001f${observation.sessionId}`;
      const session = sessions.get(sessionKey) ?? { byAlias: new Map(), running: new Set() };
      sessions.set(sessionKey, session);
      const { action, batch, entityIds, background, terminal } = semantic.subagent;
      if (action === "spawn") {
        const ids = entityIds.length ? entityIds : [toolCall.id];
        if (!batch || ids.length === 1) {
          const entityId = ids[0] ?? toolCall.id;
          const existing = ids
            .map((id) => session.byAlias.get(id))
            .find((candidate): candidate is SubagentEntity => Boolean(candidate))
            ?? session.byAlias.get(toolCall.id)
            ?? resolveOnlyUnidentifiedSpawn(session, entityIds, toolCall);
          const commandId = entityId === toolCall.id && !toolCall.commandId
            ? undefined
            : `subagent:${entityId}`;
          const entity = existing ?? {
            id: toolCall.id,
            title: toolCall.title,
            input: toolCall.input,
            aliases: new Set<string>(),
          };
          entity.commandId = commandId ?? entity.commandId ?? toolCall.commandId;
          addAliases(session, entity, [toolCall.id, ...ids, entity.commandId]);
          session.running.add(entity);
          return [{
            ...toolCall,
            id: entity.id,
            title: entity.title,
            ...(entity.commandId ? { commandId: entity.commandId } : {}),
            status: background || entityIds.length || toolCall.status === "completed" ? "running" : toolCall.status,
          }];
        }
        return ids.map((entityId, index) => {
          const existing = session.byAlias.get(entityId);
          const id = existing?.id ?? `${toolCall.id}::${entityId}`;
          const commandId = entityId === toolCall.id && !toolCall.commandId
            ? undefined
            : `subagent:${entityId}`;
          const entity = existing ?? {
            id,
            title: toolCall.title,
            input: toolCall.input,
            aliases: new Set<string>(),
          };
          entity.commandId = commandId ?? entity.commandId ?? toolCall.commandId;
          addAliases(
            session,
            entity,
            [entityId, entity.commandId],
          );
          session.running.add(entity);
          return {
            ...toolCall,
            id: entity.id,
            title: entity.title,
            ...(entity.commandId ? { commandId: entity.commandId } : {}),
            status: background || entityIds.length || toolCall.status === "completed" ? "running" : toolCall.status,
            ...(index > 0 ? { timestamp: toolCall.timestamp } : {}),
          };
        });
      }

      const entity = resolveEntity(session, entityIds, toolCall);
      if (!entity) {
        return [{
          ...toolCall,
          status: terminalStatus(action, terminal, toolCall.status),
        }];
      }
      const resolvedCommandId = entity.commandId ?? toolCall.commandId ??
        (entityIds[0] ? `subagent:${entityIds[0]}` : undefined);
      entity.commandId = resolvedCommandId;
      addAliases(session, entity, [...entityIds, toolCall.id, resolvedCommandId]);
      const status = terminalStatus(action, terminal, toolCall.status);
      if (["completed", "failed", "cancelled"].includes(status)) {
        session.running.delete(entity);
      }
      return [{
        ...toolCall,
        id: entity.id,
        title: entity.title,
        ...(entity.input && !toolCall.input ? { input: entity.input } : {}),
        ...(resolvedCommandId ? { commandId: resolvedCommandId } : {}),
        status,
      }];
    },
    dispose(providerId: string | undefined, sessionId: string): void {
      sessions.delete(`${providerId ?? "generic"}\u001f${sessionId}`);
    },
  };
}

function resolveOnlyUnidentifiedSpawn(
  session: SessionLifecycle,
  entityIds: string[],
  toolCall: AgentToolCall,
): SubagentEntity | undefined {
  if (entityIds.length !== 1 || toolCall.input || !toolCall.output) {
    return undefined;
  }
  const candidates = [...session.running].filter((entity) => !entity.commandId);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function strongestSubagentEvidence(evidence: ToolEvidence[]): ToolEvidence | undefined {
  return evidence
    .filter((item) => item.subagent)
    .sort((left, right) => right.strength - left.strength)[0];
}

function resolveEntity(
  session: SessionLifecycle,
  entityIds: string[],
  toolCall: AgentToolCall,
): SubagentEntity | undefined {
  for (const alias of [toolCall.commandId, ...entityIds, toolCall.id]) {
    if (!alias) continue;
    const normalized = alias.startsWith("subagent:") ? alias.slice("subagent:".length) : alias;
    const entity = session.byAlias.get(alias) ?? session.byAlias.get(normalized);
    if (entity) return entity;
  }
  return session.running.size === 1 ? [...session.running][0] : undefined;
}

function addAliases(
  session: SessionLifecycle,
  entity: SubagentEntity,
  aliases: Array<string | undefined>,
): void {
  for (const alias of aliases) {
    if (!alias) continue;
    entity.aliases.add(alias);
    session.byAlias.set(alias, entity);
    if (alias.startsWith("subagent:")) {
      session.byAlias.set(alias.slice("subagent:".length), entity);
    }
  }
}

function terminalStatus(
  action: string,
  terminal: boolean,
  status: AgentToolCall["status"],
): AgentToolCall["status"] {
  if (action === "cancel") return "cancelled";
  if (terminal) return status === "failed" || status === "cancelled" ? status : "completed";
  return "running";
}
