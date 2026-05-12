import type { FileDiffSummary } from "@tiller/shared";

export const MAX_INLINE_DIFF_CHARS = 80_000;

export type LimitedFileDiffSummary = FileDiffSummary & {
  truncated?: boolean;
  summary?: string;
};

export function summarizeLargeDiffs(files: FileDiffSummary[]): LimitedFileDiffSummary[] {
  return files.map((file) => {
    if (!file.patch || file.patch.length <= MAX_INLINE_DIFF_CHARS) {
      return file;
    }

    const next: LimitedFileDiffSummary = {
      ...file,
      truncated: true,
      summary: "Diff 内容太长，已省略详情。请在本地 Git 工具中查看完整 diff。",
    };
    delete next.patch;
    return next;
  });
}
