import type { AcpAgentProvider } from "@tiller/shared";
import { DEFAULT_ACP_PROMPT_START_TIMEOUT_MS } from "../constants";
import type { SessionRuntimeEvent } from "../runtime-types";

export const ACP_PROMPT_STALLED_CODE = "ACP_PROMPT_STALLED";

export class AcpPromptStalledError extends Error {
  readonly code = ACP_PROMPT_STALLED_CODE;

  constructor(timeoutMs: number) {
    super(
      `ACP agent produced no prompt progress within ${timeoutMs}ms. ` +
        "The connection was reset; retry the prompt.",
    );
    this.name = "AcpPromptStalledError";
  }
}

export type AcpPromptStartGuard = {
  timeout: Promise<never>;
  markProgress(): void;
  dispose(): void;
};

export function createAcpPromptStartGuard(
  provider: AcpAgentProvider,
): AcpPromptStartGuard {
  const timeoutMs = Math.min(
    provider.promptTimeoutMs ?? Number.POSITIVE_INFINITY,
    DEFAULT_ACP_PROMPT_START_TIMEOUT_MS,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const clear = () => {
    if (settled) {
      return;
    }
    settled = true;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timer = undefined;
      if (settled) {
        return;
      }
      settled = true;
      reject(new AcpPromptStalledError(timeoutMs));
    }, timeoutMs);
    timer.unref?.();
  });

  return {
    timeout,
    markProgress: clear,
    dispose: clear,
  };
}

export function isAcpPromptProgressEvent(event: SessionRuntimeEvent): boolean {
  return ![
    "available-commands",
    "config-options",
    "mode-update",
    "model-options",
    "session-info",
    "usage-update",
  ].includes(event.type);
}
