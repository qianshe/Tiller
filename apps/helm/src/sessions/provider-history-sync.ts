import type { AgentMessage } from "@tiller/shared";

export function mergeAuthoritativeMessagesWithLocalUserPrompts(
  localMessages: AgentMessage[],
  authoritativeMessages: AgentMessage[],
): AgentMessage[] {
  const mergedAuthoritativeMessages = authoritativeMessages.map((message) => {
    if (message.role !== "user") {
      return message;
    }
    const localUser = findRepresentedLocalUserWithAttachments(localMessages, message);
    return localUser ? mergeRepresentedUserMessage(localUser, message) : message;
  });
  const missingLocalUsers = localMessages.filter(
    (message) =>
      message.role === "user" && !hasRepresentedUserPrompt(mergedAuthoritativeMessages, message),
  );
  if (!missingLocalUsers.length) {
    return mergedAuthoritativeMessages;
  }
  return [...mergedAuthoritativeMessages, ...missingLocalUsers]
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const timeDelta = Date.parse(left.message.timestamp) - Date.parse(right.message.timestamp);
      return timeDelta === 0 ? left.index - right.index : timeDelta;
    })
    .map((entry) => entry.message);
}

function findRepresentedLocalUserWithAttachments(
  localMessages: AgentMessage[],
  providerUserMessage: AgentMessage,
) {
  const providerText = providerUserMessage.text.trim();
  return localMessages.find(
    (message) =>
      message.role === "user" &&
      Boolean(message.attachments?.length) &&
      (message.id === providerUserMessage.id || message.text.trim() === providerText),
  );
}

function mergeRepresentedUserMessage(local: AgentMessage, provider: AgentMessage): AgentMessage {
  return {
    ...provider,
    id: local.id,
    timestamp: local.timestamp,
    sequence: local.sequence ?? provider.sequence,
    ...(local.attachments?.length ? { attachments: local.attachments } : {}),
  };
}

function hasRepresentedUserPrompt(
  authoritativeMessages: AgentMessage[],
  localUserMessage: AgentMessage,
) {
  const localText = localUserMessage.text.trim();
  return authoritativeMessages.some(
    (message) =>
      message.role === "user" &&
      (message.id === localUserMessage.id || message.text.trim() === localText),
  );
}
