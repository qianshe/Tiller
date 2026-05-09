import { createAcpConnectionManager } from "./connection/connection-manager";
import { createRestoreReplayEventSink } from "./restore-replay";
import type { AgentPromptContent } from "@tiller/shared";
import type { AcpRuntimeOptions } from "./runtime-types";

const defaultAcpConnectionManager = createAcpConnectionManager();

export async function reconnectAcpConnection(options: AcpRuntimeOptions) {
  return defaultAcpConnectionManager.reconnect({
    sessionId: options.sessionId,
    workspace: options.workspace,
    provider: options.agent,
    sessionConfig: options.sessionConfig,
    onLifecycleEvent: options.onConnectionLifecycleEvent,
  });
}

export async function createAcpRuntime(options: AcpRuntimeOptions) {
  const restoreReplaySink = createRestoreReplayEventSink(
    options.onEvent,
    (event) => options.onRestoreReplayEvent?.(event),
    options.restore?.replayBaselineMessages,
  );
  if (options.restore) {
    restoreReplaySink.setSuppressing(true);
  }

  try {
    const runtime = await defaultAcpConnectionManager.openSession({
      sessionId: options.sessionId,
      workspace: options.workspace,
      provider: options.agent,
      sessionConfig: options.sessionConfig,
      restore: options.restore,
      onEvent: restoreReplaySink.onEvent,
      onRestoreReplayEvent: options.onRestoreReplayEvent,
      onLifecycleEvent: options.onConnectionLifecycleEvent,
    });

    return {
      ...runtime,
      prompt: async (text: string, content?: AgentPromptContent[]) => {
        restoreReplaySink.setSuppressing(false);
        return await runtime.prompt(text, content);
      },
    } satisfies typeof runtime;
  } catch (error) {
    restoreReplaySink.setSuppressing(false);
    throw error;
  }
}
