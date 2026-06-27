import type { AgentRuntimePort } from "../ports/agent-runtime-port";
import type {
  PromptQueuePort,
  SessionSummaryProjectorPort,
} from "../ports/session-store-port";

export type SendPromptInput<Content = unknown> = {
  sessionId: string;
  text: string;
  content?: Content[];
  clientMessageId?: string;
};

export type SendPromptQueuedResult<QueueItem = unknown> = {
  accepted: "queued";
  queueItem: QueueItem;
};

export type SendPromptSentResult = {
  accepted: "sent";
};

export type SendPromptResult<QueueItem = unknown> =
  | SendPromptQueuedResult<QueueItem>
  | SendPromptSentResult;

export type SendPromptUseCaseDependencies<QueueItem = unknown, QueueSnapshot = unknown, Message = unknown, Content = unknown> = {
  runtime: Pick<AgentRuntimePort, "prompt">;
  promptQueue: PromptQueuePort<QueueItem, QueueSnapshot, Content>;
  projector: SessionSummaryProjectorPort<Message>;
  createUserMessage(input: {
    sessionId: string;
    text: string;
    content?: Content[];
    clientMessageId: string;
    timestamp: string;
  }): Message;
  onQueueChanged(sessionId: string, snapshot: QueueSnapshot): Promise<void> | void;
  onPromptFailed(sessionId: string, error: unknown): Promise<void> | void;
  onPromptSettled(sessionId: string, queueItem: QueueItem): Promise<void> | void;
  shouldQueue?(sessionId: string): boolean;
  now?(): Date;
  createClientMessageId?(sessionId: string): string;
};

export class SendPromptUseCase<QueueItem = unknown, QueueSnapshot = unknown, Message = unknown, Content = unknown> {
  constructor(
    private readonly dependencies: SendPromptUseCaseDependencies<QueueItem, QueueSnapshot, Message, Content>,
  ) {}

  async execute(input: SendPromptInput<Content>): Promise<SendPromptResult<QueueItem>> {
    const clientMessageId = input.clientMessageId ?? this.createClientMessageId(input.sessionId);
    const queueInput = {
      sessionId: input.sessionId,
      text: input.text,
      content: input.content,
      clientMessageId,
    };

    if (
      this.dependencies.promptQueue.hasInFlight(input.sessionId) ||
      this.dependencies.shouldQueue?.(input.sessionId)
    ) {
      const queueItem = this.dependencies.promptQueue.enqueue(queueInput);
      await this.publishQueue(input.sessionId);
      return { accepted: "queued", queueItem };
    }

    const queueItem = this.dependencies.promptQueue.markInFlight(queueInput);
    await this.publishQueue(input.sessionId);
    void this.sendInBackground({ ...queueInput, clientMessageId }, queueItem);
    return { accepted: "sent" };
  }

  private async sendInBackground(input: Required<Pick<SendPromptInput<Content>, "sessionId" | "text">> & {
    content?: Content[];
    clientMessageId: string;
  }, queueItem: QueueItem): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      const timestamp = this.nowIso();
      const message = this.dependencies.createUserMessage({ ...input, timestamp });
      await this.dependencies.projector.appendUserMessage(input.sessionId, message);
      await this.dependencies.runtime.prompt(input);
    } catch (error) {
      await this.dependencies.onPromptFailed(input.sessionId, error);
    } finally {
      await this.dependencies.onPromptSettled(input.sessionId, queueItem);
    }
  }

  private async publishQueue(sessionId: string): Promise<void> {
    await this.dependencies.onQueueChanged(
      sessionId,
      this.dependencies.promptQueue.snapshot(sessionId),
    );
  }

  private nowIso(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }

  private createClientMessageId(sessionId: string): string {
    return this.dependencies.createClientMessageId?.(sessionId) ?? `${sessionId}-user-${Date.now()}`;
  }
}
