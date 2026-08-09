import type { AgentToolCall } from "@tiller/shared";
import type { ToolEvidence, ToolObservation } from "./types";

type SubagentEntity = {
  id: string;
  title: string;
  titleRank?: number;
  openCodeCategory?: string;
  input?: string;
  output?: string;
  subagentRole?: AgentToolCall["subagentRole"];
  commandId?: string;
  operation?: AgentToolCall["subagentOperation"];
  timestamp: string;
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
      const lifecycleOnly = semantic?.subagent?.lifecycleOnly === true;
      const lifecycleToolCall = lifecycleOnly && toolCall.kind !== "subagent"
        ? { ...toolCall, kind: "subagent" as const }
        : toolCall;
      if (toolCall.subagentOperation && observation.sessionId) {
        const session = resolveSessionLifecycle(
          sessions,
          observation.providerId,
          observation.sessionId,
        );
        return projectSubagentOperation(
          session,
          toolCall,
          semantic?.subagent,
          observation.providerId,
        );
      }
      if (toolCall.subagentOperation) {
        return [toolCall];
      }
      if (lifecycleToolCall.kind !== "subagent" || !semantic?.subagent || !observation.sessionId) {
        return [toolCall];
      }
      const session = resolveSessionLifecycle(
        sessions,
        observation.providerId,
        observation.sessionId,
      );
      const { action, batch, entityIds, background, terminal, existingOnly } = semantic.subagent;
      const finish = (calls: AgentToolCall[]) => lifecycleOnly ? [toolCall, ...calls] : calls;
      if (action === "spawn") {
        const ids = entityIds.length ? entityIds : [lifecycleToolCall.id];
        if (!batch || ids.length === 1) {
          const entityId = ids[0] ?? lifecycleToolCall.id;
          const commandId = lifecycleToolCall.commandId ??
            (entityIds.length ? `subagent:${entityId}` : undefined);
          const existing = isOpenCodeProvider(observation.providerId)
            ? resolveOpenCodeSpawnEntity(session, lifecycleToolCall, commandId, entityIds)
            : resolveByAliases(session, [lifecycleToolCall.commandId, ...entityIds])
              ?? resolveCompatibleSpawnAlias(session, lifecycleToolCall, commandId)
              ?? resolveOnlyUnidentifiedSpawn(session, entityIds, lifecycleToolCall);
          if (!existing && hasAmbiguousUnidentifiedSpawns(session, entityIds, lifecycleToolCall)) {
            return lifecycleOnly ? [toolCall] : [];
          }
          const entity = existing ?? {
            id: resolveNewEntityId(session, lifecycleToolCall, entityId),
            title: lifecycleToolCall.title,
            input: lifecycleToolCall.input,
            timestamp: lifecycleToolCall.timestamp,
            aliases: new Set<string>(),
          };
          updateSubagentEntityTitle(entity, lifecycleToolCall, observation.providerId);
          entity.input = lifecycleToolCall.input ?? entity.input;
          entity.output = lifecycleToolCall.output ?? entity.output;
          entity.commandId = entity.commandId ?? commandId;
          addAliases(session, entity, [entity.id, lifecycleToolCall.id, ...ids, entity.commandId]);
          session.running.add(entity);
          return finish([{
            ...lifecycleToolCall,
            id: entity.id,
            title: entity.title,
            ...(entity.commandId ? { commandId: entity.commandId } : {}),
            status: background || entityIds.length || lifecycleToolCall.status === "completed" ? "running" : lifecycleToolCall.status,
          }]);
        }
        return finish(ids.map((entityId, index) => {
          const existing = session.byAlias.get(entityId);
          const id = existing?.id ?? `${lifecycleToolCall.id}::${entityId}`;
          const commandId = entityId === lifecycleToolCall.id && !lifecycleToolCall.commandId
            ? undefined
            : `subagent:${entityId}`;
          const entity = existing ?? {
            id,
            title: lifecycleToolCall.title,
            input: lifecycleToolCall.input,
            timestamp: lifecycleToolCall.timestamp,
            aliases: new Set<string>(),
          };
          updateSubagentEntityTitle(entity, lifecycleToolCall, observation.providerId);
          entity.input = lifecycleToolCall.input ?? entity.input;
          entity.output = lifecycleToolCall.output ?? entity.output;
          entity.commandId = entity.commandId ?? commandId ?? lifecycleToolCall.commandId;
          addAliases(
            session,
            entity,
            [entity.id, entityId, entity.commandId],
          );
          session.running.add(entity);
          return {
            ...lifecycleToolCall,
            id: entity.id,
            title: entity.title,
            ...(entity.commandId ? { commandId: entity.commandId } : {}),
            status: background || entityIds.length || lifecycleToolCall.status === "completed" ? "running" : lifecycleToolCall.status,
            ...(index > 0 ? { timestamp: lifecycleToolCall.timestamp } : {}),
          };
        }));
      }

      const entity = resolveEntity(
        session,
        entityIds,
        lifecycleToolCall,
        observation.providerId,
      );
      if (!entity) {
        if (existingOnly) {
          return [toolCall];
        }
        const resolvedCommandId = lifecycleToolCall.commandId ??
          (entityIds[0] ? `subagent:${entityIds[0]}` : undefined);
        return finish([{
          ...lifecycleToolCall,
          id: session.byAlias.has(lifecycleToolCall.id)
            ? resolveNewEntityId(session, lifecycleToolCall, resolvedCommandId ?? lifecycleToolCall.id)
            : lifecycleToolCall.id,
          ...(resolvedCommandId ? { commandId: resolvedCommandId } : {}),
          status: terminalStatus(action, terminal, lifecycleToolCall.status),
        }]);
      }
      const resolvedCommandId = entity.commandId ?? lifecycleToolCall.commandId ??
        (entityIds[0] ? `subagent:${entityIds[0]}` : undefined);
      updateSubagentEntityTitle(entity, lifecycleToolCall, observation.providerId);
      entity.input = lifecycleToolCall.input ?? entity.input;
      entity.output = lifecycleToolCall.output ?? entity.output;
      entity.commandId = resolvedCommandId;
      addAliases(session, entity, [...entityIds, lifecycleToolCall.id, resolvedCommandId]);
      const status = terminalStatus(action, terminal, lifecycleToolCall.status);
      if (["completed", "failed", "cancelled"].includes(status)) {
        session.running.delete(entity);
      } else {
        session.running.add(entity);
      }
      return finish([{
        ...lifecycleToolCall,
        id: entity.id,
        title: entity.title,
        ...(entity.input && !lifecycleToolCall.input ? { input: entity.input } : {}),
        ...(entity.output && !lifecycleToolCall.output ? { output: entity.output } : {}),
        ...(resolvedCommandId ? { commandId: resolvedCommandId } : {}),
        status,
      }]);
    },
    dispose(providerId: string | undefined, sessionId: string): void {
      sessions.delete(`${providerId ?? "generic"}\u001f${sessionId}`);
    },
  };
}

function resolveSessionLifecycle(
  sessions: Map<string, SessionLifecycle>,
  providerId: string | undefined,
  sessionId: string,
): SessionLifecycle {
  const sessionKey = `${providerId ?? "generic"}\u001f${sessionId}`;
  const session = sessions.get(sessionKey) ?? { byAlias: new Map(), running: new Set() };
  sessions.set(sessionKey, session);
  return session;
}

function projectSubagentOperation(
  session: SessionLifecycle,
  toolCall: AgentToolCall,
  semantic: ToolEvidence["subagent"] | undefined,
  providerId?: string,
): AgentToolCall[] {
  const operation = toolCall.subagentOperation!;
  const targetIds = operation.targets.map((target) => target.id).filter(Boolean);
  const codex = isCodexProvider(providerId);
  if (operation.action === "spawn") {
    const entity = resolveByAliases(session, [toolCall.id, ...targetIds]) ?? {
      id: toolCall.id,
      title: toolCall.title,
      input: toolCall.input,
      commandId: toolCall.commandId,
      operation,
      timestamp: toolCall.timestamp,
      aliases: new Set<string>(),
    };
    entity.title = toolCall.title;
    entity.input = toolCall.input ?? entity.input;
    entity.output = toolCall.output ?? entity.output;
    entity.subagentRole = toolCall.subagentRole ?? entity.subagentRole;
    entity.commandId = toolCall.commandId ?? entity.commandId;
    entity.operation = operation;
    addAliases(session, entity, [entity.id, toolCall.id, entity.commandId, ...targetIds]);
    // Codex reports the spawn command as completed when the child is created;
    // the child itself remains active until wait/close reports its state.
    if (codex || isActiveStatus(toolCall.status)) {
      session.running.add(entity);
    } else {
      session.running.delete(entity);
    }
    return [
      codex && toolCall.status === "completed"
        ? { ...toolCall, status: "running" }
        : toolCall,
    ];
  }

  if (codex) {
    return projectCodexSubagentOperation(session, toolCall, semantic, targetIds);
  }

  const targetStatus = resolveOperationTargetStatus(semantic);
  if (!targetStatus) {
    return [toolCall];
  }
  const entities = targetIds
    .map((targetId) => resolveByAliases(session, [targetId]))
    .filter((entity): entity is SubagentEntity => Boolean(entity));
  const uniqueEntities = [...new Set(entities)].filter((entity) => session.running.has(entity));
  const updates = uniqueEntities.map((entity): AgentToolCall => {
    session.running.delete(entity);
    return {
      id: entity.id,
      kind: "subagent",
      title: entity.title,
      status: targetStatus,
      ...(entity.commandId ? { commandId: entity.commandId } : {}),
      ...(entity.input ? { input: entity.input } : {}),
      ...(entity.operation ? { subagentOperation: entity.operation } : {}),
      timestamp: entity.timestamp,
      updatedAt: toolCall.updatedAt,
    };
  });
  return [...updates, toolCall];
}

function projectCodexSubagentOperation(
  session: SessionLifecycle,
  toolCall: AgentToolCall,
  semantic: ToolEvidence["subagent"] | undefined,
  targetIds: string[],
): AgentToolCall[] {
  // A wait/close operation with multiple targets carries aggregate output. Keep
  // it as an operation row unless its payload can be safely split per target.
  if (targetIds.length !== 1) {
    return [toolCall];
  }
  const targetId = targetIds[0];
  if (!targetId) {
    return [toolCall];
  }
  const entity = resolveByAliases(session, [targetId]);
  if (!entity) {
    return [toolCall];
  }

  const operation = toolCall.subagentOperation!;
  const terminalStatus = resolveOperationTargetStatus(semantic);
  const status = terminalStatus ??
    (toolCall.status === "failed" || toolCall.status === "cancelled"
      ? toolCall.status
      : "running");
  const output = resolveCodexOperationOutput(toolCall, targetId) ?? entity.output;
  entity.output = output ?? entity.output;
  entity.subagentRole = toolCall.subagentRole ?? entity.subagentRole;
  entity.operation = operation;
  addAliases(session, entity, [toolCall.id, ...targetIds, toolCall.commandId]);
  if (isActiveStatus(status)) {
    session.running.add(entity);
  } else {
    session.running.delete(entity);
  }

  return [{
    ...toolCall,
    id: entity.id,
    kind: "subagent",
    title: entity.title,
    status,
    timestamp: entity.timestamp,
    ...(entity.commandId ?? toolCall.commandId
      ? { commandId: entity.commandId ?? toolCall.commandId }
      : {}),
    ...(entity.input ?? toolCall.input ? { input: entity.input ?? toolCall.input } : {}),
    ...(output ? { output } : {}),
    ...(entity.subagentRole ? { subagentRole: entity.subagentRole } : {}),
    subagentOperation: operation,
  }];
}

function resolveCodexOperationOutput(toolCall: AgentToolCall, targetId: string) {
  const directOutput = toolCall.output?.trim();
  if (directOutput && !parseJsonRecord(directOutput)) {
    return directOutput;
  }
  for (const source of [toolCall.output, toolCall.input]) {
    const record = source ? parseJsonRecord(source) : null;
    const states = recordValue(record?.agentsStates ?? record?.agents_states);
    const target = recordValue(states?.[targetId]);
    const output = firstString(
      target?.message,
      target?.output,
      target?.result,
      target?.completed,
      target?.failed,
      target?.cancelled,
    );
    if (output) {
      return output;
    }
  }
  return directOutput || undefined;
}

function isCodexProvider(providerId: string | undefined) {
  return /^codex(?:-|$)/iu.test(providerId?.trim() ?? "");
}

function isOpenCodeProvider(providerId: string | undefined) {
  return providerId?.trim().toLowerCase() === "opencode";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function updateSubagentEntityTitle(
  entity: SubagentEntity,
  incoming: AgentToolCall,
  providerId?: string,
) {
  if (isOpenCodeProvider(providerId)) {
    const category = resolveOpenCodeCategory(incoming) ?? entity.openCodeCategory;
    if (category) {
      entity.openCodeCategory = category;
      entity.title = category;
      entity.titleRank = 500;
      return;
    }
  }
  const currentTitle = entity.title?.trim() ?? "";
  const incomingTitle = incoming.title?.trim() ?? "";
  const currentRank = entity.titleRank ?? resolveSubagentTitleRank({
    id: entity.id,
    title: currentTitle,
    input: entity.input,
  });
  const incomingRank = resolveSubagentTitleRank(incoming);
  if (
    incomingRank > currentRank ||
    (isWeakSubagentTitle(currentTitle, entity.id) && !isWeakSubagentTitle(incomingTitle, incoming.id))
  ) {
    entity.title = incomingTitle || currentTitle || entity.id;
    entity.titleRank = incomingRank;
    return;
  }
  entity.title = currentTitle || incomingTitle || entity.id;
  entity.titleRank = currentRank;
}

function resolveOpenCodeCategory(toolCall: Pick<AgentToolCall, "input">) {
  const input = toolCall.input ? parseJsonRecord(toolCall.input) : null;
  return firstString(input?.category);
}

function resolveSubagentTitleRank(
  toolCall: Pick<AgentToolCall, "id" | "title" | "input" | "output">,
) {
  if (isWeakSubagentTitle(toolCall.title, toolCall.id)) {
    return 0;
  }
  const input = toolCall.input ? parseJsonRecord(toolCall.input) : null;
  const output = toolCall.output ? parseJsonRecord(toolCall.output) : null;
  const records = [input, output].filter(
    (record): record is Record<string, unknown> => Boolean(record),
  );
  if (
    records.some((record) =>
      hasSubagentIdentityField(record, ["agent", "agent_name", "agentName"]),
    )
  ) {
    return 400;
  }
  if (
    records.some((record) =>
      hasSubagentIdentityField(record, [
        "subagent_type",
        "subagentType",
      ]),
    )
  ) {
    return 300;
  }
  if (
    records.some((record) => hasSubagentIdentityField(record, ["category"]))
  ) {
    return 200;
  }
  if (
    records.some((record) =>
      hasSubagentIdentityField(record, ["description", "prompt"]),
    )
  ) {
    return 100;
  }
  return 100;
}

function hasSubagentIdentityField(record: Record<string, unknown>, fields: string[]) {
  return fields.some(
    (field) => typeof record[field] === "string" && Boolean(record[field]?.trim()),
  );
}

function isWeakSubagentTitle(title: string, id: string) {
  const normalized = title.trim();
  return !normalized ||
    normalized === id ||
    /^call_[A-Za-z0-9]+$/u.test(normalized) ||
    /^Tool call\b/iu.test(normalized) ||
    /^task$/iu.test(normalized);
}

function resolveOperationTargetStatus(
  semantic: ToolEvidence["subagent"] | undefined,
): Extract<AgentToolCall["status"], "completed" | "failed" | "cancelled"> | undefined {
  if (!semantic?.terminal) {
    return undefined;
  }
  if (semantic.terminalStatus) {
    return semantic.terminalStatus;
  }
  return semantic.action === "cancel" ? "cancelled" : "completed";
}

function isActiveStatus(status: AgentToolCall["status"]): boolean {
  return status === "pending" || status === "running" || status === "waiting_for_permission";
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
  if (
    !commandId && entity.input && toolCall.input &&
    !isStreamingInputGrowth(entity.input, toolCall.input)
  ) {
    return undefined;
  }
  return entity;
}

function resolveOpenCodeSpawnEntity(
  session: SessionLifecycle,
  toolCall: AgentToolCall,
  commandId: string | undefined,
  entityIds: string[],
) {
  // A task/session id is a reusable logical identity in OpenCode, not the
  // identity of this launch. Reuse the provider tool id for lifecycle updates;
  // a different launch must get a new entity even when its task id is reused.
  return resolveCompatibleSpawnAlias(session, toolCall, commandId) ??
    (commandId || entityIds.length ? resolveOpenCodeInputEntity(session, toolCall) : undefined) ??
    resolveOnlyUnidentifiedSpawn(session, entityIds, toolCall);
}

function isStreamingInputGrowth(previous: string, next: string): boolean {
  if (next === previous || next.startsWith(previous)) {
    return true;
  }
  const previousRecord = parseJsonRecord(previous);
  const nextRecord = parseJsonRecord(next);
  if (!previousRecord || !nextRecord) {
    return false;
  }
  return Object.entries(previousRecord).every(([key, value]) =>
    key in nextRecord && JSON.stringify(nextRecord[key]) === JSON.stringify(value)
  );
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
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
  providerId?: string,
): SubagentEntity | undefined {
  if (isOpenCodeProvider(providerId)) {
    const invocationEntity = resolveByAliases(session, [toolCall.id]);
    const explicitAliases = [toolCall.commandId, ...entityIds].filter(
      (alias): alias is string => Boolean(alias),
    );
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
    const explicitEntity = resolveRunningByAliases(session, explicitAliases);
    if (explicitEntity) {
      return explicitEntity;
    }
    const inputEntity = resolveOpenCodeInputEntity(session, toolCall);
    if (inputEntity) {
      return inputEntity;
    }
    if (session.running.size !== 1) {
      return undefined;
    }
    const onlyRunning = [...session.running][0];
    return onlyRunning && !onlyRunning.commandId ? onlyRunning : undefined;
  }

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

function resolveOpenCodeInputEntity(
  session: SessionLifecycle,
  toolCall: AgentToolCall,
): SubagentEntity | undefined {
  const incomingInputs = resolveOpenCodeInputIdentities(toolCall.input);
  if (incomingInputs.length === 0) {
    return undefined;
  }
  const matches = [...session.running].filter((entity) => {
    const entityInputs = resolveOpenCodeInputIdentities(entity.input);
    return entityInputs.some((input) => incomingInputs.includes(input));
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function resolveOpenCodeInputIdentities(input: string | undefined): string[] {
  const record = input ? parseJsonRecord(input) : null;
  if (!record) {
    return input?.trim() ? [normalizeOpenCodeInputIdentity(input)] : [];
  }
  return [record.prompt, record.description, record.message]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map(normalizeOpenCodeInputIdentity)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function normalizeOpenCodeInputIdentity(input: string): string {
  return input.replace(/\s+/gu, " ").trim();
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

function resolveRunningByAliases(
  session: SessionLifecycle,
  aliases: Array<string | undefined>,
): SubagentEntity | undefined {
  const entity = resolveByAliases(session, aliases);
  return entity && session.running.has(entity) ? entity : undefined;
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
