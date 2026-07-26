import { Component, type ErrorInfo, type ReactNode } from "react";
import { copyTextToClipboard } from "../../shared/utils/clipboard";

const ROUTE_CRASH_NOTIFICATION_STACK_FRAMES = 8;

/**
 * 通知中心单条消息保持紧凑:错误信息 + 组件堆栈顶部若干帧。
 * 完整堆栈在 fallback 界面里展示并可复制。
 */
export function formatRouteCrashNotification(message: string, componentStack: string) {
  const frames = componentStack
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, ROUTE_CRASH_NOTIFICATION_STACK_FRAMES);
  return [message.trim(), ...frames].join("\n");
}

type RouteErrorBoundaryProps = {
  onError: (error: Error, componentStack: string) => void;
  children: ReactNode;
};

type RouteErrorBoundaryState = {
  error: Error | null;
  componentStack: string;
};

/**
 * 捕获路由内容的渲染崩溃(如 Maximum update depth exceeded),
 * 把组件堆栈交给 onError 上报,并渲染可复制堆栈的降级界面,
 * 避免只剩白屏/控制台里一条难以回溯的报错。
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const componentStack = info.componentStack ?? "";
    this.setState({ componentStack });
    this.props.onError(error, componentStack);
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) {
      return this.props.children;
    }
    const detail = `${error.message}\n${componentStack}`.trim();
    return (
      <div className="route-error-boundary m-4 flex min-h-0 flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <div>
          <div className="text-sm font-semibold text-foreground">界面渲染出错</div>
          <p className="mt-1 text-xs text-muted-foreground">
            已捕获渲染崩溃并记录到通知中心。可复制下方错误详情用于排查。
          </p>
        </div>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-border-ghost bg-surface-sunken p-3 font-mono text-xs leading-5 text-foreground">
          {detail}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-border-ghost bg-surface-elevated px-3 py-1 text-xs text-foreground hover:bg-surface-emphasis"
            onClick={() => {
              void copyTextToClipboard(
                detail,
                typeof navigator === "undefined" ? undefined : navigator.clipboard,
              ).catch(() => undefined);
            }}
          >
            复制错误详情
          </button>
          <button
            type="button"
            className="rounded border border-border-ghost bg-surface-elevated px-3 py-1 text-xs text-foreground hover:bg-surface-emphasis"
            onClick={() => this.setState({ error: null, componentStack: "" })}
          >
            重试渲染
          </button>
        </div>
      </div>
    );
  }
}
