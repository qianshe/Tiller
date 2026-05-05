import type { AcpAgentProvider } from "@tiller/shared";
import { resolveAdapterCapabilities } from "./adapters";

export type DetectedAcpSessionCapabilities = {
  sessionLoad?: boolean;
  sessionResume?: boolean;
  sessionList?: boolean;
  sessionClose?: boolean;
  sessionDelete?: boolean;
  imageInput?: boolean;
};

export function resolveSessionCapabilities(
  initializeResult: any,
  provider?: AcpAgentProvider,
): DetectedAcpSessionCapabilities {
  const capabilities =
    initializeResult?.capabilities ??
    initializeResult?.agentCapabilities ??
    initializeResult?.sessionCapabilities ??
    {};
  const nestedSession =
    capabilities.session ??
    capabilities.sessions ??
    capabilities.sessionCapabilities ??
    initializeResult?.sessionCapabilities ??
    {};
  const promptCapabilities =
    initializeResult?.promptCapabilities ??
    capabilities.promptCapabilities ??
    capabilities.prompt ??
    {};
  const providerCapabilities = provider?.capabilities ?? {};

  const detected = {
    sessionLoad: Boolean(
      providerCapabilities.sessionLoad ??
        capabilities.loadSession ??
        capabilities.sessionLoad ??
        nestedSession.load ??
        nestedSession.loadSession,
    ),
    sessionResume: Boolean(
      providerCapabilities.sessionResume ??
        capabilities.resumeSession ??
        capabilities.sessionResume ??
        nestedSession.resume ??
        nestedSession.resumeSession,
    ),
    sessionList: Boolean(
      providerCapabilities.sessionList ??
        capabilities.listSessions ??
        capabilities.sessionList ??
        nestedSession.list ??
        nestedSession.listSessions,
    ),
    sessionClose: Boolean(
      providerCapabilities.sessionClose ??
        capabilities.closeSession ??
        capabilities.sessionClose ??
        nestedSession.close ??
        nestedSession.closeSession,
    ),
    sessionDelete: Boolean(
      providerCapabilities.sessionDelete ??
        capabilities.deleteSession ??
        capabilities.sessionDelete ??
        nestedSession.delete ??
        nestedSession.deleteSession,
    ),
    imageInput: Boolean(
      providerCapabilities.imageInput ??
        promptCapabilities.image ??
        promptCapabilities.images ??
        capabilities.imageInput,
    ),
  };

  return provider ? resolveAdapterCapabilities(provider, initializeResult, detected) : detected;
}
