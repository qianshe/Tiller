export type MissionChatRestoreGateState = "history-only" | "failed" | "restoring" | string;

export type MissionChatRestoreNotice = {
  title: string;
  message: string;
};

export function resolveMissionChatSelectedSessionId({
  focusedDraftWindow,
  focusedRealSessionId,
  activeSessionId,
}: {
  focusedDraftWindow: boolean;
  focusedRealSessionId?: string | null;
  activeSessionId?: string | null;
}) {
  return focusedDraftWindow ? null : focusedRealSessionId ?? activeSessionId ?? null;
}

export function buildMissionChatRestoreNotice({
  show,
  state,
  message,
}: {
  show: boolean;
  state: MissionChatRestoreGateState;
  message: string;
}): MissionChatRestoreNotice | undefined {
  if (!show) {
    return undefined;
  }
  return {
    title: state === "history-only" || state === "failed"
      ? "ACP 会话未恢复"
      : "正在恢复 ACP",
    message,
  };
}

export function buildDraftPreparingMessage({
  agentName,
  connectionMessage,
}: {
  agentName?: string | null;
  connectionMessage?: string | null;
}) {
  return `${agentName ?? "ACP Agent"} ${connectionMessage ?? "正在启动连接，连接成功后将显示输入框。"}`;
}
