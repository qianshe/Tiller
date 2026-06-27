import type { SessionSummary } from "@tiller/domain-contracts";

export type SessionStorePort = {
  get(sessionId: string): Promise<SessionSummary | undefined>;
  upsert(session: SessionSummary): Promise<void>;
  remove(sessionId: string): Promise<void>;
};

export type MessageStorePort<Message = unknown> = {
  append(sessionId: string, message: Message): Promise<void>;
  listPage(sessionId: string, options: { limit?: number; before?: string }): Promise<{
    messages: Message[];
    nextCursor?: string;
    hasMore: boolean;
  }>;
};

export type PromptQueueInput<Content = unknown> = {
  sessionId: string;
  text: string;
  content?: Content[];
  clientMessageId: string;
};

export type PromptQueuePort<QueueItem = unknown, QueueSnapshot = unknown, Content = unknown> = {
  hasInFlight(sessionId: string): boolean;
  enqueue(input: PromptQueueInput<Content>): QueueItem;
  markInFlight(input: PromptQueueInput<Content>): QueueItem;
  snapshot(sessionId: string): QueueSnapshot;
};

export type SessionSummaryProjectorPort<Message = unknown> = {
  appendUserMessage(sessionId: string, message: Message): Promise<void>;
};