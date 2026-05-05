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
  sessionAvailableCommands: Record<string, AvailableCommand[]>;
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
  sessionAvailableCommands,
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
    if (commandToken === null || !activeSessionId) {
      return [] as AvailableCommand[];
    }
    const all = sessionAvailableCommands[activeSessionId] ?? [];
    if (!commandToken) {
      return all;
    }
    return all.filter((cmd) => cmd.name.toLowerCase().startsWith(commandToken));
  }, [commandToken, activeSessionId, sessionAvailableCommands]);

  const popupOpen = filteredCommands.length > 0 && suppressedFor !== prompt;

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
    wrapperRef,
    popupOpen,
    filteredCommands,
    selectedIndex,
    setSelectedIndex,
    applyCommand,
    handlePromptKeyDown,
  };
}
