import type { TillerConfig } from "@tiller/agent-registry";
import { fetchTillerNpmDistTags } from "./npm-registry.js";
import { isVersionGreater } from "./versions.js";

export type UpdateOptions = { checkOnStart: boolean; previewHint: boolean };
export type UpdateVersions = { current: string; latest?: string; preview?: string };
export type UpdateNotice =
  | { kind: "latest-update"; current: string; latest: string }
  | { kind: "preview-hint"; current: string; preview: string }
  | { kind: "up-to-date"; current: string };

export const LATEST_UPDATE_COMMAND = "npm install -g @qianshe/tiller@latest";
export const PREVIEW_UPDATE_COMMAND = "npm install -g @qianshe/tiller@preview";

export function resolveUpdateOptions(input: {
  env?: Record<string, string | undefined>;
  config?: Pick<TillerConfig, "updates">;
}): UpdateOptions {
  const env = input.env ?? process.env;
  const config = input.config?.updates;
  return {
    checkOnStart: parseBoolean(env.TILLER_UPDATE_CHECK, config?.checkOnStart ?? true),
    previewHint: parseBoolean(env.TILLER_UPDATE_PREVIEW_HINT, config?.previewHint ?? true),
  };
}

export async function loadUpdateVersions(current: string): Promise<UpdateVersions> {
  const tags = await fetchTillerNpmDistTags();
  return { current, latest: tags.latest, preview: tags.preview };
}

export function buildUpdateNotice(versions: UpdateVersions, options: UpdateOptions): UpdateNotice {
  if (versions.latest && isVersionGreater(versions.latest, versions.current)) {
    return { kind: "latest-update", current: versions.current, latest: versions.latest };
  }
  if (
    options.previewHint &&
    versions.preview &&
    isVersionGreater(versions.preview, versions.current)
  ) {
    return { kind: "preview-hint", current: versions.current, preview: versions.preview };
  }
  return { kind: "up-to-date", current: versions.latest ?? versions.current };
}

export function formatStartupUpdateNotice(notice: UpdateNotice): string[] {
  if (notice.kind === "latest-update") {
    return [
      `[tiller] Update available: ${notice.current} -> ${notice.latest}`,
      "[tiller] Run: tiller update",
    ];
  }
  if (notice.kind === "preview-hint") {
    return [
      `[tiller] Preview available: ${notice.preview}`,
      `[tiller] Try it with: ${PREVIEW_UPDATE_COMMAND}`,
    ];
  }
  return [];
}

export function formatExplicitUpdateOutput(notice: UpdateNotice): string {
  if (notice.kind === "latest-update") {
    return [
      `Tiller update available: ${notice.current} -> ${notice.latest}`,
      "Running:",
      `  ${LATEST_UPDATE_COMMAND}`,
    ].join("\n");
  }
  if (notice.kind === "preview-hint") {
    return [
      `Tiller is up to date on latest: ${notice.current}`,
      `Preview available: ${notice.preview}`,
      "Try it with:",
      `  ${PREVIEW_UPDATE_COMMAND}`,
    ].join("\n");
  }
  return `Tiller is up to date on latest: ${notice.current}`;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim().length === 0) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  return fallback;
}
