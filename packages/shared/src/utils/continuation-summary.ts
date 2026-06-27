const CONTINUATION_SUMMARY_PATTERN =
  /continued from a previous conversation[\s\S]*out of context/i;

export function looksLikeContinuationSummary(text: string) {
  return CONTINUATION_SUMMARY_PATTERN.test(text.trim());
}
