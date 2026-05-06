import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export function formatRenderError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "未知渲染错误";
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[tiller] deck render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="shell app-error-boundary" role="alert">
        <section className="panel app-error-card">
          <p className="eyebrow">渲染异常</p>
          <h1>页面没有完全崩掉，但当前视图加载失败了</h1>
          <p className="muted compact">
            {formatRenderError(this.state.error)}
          </p>
          <button
            className="primary"
            type="button"
            onClick={() => window.location.reload()}
          >
            刷新页面
          </button>
        </section>
      </main>
    );
  }
}
