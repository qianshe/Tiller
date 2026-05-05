import { useEffect, type RefObject } from "react";
import type { AppView } from "../../../shared/utils/routes";

type UsePromptAutosizeOptions = {
  activeView: AppView;
  activeSessionId: string | null;
  imagePasteNotice: string;
  prompt: string;
  promptImageCount: number;
  promptRef: RefObject<HTMLTextAreaElement | null>;
};

/**
 * Resizes the mission prompt editor to fit draft controls and viewport limits.
 */
export function usePromptAutosize({
  activeView,
  activeSessionId,
  imagePasteNotice,
  prompt,
  promptImageCount,
  promptRef,
}: UsePromptAutosizeOptions) {
  useEffect(() => {
    if (activeView !== "sessions" || !promptRef.current) {
      return;
    }
    const textarea = promptRef.current;
    let maxHeight = Math.max(160, Math.floor(window.innerHeight * 0.5));
    const draftForm = textarea.closest<HTMLFormElement>(
      ".mission-draft-chat .mission-order-editor",
    );
    if (draftForm) {
      const formStyles = window.getComputedStyle(draftForm);
      const rowGap =
        Number.parseFloat(formStyles.rowGap || formStyles.gap || "0") || 0;
      const visibleSiblings = Array.from(draftForm.children).filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          !element.contains(textarea) &&
          window.getComputedStyle(element).display !== "none",
      );
      const visibleSiblingHeight = visibleSiblings.reduce(
        (total, element) => total + element.getBoundingClientRect().height,
        0,
      );
      const availableDraftHeight = Math.floor(
        draftForm.clientHeight -
          visibleSiblingHeight -
          rowGap * visibleSiblings.length,
      );
      maxHeight = Math.max(96, Math.min(maxHeight, availableDraftHeight));
    }
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [
    activeSessionId,
    activeView,
    imagePasteNotice,
    prompt,
    promptImageCount,
    promptRef,
  ]);
}
