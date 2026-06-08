import { readAdapterTranscriptPlan } from "@tiller/acp-runtime";
import type { AcpAgentProvider, AgentPlan, SessionSummary, SessionUpdateRecord } from "@tiller/shared";
import type { TillerLogger } from "../../logging/logger";

type SessionUpdateStore = {
  listPage(sessionId: string, options: { limit?: number }): { updates: SessionUpdateRecord[] };
  append(record: SessionUpdateRecord): void;
};

export function readAdapterTranscriptPlanRepair(input: {
  summary: SessionSummary;
  agent: AcpAgentProvider | undefined;
  logger?: Pick<TillerLogger, "debug">;
}): AgentPlan | null {
  const { summary, agent, logger } = input;
  if (!summary.runtimeSessionId || !agent) {
    return null;
  }
  try {
    const plan = readAdapterTranscriptPlan({
      provider: agent,
      runtimeSessionId: summary.runtimeSessionId,
      cwd: summary.cwd,
    });
    if (plan) {
      logger?.debug("runtime.history_cache.adapter_transcript_plan_repaired", {
        sessionId: summary.id,
        providerId: agent.id,
        runtimeSessionId: summary.runtimeSessionId,
        entries: plan.entries.length,
      });
    }
    return plan;
  } catch (error) {
    logger?.debug("runtime.history_cache.adapter_transcript_plan_repair_failed", {
      sessionId: summary.id,
      providerId: agent.id,
      runtimeSessionId: summary.runtimeSessionId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function appendTranscriptRepairPlanUpdate(input: {
  sessionId: string;
  summary: SessionSummary;
  agent: AcpAgentProvider | undefined;
  plan: AgentPlan;
  sessionUpdateStore: SessionUpdateStore;
}) {
  const { sessionId, summary, agent, plan, sessionUpdateStore } = input;
  const latest = sessionUpdateStore.listPage(sessionId, { limit: 1 }).updates[0];
  const record: SessionUpdateRecord = {
    sessionId,
    runtimeSessionId: summary.runtimeSessionId ?? sessionId,
    providerId: agent?.id ?? summary.agentId,
    sequence: (latest?.sequence ?? 0) + 1,
    source: "agent_transcript_repair",
    updateType: "plan-update",
    receivedAt: new Date().toISOString(),
    payloadJson: JSON.stringify({ type: "plan-update", plan }),
  };
  sessionUpdateStore.append(record);
}
