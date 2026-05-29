type MissionStatusBarProps = {
  className?: string;
  modelLoading: boolean;
  promptEnhancing: boolean;
};

const MODEL_LOADING_LABEL = "模型加载中...";
const PROMPT_ENHANCING_LABEL = "增强中...";

export function MissionStatusBar({
  className = "",
  modelLoading,
  promptEnhancing,
}: MissionStatusBarProps) {
  const items: string[] = [];
  if (modelLoading) items.push(MODEL_LOADING_LABEL);
  if (promptEnhancing) items.push(PROMPT_ENHANCING_LABEL);

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
