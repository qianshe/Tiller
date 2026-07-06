export function shouldRefreshModelPickerOptions(input: {
  activeSessionId?: string | null;
  runtimeSessionId?: string | null;
  lastRefreshedRuntimeSessionId?: string | null;
}) {
  return Boolean(
    input.activeSessionId &&
      input.runtimeSessionId &&
      input.runtimeSessionId !== input.lastRefreshedRuntimeSessionId,
  );
}
