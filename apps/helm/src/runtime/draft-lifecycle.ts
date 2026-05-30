import type { RuntimeDraft, RuntimeDraftReason } from "./draft-registry";

export type DraftRuntimeCleanupOptions = {
  draft: RuntimeDraft;
  reason: RuntimeDraftReason;
  activeDrafts: number;
  cleanupDraftRuntime: RuntimeDraft["runtime"] extends infer Runtime
    ? (runtime: Runtime, agent: RuntimeDraft["agent"]) => Promise<unknown>
    : never;
  logInfo(message: string): void;
};

export async function performDraftRuntimeCleanup(options: DraftRuntimeCleanupOptions) {
  const cleanup = await options.cleanupDraftRuntime(options.draft.runtime, options.draft.agent);
  const cleanupKind =
    cleanup && typeof cleanup === "object" && "kind" in cleanup
      ? String((cleanup as { kind: unknown }).kind)
      : "unknown";
  options.logInfo(
    `[tiller] draft.discard draft=${options.draft.draftId} deck=${options.draft.deckClientId} reason=${options.reason} runtime=${options.draft.runtime.runtimeSessionId} provider=${options.draft.agent.id} cleanup=${cleanupKind} activeDrafts=${options.activeDrafts}`,
  );
  return cleanup;
}
