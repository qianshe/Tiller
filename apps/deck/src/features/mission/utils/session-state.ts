import type { SessionStatus, SessionSummary } from "@tiller/shared";
import type { Locale } from "../../../shared/utils/copy";

export type SessionRestoreGateState =
  | "ready"
  | "checking"
  | "restoring"
  | "failed"
  | "history-only";

export type SessionRestoreGate = {
  state: SessionRestoreGateState;
  canChat: boolean;
  message: string;
};

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

export function isAgentSideSessionRestoreAvailable(
  resume: SessionSummary["resume"],
) {
  return Boolean(
    resume?.state === "resume-available" &&
      resume.mode === "reconnect" &&
      (resume.restoreMethod === "session/load" ||
        resume.restoreMethod === "session/resume"),
  );
}

export function resolveSessionRestoreGate(input: {
  activeSession?: Pick<SessionSummary, "resume"> | null;
  activeSessionStatus: SessionStatus;
  resumeStartPending?: boolean;
}): SessionRestoreGate {
  const { activeSession, activeSessionStatus, resumeStartPending } = input;
  const resume = activeSession?.resume;

  if (!activeSession) {
    return { state: "ready", canChat: true, message: "" };
  }

  if (activeSessionStatus === "starting") {
    return {
      state: "restoring",
      canChat: false,
      message: "正在启动 ACP 会话，连接成功后即可发送。",
    };
  }

  if (
    activeSessionStatus === "running" ||
    activeSessionStatus === "waiting_for_permission"
  ) {
    return { state: "ready", canChat: true, message: "" };
  }

  if (
    resume?.state === "resume-available" &&
    (resume.mode === "same-process" || resume.restoreMethod === "client-reconnect")
  ) {
    return { state: "ready", canChat: true, message: "" };
  }

  if (resumeStartPending) {
    return {
      state: "restoring",
      canChat: false,
      message: "正在恢复 ACP 会话，恢复成功后即可继续对话。",
    };
  }

  if (!resume) {
    return {
      state: "checking",
      canChat: false,
      message: "正在检查 ACP 会话恢复能力...",
    };
  }

  if (isAgentSideSessionRestoreAvailable(resume)) {
    return {
      state: "restoring",
      canChat: false,
      message: "正在恢复 ACP 会话，恢复成功后即可继续对话。",
    };
  }

  if (resume.state === "resume-unavailable") {
    return {
      state: "failed",
      canChat: false,
      message: resume.reason || "ACP 会话暂不可恢复，无法继续发送新消息。",
    };
  }

  return {
    state: "history-only",
    canChat: false,
    message: "当前任务仅可查看历史，ACP 会话未恢复，暂不能继续对话。",
  };
}
