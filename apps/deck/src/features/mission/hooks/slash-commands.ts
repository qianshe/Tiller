import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import type { AvailableCommand } from "@tiller/shared";

type UseSlashCommandsOptions = {
  prompt: string;
  setPrompt: Dispatch<SetStateAction<string>>;
  activeSessionId: string | null;
  activeSessionAgentId?: string | null;
  sessionAvailableCommands: Record<string, AvailableCommand[]>;
  agentAvailableCommands: Record<string, AvailableCommand[]>;
  refreshAgentAvailableCommands?: () => void;
  promptRef: RefObject<HTMLTextAreaElement | null>;
  onFallbackKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
};

/**
 * Handles slash command filtering, popup dismissal and keyboard selection.
 */
export function useSlashCommands({
  prompt,
  setPrompt,
  activeSessionId,
  activeSessionAgentId,
  sessionAvailableCommands,
  agentAvailableCommands,
  refreshAgentAvailableCommands,
  promptRef,
  onFallbackKeyDown,
}: UseSlashCommandsOptions) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [suppressedFor, setSuppressedFor] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const commandToken = useMemo(() => {
    const match = /^\/(\S*)$/.exec(prompt);
    return match ? (match[1]?.toLowerCase() ?? "") : null;
  }, [prompt]);

  const filteredCommands = useMemo(() => {
    if (commandToken === null) {
      return [] as AvailableCommand[];
    }
    const sessionCommands = activeSessionId
      ? sessionAvailableCommands[activeSessionId] ?? []
      : [];
    const commands = sessionCommands.length
      ? sessionCommands
      : activeSessionAgentId
        ? agentAvailableCommands[activeSessionAgentId] ?? []
        : [];
    if (!commandToken) {
      return commands;
    }
    return commands.filter((cmd) => cmd.name.toLowerCase().startsWith(commandToken));
  }, [
    commandToken,
    activeSessionId,
    activeSessionAgentId,
    sessionAvailableCommands,
    agentAvailableCommands,
  ]);

  const popupOpen = filteredCommands.length > 0 && suppressedFor !== prompt;

  useEffect(() => {
    if (commandToken === null || !activeSessionAgentId) {
      return;
    }
    const sessionCommands = activeSessionId
      ? sessionAvailableCommands[activeSessionId] ?? []
      : [];
    const agentCommands = agentAvailableCommands[activeSessionAgentId] ?? [];
    if (sessionCommands.length === 0 && agentCommands.length === 0) {
      refreshAgentAvailableCommands?.();
    }
  }, [
    commandToken,
    activeSessionAgentId,
    sessionAvailableCommands,
    agentAvailableCommands,
    refreshAgentAvailableCommands,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [commandToken, activeSessionId]);

  useEffect(() => {
    setSelectedIndex((current) =>
      filteredCommands.length > 0 && current >= filteredCommands.length
        ? 0
        : current,
    );
  }, [filteredCommands.length]);

  useEffect(() => {
    if (!popupOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setSuppressedFor(prompt);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [popupOpen, prompt]);

  function applyCommand(cmd: AvailableCommand) {
    setPrompt(`/${cmd.name} `);
    setSuppressedFor(null);
    promptRef.current?.focus();
  }

  function handlePromptKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (popupOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % filteredCommands.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex(
          (index) =>
            (index - 1 + filteredCommands.length) % filteredCommands.length,
        );
        return;
      }
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        const cmd = filteredCommands[selectedIndex];
        if (cmd) {
          applyCommand(cmd);
        }
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const cmd = filteredCommands[selectedIndex];
        if (cmd) {
          applyCommand(cmd);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSuppressedFor(prompt);
        return;
      }
    }
    onFallbackKeyDown(event);
  }

  return {
    slashWrapperRef: wrapperRef,
    slashPopupOpen: popupOpen,
    filteredSlashCommands: filteredCommands,
    slashSelectedIndex: selectedIndex,
    setSlashSelectedIndex: setSelectedIndex,
    applySlashCommand: applyCommand,
    handleMissionPromptKeyDown: handlePromptKeyDown,
  };
}
