import type { SessionStatus, SessionSummary } from "@tiller/shared";
import type { Locale } from "../../../shared/utils/copy";

export function isSessionExecutionPending(status: SessionStatus) {
  return (
    status === "starting" ||
    status === "running" ||
    status === "waiting_for_permission"
  );
}

export function formatResumeLabel(resume: SessionSummary["resume"], locale: Locale) {
  if (!resume) {
    return "恢复状态待检查";
  }

  switch (resume.state) {
    case "resume-available":
      return "可恢复";
    case "resume-unavailable":
      return "暂不可恢复";
    case "history-only":
    default:
      return "仅历史记录";
  }
}
