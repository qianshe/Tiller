import type { HelmHandlerContext } from "../handlers/context";

const activeAssistantStreamLogBySession = new Map<
  string,
  { key: string; endsWithNewline: boolean }
>();

export function createRuntimeStreamLogController() {
  function closeAssistantStreamLog(sessionId: string) {
    const active = activeAssistantStreamLogBySession.get(sessionId);
    if (!active) {
      return;
    }
    if (!active.endsWithNewline) {
      process.stdout.write("\n");
    }
    activeAssistantStreamLogBySession.delete(sessionId);
  }

  function ensureAssistantStreamLogStarted(
    sessionId: string,
    message: { id: string; role: string },
    context: HelmHandlerContext,
    nextLiveEventSequence: (sessionId: string) => number,
    runtimeLogScope: (sessionId: string, context: HelmHandlerContext) => string,
  ) {
    const key = `${sessionId}:${message.id}`;
    if (activeAssistantStreamLogBySession.get(sessionId)?.key === key) {
      return;
    }
    closeAssistantStreamLog(sessionId);
    activeAssistantStreamLogBySession.set(sessionId, {
      key,
      endsWithNewline: true,
    });
    context.logInfo(
      `[tiller] 阶段=直播消息流开始 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} role=${message.role} id=${message.id}`,
    );
  }

  function writeAssistantStreamText(sessionId: string, text: string) {
    if (!text) {
      return;
    }
    process.stdout.write(text);
    const active = activeAssistantStreamLogBySession.get(sessionId);
    if (active) {
      active.endsWithNewline = /[\r\n]$/u.test(text);
    }
  }

  return {
    closeAssistantStreamLog,
    ensureAssistantStreamLogStarted,
    writeAssistantStreamText,
  };
}
