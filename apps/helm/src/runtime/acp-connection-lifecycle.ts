export type AcpSessionOperation = "list" | "load" | "resume";

export type AcpAdvertisedSessionCapabilities = {
  sessionList?: boolean;
  sessionLoad?: boolean;
  sessionResume?: boolean;
};

export type AcpRestoreStrategy = "load" | "resume";

export function canRunSessionOperation(
  capabilities: AcpAdvertisedSessionCapabilities,
  operation: AcpSessionOperation,
) {
  if (operation === "list") {
    return capabilities.sessionList === true;
  }
  if (operation === "load") {
    return capabilities.sessionLoad === true;
  }
  return capabilities.sessionResume === true;
}

export function preferRestoreStrategy(
  capabilities: AcpAdvertisedSessionCapabilities,
  needsTranscriptReplay: boolean,
): AcpRestoreStrategy | null {
  if (needsTranscriptReplay && capabilities.sessionLoad) {
    return "load";
  }
  if (capabilities.sessionResume) {
    return "resume";
  }
  if (capabilities.sessionLoad) {
    return "load";
  }
  return null;
}
