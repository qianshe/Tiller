import type { AvailableCommand, SessionSummary } from "@tiller/shared";

export function deriveAvailableCommandMapsFromSessions(sessions: SessionSummary[]) {
  const bySession: Record<string, AvailableCommand[]> = {};
  const byAgent: Record<string, AvailableCommand[]> = {};
  for (const session of sessions) {
    const commands = session.availableCommands ?? [];
    if (commands.length === 0) {
      continue;
    }
    bySession[session.id] = commands;
    byAgent[session.agentId] = commands;
  }
  return { bySession, byAgent };
}
