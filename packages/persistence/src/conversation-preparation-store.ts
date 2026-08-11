import type { ConversationPreparation } from "@tiller/shared";

export type ConversationPreparationStore = {
  get: (id: string) => ConversationPreparation | undefined;
  list: () => ConversationPreparation[];
  upsert: (preparation: ConversationPreparation) => void;
  remove: (id: string) => void;
};

export function validateConversationPreparationContent(content: string): string {
  const normalized = content.trim();
  if (!normalized) {
    throw new Error("Preparation content must not be empty");
  }
  return normalized;
}
