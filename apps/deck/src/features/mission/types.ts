import type { ProjectFileSummary } from "@tiller/shared";

export type ProjectFilesEntry = {
  loading?: boolean;
  message?: string;
  files: ProjectFileSummary[];
};
