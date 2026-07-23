const reportedAcpPromptFailures = new WeakSet<object>();

export function markAcpPromptFailureReported(error: unknown): void {
  if (typeof error === "object" && error !== null) {
    reportedAcpPromptFailures.add(error);
  }
}

export function wasAcpPromptFailureReported(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && reportedAcpPromptFailures.has(error);
}
