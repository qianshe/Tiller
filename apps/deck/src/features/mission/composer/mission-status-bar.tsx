type MissionStatusBarProps = {
  className?: string;
  modelLoading: boolean;
  sessionRestoring?: boolean;
  promptEnhancing: boolean;
  promptEnhancerStatus?: string;
};

const MODEL_LOADING_LABEL = "模型加载中...";
const SESSION_RESTORING_LABEL = "会话恢复中...";
const PROMPT_ENHANCING_LABEL = "增强中...";

export function MissionStatusBar({
  className = "",
  modelLoading,
  sessionRestoring = false,
  promptEnhancing,
  promptEnhancerStatus,
}: MissionStatusBarProps) {
  const items: string[] = [];
  if (modelLoading) items.push(MODEL_LOADING_LABEL);
  if (sessionRestoring) items.push(SESSION_RESTORING_LABEL);
  if (promptEnhancing) items.push(PROMPT_ENHANCING_LABEL);
  
  // 如果有具体的增强器状态消息（包括错误和成功消息），显示它
  if (!promptEnhancing && promptEnhancerStatus?.trim()) {
    items.push(promptEnhancerStatus.trim());
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={`mission-status-bar mission-status-scroll flex min-w-0 max-w-full items-center justify-center justify-self-center overflow-x-auto whitespace-nowrap px-2 text-center text-[10px] leading-none text-muted-foreground ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      {items.map((label, index) => (
        <span key={label} className="mission-status-item">
          {index > 0 ? (
            <span aria-hidden="true" className="mx-2">
              ·
            </span>
          ) : null}
          {label}
        </span>
      ))}
    </div>
  );
}
