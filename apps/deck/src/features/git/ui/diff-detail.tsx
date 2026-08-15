import type { FileDiffSummary } from "@tiller/shared";
import { renderGitDiffPatch, renderGitDiffStats } from "./diff-tree";

export function GitDiffDetail({
  file,
  loading = false,
  error,
}: {
  file?: FileDiffSummary;
  loading?: boolean;
  error?: string;
}) {
  if (!file) {
    return <div className="grid min-h-full place-items-center p-6 text-meta text-muted-foreground">选择一个文件查看 Diff。</div>;
  }
  if (loading) {
    return (
      <div className="grid gap-2 p-3" aria-live="polite">
        <div className="h-3 w-1/3 animate-pulse rounded bg-surface-emphasis" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-surface-emphasis" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-surface-emphasis" />
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2 border-b border-border-ghost px-3 py-2 text-meta">
        <span className="font-mono font-semibold text-primary">{file.status === "modified" ? "M" : file.status === "added" ? "A" : "D"}</span>
        <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>{file.path}</span>
        {renderGitDiffStats(file)}
      </div>
      {error ? <p className="border-b border-border-ghost px-3 py-2 text-meta text-destructive">{error}</p> : null}
      {file.patch ? (
        <>
          {renderGitDiffPatch({ patch: file.patch })}
          {file.patchTruncated && file.patchRef ? (
            <p className="border-t border-border-ghost px-3 py-2 text-meta text-muted-foreground">
              <a className="text-primary underline underline-offset-2" href={file.patchRef.uri} target="_blank" rel="noreferrer">查看完整 patch</a>
            </p>
          ) : null}
        </>
      ) : (
        <div className="grid gap-2 p-3 text-meta text-muted-foreground">
          <span>{file.patchTruncated ? "该文件的 patch 过大或为二进制文件，暂不展示。" : "该文件没有可展示的 patch。"}</span>
          {file.patchRef ? <a className="text-primary underline underline-offset-2" href={file.patchRef.uri} target="_blank" rel="noreferrer">查看完整 patch</a> : null}
        </div>
      )}
    </div>
  );
}
