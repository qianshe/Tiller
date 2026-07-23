import type { AgentMessage, AgentPromptContent } from "@tiller/shared";
import type { SessionAttachmentStore } from "../../sessions/facade";

export type PersistPromptImageAttachmentsInput = {
  sessionId: string;
  messageId: string;
  content: AgentPromptContent[];
  attachments: SessionAttachmentStore;
};

export function persistPromptImageAttachments(
  input: PersistPromptImageAttachmentsInput,
): AgentPromptContent[] {
  return input.content.map((item) => {
    if (item.type !== "image" || !item.data) {
      return item;
    }

    const stored = input.attachments.put({
      sessionId: input.sessionId,
      messageId: input.messageId,
      mimeType: item.mimeType,
      name: item.name,
      dataBase64: item.data,
    });

    return {
      type: "image",
      mimeType: stored.mimeType,
      ...(stored.name ? { name: stored.name } : {}),
      uri: stored.uri,
      attachmentId: stored.id,
      sha256: stored.sha256,
      byteSize: stored.byteSize,
    };
  });
}

export function persistMessageImageAttachments(input: {
  sessionId: string;
  message: AgentMessage;
  attachments: SessionAttachmentStore;
}): AgentMessage {
  if (!input.message.attachments?.length) {
    return input.message;
  }

  const attachments = persistPromptImageAttachments({
    sessionId: input.sessionId,
    messageId: input.message.id,
    content: input.message.attachments,
    attachments: input.attachments,
  }).filter((item) => item.type === "image");

  return {
    ...input.message,
    ...(attachments.length ? { attachments } : {}),
  };
}

export function hydratePromptImageAttachments(input: {
  sessionId: string;
  content?: AgentPromptContent[];
  attachments: SessionAttachmentStore;
}): AgentPromptContent[] | undefined {
  if (!input.content?.length) {
    return input.content;
  }

  return input.content.map((item) => {
    if (item.type !== "image" || item.data) {
      return item;
    }
    if (!item.attachmentId) {
      throw new Error("Prompt image attachment is unavailable.");
    }
    const stored = input.attachments.get(item.attachmentId);
    const bytes = input.attachments.readBytes(item.attachmentId);
    if (!stored || stored.sessionId !== input.sessionId || !bytes) {
      throw new Error("Prompt image attachment is unavailable.");
    }
    return {
      ...item,
      data: bytes.toString("base64"),
    };
  });
}

export function collectPromptAttachmentIds(content?: AgentPromptContent[]): string[] {
  return content
    ?.flatMap((item) => item.type === "image" && item.attachmentId ? [item.attachmentId] : [])
    ?? [];
}
