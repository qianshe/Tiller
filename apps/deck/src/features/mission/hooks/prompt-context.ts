import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import type { MissionPromptContextItem } from "@tiller/shared";

export type DraftContextList = MissionPromptContextItem[];

export function upsertDraftContextItem(
  items: DraftContextList,
  item: MissionPromptContextItem,
) {
  return [...items.filter((entry) => entry.id !== item.id), item];
}

export function removeDraftContextItem(items: DraftContextList, id: string) {
  return items.filter((entry) => entry.id !== id);
}

export function usePromptContext() {
  const [draftContexts, setDraftContexts] = useState<DraftContextList>([]);
  return {
    draftContexts,
    addDraftContext: (item: MissionPromptContextItem) =>
      setDraftContexts((current) => upsertDraftContextItem(current, item)),
    removeDraftContext: (id: string) =>
      setDraftContexts((current) => removeDraftContextItem(current, id)),
    clearDraftContexts: () => setDraftContexts([]),
  };
}

export type ReviewContextState = {
  draftContexts: DraftContextList;
  commandRetentionNotice: string | null;
  addDraftContext: (item: MissionPromptContextItem) => void;
  removeDraftContext: (id: string) => void;
  clearDraftContexts: () => void;
  setCommandRetentionNotice: Dispatch<SetStateAction<string | null>>;
};

export function useReviewContext(): ReviewContextState {
  const promptContext = usePromptContext();
  const [commandRetentionNotice, setCommandRetentionNotice] = useState<string | null>(null);
  return {
    ...promptContext,
    commandRetentionNotice,
    setCommandRetentionNotice,
  };
}
