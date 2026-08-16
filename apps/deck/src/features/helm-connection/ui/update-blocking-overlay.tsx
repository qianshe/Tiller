import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { HelmUpdateState } from "../../../store/facade";

type BlockingHelmUpdateState = HelmUpdateState & {
  status: "installing" | "restarting";
};

export function isHelmUpdateBlocking(
  update: HelmUpdateState | null | undefined,
): update is BlockingHelmUpdateState {
  return update?.status === "installing" || update?.status === "restarting";
}

export function HelmUpdateBlockingOverlay({
  update,
}: {
  update: HelmUpdateState | null | undefined;
}): ReactNode {
  if (!isHelmUpdateBlocking(update)) {
    return null;
  }

  const isInstalling = update.status === "installing";
  const title = isInstalling ? "正在安装 Helm 更新" : "Helm 正在重启";
  const message = update.message ?? (
    isInstalling
      ? "更新期间暂时无法操作页面。"
      : "正在等待新版本重新连接，请稍候。"
  );
  const progressLabel = isInstalling
    ? "正在下载并安装更新"
    : "正在等待新版本启动";

  return (
    <div
      aria-label={title}
      aria-modal="true"
      className="fixed inset-0 z-[100] grid place-items-center bg-background/75 px-5 backdrop-blur-md"
      data-helm-update-blocking-overlay
      role="alertdialog"
    >
      <div className="w-full max-w-sm rounded-lg border border-border-ghost bg-surface-elevated/95 p-6 text-center shadow-ambient">
        <LoaderCircle
          aria-hidden="true"
          className="mx-auto size-8 animate-spin text-primary"
          strokeWidth={1.8}
        />
        <h2 className="mt-4 text-section font-semibold text-foreground">{title}</h2>
        <p className="mx-auto mt-2 max-w-xs text-meta leading-relaxed text-muted-foreground">
          {message}
        </p>
        <div
          aria-label="更新进度"
          aria-valuetext={progressLabel}
          className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-surface-emphasis"
          data-helm-update-progress
          role="progressbar"
        >
          <div
            aria-hidden="true"
            className="h-full w-2/5 animate-pulse rounded-full bg-primary"
          />
        </div>
        {update.targetVersion ? (
          <p className="mt-4 font-mono text-2xs tabular text-muted-foreground">
            {update.currentVersion} → {update.targetVersion}
          </p>
        ) : null}
      </div>
    </div>
  );
}
