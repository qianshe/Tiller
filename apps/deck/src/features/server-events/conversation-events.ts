import type { ConversationPreparation } from "@tiller/shared";
import { useDeckStore } from "../../store";

export type ConversationUpdateParams =
  | { kind: "preparation_updated"; preparation: ConversationPreparation }
  | { kind: "preparation_deleted"; preparationId: string };

export function applyConversationListResult(
  method: string,
  result: unknown,
  sourceHelmKey: string,
) {
  if (method !== "conversation/list") return false;
  const preparations = (result as { preparations?: ConversationPreparation[] })?.preparations;
  useDeckStore.getState().applyHelmInventory(sourceHelmKey, {
    preparations: Array.isArray(preparations) ? preparations : [],
  });
  return true;
}
export function applyConversationUpdate(
  sourceHelmKey: string,
  params: ConversationUpdateParams,
) {
  const store = useDeckStore.getState();
  const current = store.helmInventories[sourceHelmKey]?.preparations ?? [];
  if (params.kind === "preparation_deleted") {
    store.applyHelmInventory(sourceHelmKey, {
      preparations: current.filter((item) => item.id !== params.preparationId),
    });
    return true;
  }
  const previous = current.find((item) => item.id === params.preparation.id);
  if (previous && previous.revision > params.preparation.revision) {
    return true;
  }
  store.applyHelmInventory(sourceHelmKey, {
    preparations: [
      ...current.filter((item) => item.id !== params.preparation.id),
      params.preparation,
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  });
  return true;
}
