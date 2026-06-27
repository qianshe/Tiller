import type { SessionUpdateRecord, SessionUpdateRecordPage } from "@tiller/shared";
import type { HelmHandlerContext } from "../context";

export type ListSessionUpdatesParams = {
  sessionId: string;
  limit?: number;
  before?: string;
};

type SessionUpdateStore = {
  listPage: (
    sessionId: string,
    options?: { limit?: number; before?: string },
  ) => SessionUpdateRecordPage;
};

export async function listSessionUpdates(
  params: ListSessionUpdatesParams,
  context: HelmHandlerContext,
): Promise<{
  ok: boolean;
  sessionId: string;
  updates: SessionUpdateRecord[];
  nextCursor?: string;
  hasMore: boolean;
  message?: string;
}> {
  await context.refreshAuthoritativeSessionHistory(params.sessionId);
  const store = resolveSessionUpdateStore(context);
  if (!store) {
    return {
      ok: false,
      sessionId: params.sessionId,
      updates: [],
      hasMore: false,
      message: "Session update store not available",
    };
  }

  const page = store.listPage(params.sessionId, {
    limit: params.limit,
    before: params.before,
  });

  return {
    ok: true,
    sessionId: params.sessionId,
    updates: page.updates,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

function resolveSessionUpdateStore(context: HelmHandlerContext): SessionUpdateStore | null {
  const store = context.sessionUpdateStore as Partial<SessionUpdateStore> | undefined;
  return typeof store?.listPage === "function" ? (store as SessionUpdateStore) : null;
}
