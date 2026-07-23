import type {
  AgentPromptContent,
  AgentPromptImageContent,
} from "@tiller/shared";
import type { DeckRpcClient, DispatchToHelm } from "../../helm-connection/facade";

export type PromptSubmitTraceInput = {
  traceId: string;
  sessionId: string;
  text: string;
  imageCount: number;
};

export type PromptSubmissionInput = {
  prompt: string;
  promptImages: AgentPromptImageContent[];
  activeSessionId: string | null;
  activeSessionCanChat?: boolean;
};

export type PromptSubmissionDependencies = {
  client: DeckRpcClient;
  createSession: (
    initialPrompt?: string,
    initialContent?: AgentPromptContent[],
  ) => boolean;
  setImagePasteNotice: (value: string) => void;
  setPrompt: (value: string) => void;
  setPromptImages: (images: AgentPromptImageContent[]) => void;
  createClientUserMessageId: (sessionId: string) => string;
  appendExistingSessionPrompt: (
    sessionId: string,
    text: string,
    id: string,
    images: AgentPromptImageContent[],
  ) => void;
  dispatch: DispatchToHelm;
  tracePromptSubmit?: (input: PromptSubmitTraceInput) => void;
  prepareExistingSessionPrompt?: (sessionId: string) => Promise<void>;
};

export function buildPromptContent(
  text: string,
  images: AgentPromptImageContent[],
): AgentPromptContent[] | undefined {
  if (!images.length) {
    return undefined;
  }
  return [...(text ? [{ type: "text" as const, text }] : []), ...images];
}

function isSentPromptResult(result: unknown): result is { accepted: "sent" } {
  return Boolean(
    result &&
    typeof result === "object" &&
    "accepted" in result &&
    result.accepted === "sent",
  );
}

export function submitPromptRequest(
  input: PromptSubmissionInput,
  dependencies: PromptSubmissionDependencies,
): boolean {
  const nextPrompt = input.prompt.trim();
  if (!nextPrompt && !input.promptImages.length) {
    return false;
  }

  const messageText = nextPrompt || `图片 ${input.promptImages.length} 张`;
  const content = buildPromptContent(nextPrompt, input.promptImages);
  dependencies.setImagePasteNotice("");

  if (!input.activeSessionId) {
    if (dependencies.createSession(messageText, content)) {
      dependencies.setPrompt("");
      dependencies.setPromptImages([]);
      return true;
    }
    return false;
  }

  if (input.activeSessionCanChat === false) {
    return false;
  }

  const activeSessionId = input.activeSessionId;
  const clientMessageId = dependencies.createClientUserMessageId(activeSessionId);
  dependencies.tracePromptSubmit?.({
    traceId: clientMessageId,
    sessionId: activeSessionId,
    text: messageText,
    imageCount: input.promptImages.length,
  });
  dependencies.setPrompt("");
  dependencies.setPromptImages([]);
  const images = [...input.promptImages];
  const dispatchPrompt = async () => {
    const result = await dependencies.dispatch(dependencies.client, "session/prompt", {
      sessionId: activeSessionId,
      text: messageText,
      content,
      clientMessageId,
    });
    if (isSentPromptResult(result)) {
      dependencies.appendExistingSessionPrompt(
        activeSessionId,
        messageText,
        clientMessageId,
        images,
      );
    }
  };
  if (dependencies.prepareExistingSessionPrompt) {
    void (async () => {
      try {
        await dependencies.prepareExistingSessionPrompt?.(activeSessionId);
      } catch {
        // Best effort: a missed subscription should not block the prompt itself.
      }
      await dispatchPrompt();
    })();
  } else {
    void dispatchPrompt();
  }
  return true;
}
