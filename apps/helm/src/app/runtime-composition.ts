import { createSessionPromptQueueManager } from "../runtime/session/prompt-queue";
import {
  createSessionServices,
  type SessionServicesOptions,
} from "../runtime/session/services";

export type HelmRuntimeCompositionOptions = Omit<
  SessionServicesOptions,
  "sessions" | "permissionIndex"
>;

export type HelmRuntimeComposition = {
  sessions: SessionServicesOptions["sessions"];
  permissionIndex: SessionServicesOptions["permissionIndex"];
  promptQueue: ReturnType<typeof createSessionPromptQueueManager>;
  sessionServices: ReturnType<typeof createSessionServices>;
};

export function createHelmRuntimeComposition(
  options: HelmRuntimeCompositionOptions,
): HelmRuntimeComposition {
  const sessions: SessionServicesOptions["sessions"] = new Map();
  const permissionIndex: SessionServicesOptions["permissionIndex"] = new Map();
  const promptQueue = createSessionPromptQueueManager();
  const sessionServices = createSessionServices({
    ...options,
    sessions,
    permissionIndex,
  });

  return {
    sessions,
    permissionIndex,
    promptQueue,
    sessionServices,
  };
}
