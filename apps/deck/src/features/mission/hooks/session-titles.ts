import { useEffect } from "react";
import type { AgentMessage, SessionSummary } from "@tiller/shared";
import type { PromptEnhancerPreferences } from "../../prompt-enhancer";
import {
  createFallbackSessionTitle,
  generateSessionTitleWithLlm,
} from "../utils/session-title";
import { writeSessionTitles } from "../utils/session-titles-storage";
import { resolveSessionTitle } from "../utils/session-derivations";

type SessionTitleMap = Record<string, string>;

type UseSessionTitlesOptions = {
  messages: Record<string, AgentMessage[]>;
  sessionTitles: SessionTitleMap;
  setSessionTitles: (
    value: SessionTitleMap | ((current: SessionTitleMap) => SessionTitleMap),
  ) => void;
  promptEnhancerLlm: PromptEnhancerPreferences["llm"];
};

/**
 * Resolves display titles and assigns deterministic/optional LLM session names.
 */
export function useSessionTitles({
  messages,
  sessionTitles,
  setSessionTitles,
  promptEnhancerLlm,
}: UseSessionTitlesOptions) {
  useEffect(() => {
    writeSessionTitles(sessionTitles);
  }, [sessionTitles]);

  function resolveDisplaySessionTitle(session: SessionSummary) {
    const firstUserMessage = messages[session.id]?.find(
      (message) => message.role === "user",
    )?.text;
    return resolveSessionTitle(
      session,
      sessionTitles[session.id] ?? firstUserMessage,
    );
  }

  function assignSessionTitleFromPrompt(sessionId: string, rawPrompt: string) {
    const promptText = rawPrompt.trim();
    if (!promptText) {
      return;
    }
    const fallbackTitle = createFallbackSessionTitle(promptText);
    setSessionTitles((current) =>
      current[sessionId] ? current : { ...current, [sessionId]: fallbackTitle },
    );
    if (
      !promptEnhancerLlm.enabled ||
      !promptEnhancerLlm.baseUrl.trim() ||
      !promptEnhancerLlm.model.trim()
    ) {
      return;
    }
    void generateSessionTitleWithLlm(promptText, promptEnhancerLlm)
      .then((title) => {
        if (title) {
          setSessionTitles((current) => ({ ...current, [sessionId]: title }));
        }
      })
      .catch(() => {
        // Keep deterministic fallback title when the optional naming model is unavailable.
      });
  }

  return { resolveDisplaySessionTitle, assignSessionTitleFromPrompt };
}
