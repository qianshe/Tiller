const CONTINUATION_SUMMARY_PATTERN =
  /continued from a previous conversation[\s\S]*out of context/i;
const COMPACTION_STARTED_PATTERN = /^compacting(?:\.\.\.)?$/iu;
const COMPACTION_COMPLETED_PATTERN = /^compacting completed\.?$/iu;

export function looksLikeContinuationSummary(text: string) {
  return CONTINUATION_SUMMARY_PATTERN.test(text.trim());
}

export function looksLikeCompactionStartedMessage(text: string) {
  return COMPACTION_STARTED_PATTERN.test(text.trim());
}

export function looksLikeCompactionCompletedMessage(text: string) {
  return COMPACTION_COMPLETED_PATTERN.test(text.trim());
}

export function looksLikeCompactionLifecycleMessage(text: string) {
  return looksLikeCompactionStartedMessage(text) ||
    looksLikeCompactionCompletedMessage(text);
}
