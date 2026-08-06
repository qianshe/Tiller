import {
  buildMissionPromptText,
  parseSlashCommandName,
  type MissionPromptContextItem,
} from "@tiller/shared";
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
  draftContexts: MissionPromptContextItem[];
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
  clearDraftContexts: () => void;
  setCommandRetentionNotice?: (value: string | null) => void;
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

type PromptPayload =
  | {
      mode: "slash";
      text: string;
      transcriptText: string;
      content: AgentPromptContent[] | undefined;
      appendedImages: AgentPromptImageContent[];
      tracedImageCount: number;
      preservedContextCount: number;
      preservedImageCount: number;
    }
  | {
      mode: "prompt";
      text: string;
      transcriptText: string;
      content: AgentPromptContent[] | undefined;
      appendedImages: AgentPromptImageContent[];
      tracedImageCount: number;
    };

function buildMissionPromptPayload(input: {
  prompt: string;
  promptImages: AgentPromptImageContent[];
  draftContexts: MissionPromptContextItem[];
}): PromptPayload {
  const trimmedPrompt = input.prompt.trim();
  const slashName = parseSlashCommandName(trimmedPrompt);
  if (slashName) {
    return {
      mode: "slash",
      text: trimmedPrompt,
      // transcriptText 透传 slash 命令本身 —— append/trace 展示用,不走编译。
      transcriptText: trimmedPrompt,
      content: undefined,
      appendedImages: [],
      tracedImageCount: 0,
      preservedContextCount: input.draftContexts.length,
      preservedImageCount: input.promptImages.length,
    };
  }

  const text = input.draftContexts.length
    ? buildMissionPromptText(trimmedPrompt, input.draftContexts)
    : trimmedPrompt;
  // transcriptText 只用于"向用户展示"(乐观消息/trace)。有正文用正文;否则仅当有 draft
  // 时用首条 label 兜底;纯图片(无文本无 draft)留空 —— 让下游 messageText 走"图片 N 张"。
  const transcriptText = trimmedPrompt
    || (input.draftContexts.length ? input.draftContexts[0]!.label : "");
  return {
    mode: "prompt",
    text,
    transcriptText,
    content: buildPromptContent(text, input.promptImages),
    appendedImages: [...input.promptImages],
    tracedImageCount: input.promptImages.length,
  };
}

export function submitPromptRequest(
  input: PromptSubmissionInput,
  dependencies: PromptSubmissionDependencies,
): boolean {
  const payload = buildMissionPromptPayload({
    prompt: input.prompt,
    promptImages: input.promptImages,
    draftContexts: input.draftContexts,
  });
  // 用 transcriptText 判空:纯空 prompt(无 body 无 draft 无图)拒;
  // context-only(draft 非空 → transcriptText=label 兜底)放行。
  // 不用 payload.text 判空 —— 编译串含 marker,trim 恒非空会绕过守卫。
  if (
    payload.mode === "prompt"
    && !payload.transcriptText
    && payload.appendedImages.length === 0
  ) {
    return false;
  }

  const messageText = payload.transcriptText || `图片 ${input.promptImages.length} 张`;
  const content = payload.content;
  dependencies.setImagePasteNotice("");

  if (!input.activeSessionId) {
    // createSession 收编译串 payload.text —— 它内部直接转发给 ACP session/prompt,
    // 必须是编译串 review-context 才能送达模型。messageText(展示用)不进 RPC。
    if (dependencies.createSession(payload.text, content)) {
      dependencies.setPrompt("");
      if (payload.mode === "prompt") {
        dependencies.setPromptImages([]);
        dependencies.clearDraftContexts();
        dependencies.setCommandRetentionNotice?.(null);
      } else {
        dependencies.setCommandRetentionNotice?.(
          `已仅发送命令，${payload.preservedContextCount} 条评论上下文和 ${payload.preservedImageCount} 张图片仍保留在输入框。`,
        );
      }
      return true;
    }
    return false;
  }

  if (input.activeSessionCanChat === false) {
    return false;
  }

  if (payload.mode === "prompt") {
    dependencies.setCommandRetentionNotice?.(null);
  } else {
    dependencies.setCommandRetentionNotice?.(
      `已仅发送命令，${payload.preservedContextCount} 条评论上下文和 ${payload.preservedImageCount} 张图片仍保留在输入框。`,
    );
  }

  const activeSessionId = input.activeSessionId;
  const clientMessageId = dependencies.createClientUserMessageId(activeSessionId);
  dependencies.tracePromptSubmit?.({
    traceId: clientMessageId,
    sessionId: activeSessionId,
    text: messageText,        // 展示用(可读 label 兜底,context-only 不漏 marker)
    imageCount: payload.tracedImageCount,
  });
  dependencies.setPrompt("");
  if (payload.mode === "prompt") {
    dependencies.setPromptImages([]);
    dependencies.clearDraftContexts();
  }
  const appendedImages = payload.appendedImages;
  const dispatchPrompt = async () => {
    const result = await dependencies.dispatch(dependencies.client, "session/prompt", {
      sessionId: activeSessionId,
      text: payload.text,      // RPC:编译串(含 marker),让 review-context 送达模型
      content,
      clientMessageId,
    });
    if (isSentPromptResult(result)) {
      dependencies.appendExistingSessionPrompt(
        activeSessionId,
        messageText,            // 展示用 optimistic 文本
        clientMessageId,
        appendedImages,
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
