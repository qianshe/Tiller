import type { AgentMessage } from "@tiller/shared";
import type { DeckStore } from "../../store/facade";
import { useDeckStore } from "../../store";

type MessageMap = Record<string, AgentMessage[]>;

const EMPTY_MESSAGES: AgentMessage[] = [];

export function selectActiveSessionMessages(
  state: Pick<DeckStore, "messages">,
  sessionId: string | null,
): AgentMessage[] {
  if (!sessionId) {
    return EMPTY_MESSAGES;
  }
  return state.messages[sessionId] ?? EMPTY_MESSAGES;
}

export function getDeckSessionMessages(sessionId: string): AgentMessage[] {
  return useDeckStore.getState().messages[sessionId] ?? EMPTY_MESSAGES;
}

export function useActiveSessionMessages(
  sessionId: string | null,
  fixtureMessages?: MessageMap,
): AgentMessage[] {
  const storeMessages = useDeckStore((state) =>
    selectActiveSessionMessages(state, sessionId),
  );
  if (fixtureMessages && sessionId) {
    return fixtureMessages[sessionId] ?? EMPTY_MESSAGES;
  }
  if (fixtureMessages && !sessionId) {
    return EMPTY_MESSAGES;
  }
  return storeMessages;
}
