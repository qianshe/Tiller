import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/shared/ui";

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
      <main
        className="grid min-h-screen place-items-center bg-background px-4 py-12 text-foreground"
        role="alert"
      >
        <section className="grid max-w-2xl gap-4 rounded-lg bg-surface p-8 shadow-ambient">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground/70">
            渲染异常
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            页面没有完全崩掉，但当前视图加载失败了
          </h1>
          <p className="text-sm leading-6 text-foreground/70">
            {formatRenderError(this.state.error)}
          </p>
          <Button
            className="justify-self-start"
            type="button"
            onClick={() => window.location.reload()}
          >
            刷新页面
          </Button>
        </section>
      </main>
    );
  }
}
