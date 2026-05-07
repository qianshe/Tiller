import { useEffect, useState } from "react";
import type { AgentMessage, SessionSummary } from "@tiller/shared";
import type { PromptEnhancerPreferences } from "../../prompt-enhancer";
import {
  createFallbackSessionTitle,
  resolveRegeneratedSessionTitle,
} from "../utils/session-title";
import { writeSessionTitles } from "../utils/session-titles-storage";
import { resolveSessionTitle } from "../utils/session-derivations";
import type { DeckRpcClient } from "../../helm-connection/rpc-client";

type SessionTitleMap = Record<string, string>;

type UseSessionTitlesOptions = {
  client: DeckRpcClient | null;
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
  client,
  messages,
  sessionTitles,
  setSessionTitles,
  promptEnhancerLlm,
}: UseSessionTitlesOptions) {
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    writeSessionTitles(sessionTitles);
  }, [sessionTitles]);

  function resolveDisplaySessionTitle(session: SessionSummary) {
    const firstUserMessage = findFirstUserMessage(session.id);
    return resolveSessionTitle(
      session,
      sessionTitles[session.id] ?? firstUserMessage,
    );
  }

  function findFirstUserMessage(sessionId: string) {
    return messages[sessionId]?.find((message) => message.role === "user")
      ?.text;
  }

  function resolveSessionTitleSource(session: SessionSummary) {
    // Collect last 2-3 user messages for better context
    const userMessages = (messages[session.id] ?? [])
      .filter((m) => m.role === "user")
      .slice(-3)
      .map((m) => m.text);

    if (userMessages.length > 0) {
      return userMessages.join("\n---\n");
    }

    return session.lastMessagePreview ?? "";
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
      if (client) {
        void client.request("session/rename", {
          sessionId,
          title: fallbackTitle,
        });
      }
      return;
    }

    setRegeneratingIds((curr) => new Set([...curr, sessionId]));
    void resolveRegeneratedSessionTitle(promptText, promptEnhancerLlm)
      .then((title) => {
        if (title) {
          setSessionTitles((current) => ({ ...current, [sessionId]: title }));
          if (client) {
            void client.request("session/rename", { sessionId, title });
          }
        }
      })
      .finally(() => {
        setRegeneratingIds((curr) => {
          const next = new Set(curr);
          next.delete(sessionId);
          return next;
        });
      });
  }

  function regenerateSessionTitle(session: SessionSummary) {
    const source = resolveSessionTitleSource(session);
    setRegeneratingIds((curr) => new Set([...curr, session.id]));
    void resolveRegeneratedSessionTitle(source, promptEnhancerLlm)
      .then((title) => {
        if (title) {
          setSessionTitles((current) => ({ ...current, [session.id]: title }));
          if (client) {
            void client.request("session/rename", {
              sessionId: session.id,
              title,
            });
          }
        }
      })
      .finally(() => {
        setRegeneratingIds((curr) => {
          const next = new Set(curr);
          next.delete(session.id);
          return next;
        });
      });
  }

  return {
    resolveDisplaySessionTitle,
    assignSessionTitleFromPrompt,
    regenerateSessionTitle,
    regeneratingIds,
  };
}
