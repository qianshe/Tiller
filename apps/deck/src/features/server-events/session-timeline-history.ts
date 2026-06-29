import type { SessionTimelineEntry } from "@tiller/shared";

export type SessionTimelineHistoryPage = {
  sessionId: string;
  entries: SessionTimelineEntry[];
  nextCursor?: string;
  hasMore: boolean;
};

export type LoadSessionTimelineHistoryOptions = {
  sessionId: string;
  limit?: number;
  before?: string;
};

export type SessionTimelineHistoryLoader = {
  load(options: LoadSessionTimelineHistoryOptions): Promise<SessionTimelineHistoryPage>;
};

export function createSessionTimelineHistoryLoader(
  request: (method: string, params: unknown) => Promise<unknown>,
): SessionTimelineHistoryLoader {
  return {
    async load(options) {
      const result = await request("session/list_timeline", {
        sessionId: options.sessionId,
        limit: options.limit,
        before: options.before,
      }) as SessionTimelineHistoryPage;
      return result;
    },
  };
}
