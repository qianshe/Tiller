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
          const commandId = toolCall.commandId ??
            (entityIds.length ? `subagent:${entityId}` : undefined);
          const existing = resolveByAliases(session, [toolCall.commandId, ...entityIds])
            ?? resolveCompatibleSpawnAlias(session, toolCall, commandId)
            ?? resolveOnlyUnidentifiedSpawn(session, entityIds, toolCall);
          if (!existing && hasAmbiguousUnidentifiedSpawns(session, entityIds, toolCall)) {
            return [];
          }
          const entity = existing ?? {
            id: resolveNewEntityId(session, toolCall, entityId),
            title: toolCall.title,
            input: toolCall.input,
            aliases: new Set<string>(),
          };
          entity.commandId = entity.commandId ?? commandId;
          addAliases(session, entity, [entity.id, toolCall.id, ...ids, entity.commandId]);
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
          entity.commandId = entity.commandId ?? commandId ?? toolCall.commandId;
          addAliases(
            session,
            entity,
            [entity.id, entityId, entity.commandId],
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
        const resolvedCommandId = toolCall.commandId ??
          (entityIds[0] ? `subagent:${entityIds[0]}` : undefined);
        return [{
          ...toolCall,
          id: session.byAlias.has(toolCall.id)
            ? resolveNewEntityId(session, toolCall, resolvedCommandId ?? toolCall.id)
            : toolCall.id,
          ...(resolvedCommandId ? { commandId: resolvedCommandId } : {}),
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
      } else {
        session.running.add(entity);
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

function hasAmbiguousUnidentifiedSpawns(
  session: SessionLifecycle,
  entityIds: string[],
  toolCall: AgentToolCall,
): boolean {
  if (entityIds.length !== 1 || toolCall.input || !toolCall.output) {
    return false;
  }
  return [...session.running].filter((entity) => !entity.commandId).length > 1;
}

function resolveCompatibleSpawnAlias(
  session: SessionLifecycle,
  toolCall: AgentToolCall,
  commandId: string | undefined,
): SubagentEntity | undefined {
  const entity = session.byAlias.get(toolCall.id);
  if (!entity || !session.running.has(entity)) {
    return undefined;
  }
  if (entity.commandId && commandId && !sameAlias(entity.commandId, commandId)) {
    return undefined;
  }
  if (!commandId && entity.input && toolCall.input && entity.input !== toolCall.input) {
    return undefined;
  }
  return entity;
}

function resolveNewEntityId(
  session: SessionLifecycle,
  toolCall: AgentToolCall,
  identity: string,
): string {
  if (!session.byAlias.has(toolCall.id)) {
    return toolCall.id;
  }
  const suffix = normalizeAlias(identity) || toolCall.timestamp;
  const base = `${toolCall.id}::${suffix}`;
  let candidate = base;
  let index = 2;
  while (session.byAlias.has(candidate)) {
    candidate = `${base}::${index}`;
    index += 1;
  }
  return candidate;
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
  const explicitAliases = [toolCall.commandId, ...entityIds].filter(
    (alias): alias is string => Boolean(alias),
  );
  const explicitEntity = resolveByAliases(session, explicitAliases);
  if (explicitEntity) {
    return explicitEntity;
  }
  const invocationEntity = resolveByAliases(session, [toolCall.id]);
  if (
    invocationEntity &&
    (
      explicitAliases.length === 0 ||
      !invocationEntity.commandId ||
      explicitAliases.some((alias) => sameAlias(alias, invocationEntity.commandId!))
    )
  ) {
    return invocationEntity;
  }
  if (session.running.size !== 1) {
    return undefined;
  }
  const onlyRunning = [...session.running][0];
  return explicitAliases.length === 0 || !onlyRunning?.commandId
    ? onlyRunning
    : undefined;
}

function resolveByAliases(
  session: SessionLifecycle,
  aliases: Array<string | undefined>,
): SubagentEntity | undefined {
  for (const alias of aliases) {
    if (!alias) continue;
    const entity = session.byAlias.get(alias) ?? session.byAlias.get(normalizeAlias(alias));
    if (entity) return entity;
  }
  return undefined;
}

function sameAlias(left: string, right: string): boolean {
  return normalizeAlias(left) === normalizeAlias(right);
}

function normalizeAlias(alias: string): string {
  return alias.startsWith("subagent:") ? alias.slice("subagent:".length) : alias;
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
