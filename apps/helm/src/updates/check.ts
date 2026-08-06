import type { TillerConfig } from "@tiller/agent-registry";
import { fetchTillerNpmDistTags } from "./npm-registry.js";
import { isVersionGreater } from "./versions.js";

export type UpdateOptions = { checkOnStart: boolean; previewHint: boolean };
export type UpdateVersions = { current: string; latest?: string; preview?: string };
export type UpdateCheckResult = {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  canUpdate: boolean;
  checkStatus: "checked" | "failed" | "disabled" | "unsupported";
  cannotUpdateReason?: string;
  manualCommand?: string;
  checkedAt?: string;
};
export type UpdateNotice =
  | { kind: "latest-update"; current: string; latest: string }
  | { kind: "preview-hint"; current: string; preview: string }
  | { kind: "up-to-date"; current: string };

export const LATEST_UPDATE_COMMAND = "npm install -g @qianshe/tiller@latest";
export const PREVIEW_UPDATE_COMMAND = "npm install -g @qianshe/tiller@preview";
const DEFAULT_CACHE_TTL_MS = 30_000;
let cachedTags: { latest?: string; preview?: string; expiresAt: number } | undefined;
let cachedTagFailure: { error: Error; cachedAtMs: number } | undefined;
let inFlightTags: Promise<{ latest?: string; preview?: string }> | undefined;

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

export async function loadUpdateVersions(
  current: string,
  options: {
    force?: boolean;
    fetchTags?: () => Promise<{ latest?: string; preview?: string }>;
    now?: number;
  } = {},
): Promise<UpdateVersions> {
  const now = options.now ?? Date.now();
  if (inFlightTags) {
    const tags = normalizeUpdateTags(await inFlightTags);
    return { current, latest: tags.latest, preview: tags.preview };
  }
  if (!options.force && cachedTags && cachedTags.expiresAt > now) {
    return { current, latest: cachedTags.latest, preview: cachedTags.preview };
  }
  if (
    !options.force &&
    cachedTagFailure &&
    now - cachedTagFailure.cachedAtMs < DEFAULT_CACHE_TTL_MS
  ) {
    throw cachedTagFailure.error;
  }
  const tagsPromise = (options.fetchTags ?? fetchTillerNpmDistTags)();
  inFlightTags = tagsPromise;
  try {
    const tags = normalizeUpdateTags(await tagsPromise);
    cachedTagFailure = undefined;
    cachedTags = { ...tags, expiresAt: now + DEFAULT_CACHE_TTL_MS };
    return { current, latest: tags.latest, preview: tags.preview };
  } catch (error) {
    const wrappedError = error instanceof Error ? error : new Error(String(error));
    cachedTagFailure = { error: wrappedError, cachedAtMs: Date.now() };
    throw wrappedError;
  } finally {
    if (inFlightTags === tagsPromise) {
      inFlightTags = undefined;
    }
  }
}

function normalizeUpdateTags(tags: {
  latest?: string;
  preview?: string;
}): { latest: string; preview?: string } {
  if (typeof tags.latest !== "string" || !tags.latest.trim()) {
    throw new Error("npm registry did not return a latest version.");
  }
  return { latest: tags.latest.trim(), preview: tags.preview };
}

export function clearUpdateVersionCache(): void {
  cachedTags = undefined;
  cachedTagFailure = undefined;
}

export function createUpdateCheckService(options: {
  currentVersion: string;
  canUpdate: boolean;
  cannotUpdateReason?: string;
  manualCommand?: string;
  now?: () => string;
  cacheTtlMs?: number;
  loadVersions?: (current: string, force?: boolean) => Promise<UpdateVersions>;
}) {
  const now = options.now ?? (() => new Date().toISOString());
  const cacheTtlMs = options.cacheTtlMs ?? 30_000;
  const loadVersions = options.loadVersions ?? ((current: string, force?: boolean) =>
    loadUpdateVersions(current, { force }));
  let cached: { result: UpdateCheckResult; cachedAtMs: number } | undefined;
  let cachedFailure: { error: Error; cachedAtMs: number } | undefined;
  let inFlight: Promise<UpdateCheckResult> | undefined;

  async function check(force = false): Promise<UpdateCheckResult> {
    const nowMs = Date.now();
    if (inFlight) {
      return inFlight;
    }
    if (!force && cached && nowMs - cached.cachedAtMs < cacheTtlMs) {
      return cached.result;
    }
    if (!force && cachedFailure && nowMs - cachedFailure.cachedAtMs < cacheTtlMs) {
      throw cachedFailure.error;
    }
    const request = performCheck(force);
    const trackedRequest = request.finally(() => {
      if (inFlight === trackedRequest) {
        inFlight = undefined;
      }
    });
    inFlight = trackedRequest;
    return trackedRequest;
  }

  async function performCheck(force: boolean): Promise<UpdateCheckResult> {
    const currentVersion = options.currentVersion;
    try {
      const versions = await loadVersions(currentVersion, force);
      if (typeof versions.latest !== "string" || !versions.latest.trim()) {
        throw new Error("npm registry did not return a latest version.");
      }
      const result: UpdateCheckResult = {
        currentVersion,
        latestVersion: versions.latest.trim(),
        updateAvailable: isVersionGreater(versions.latest, currentVersion),
        canUpdate: options.canUpdate,
        checkStatus: "checked",
        ...(options.canUpdate ? {} : { cannotUpdateReason: options.cannotUpdateReason }),
        ...(options.manualCommand ? { manualCommand: options.manualCommand } : {}),
        checkedAt: now(),
      };
      cached = { result, cachedAtMs: Date.now() };
      cachedFailure = undefined;
      return result;
    } catch (error) {
      const result: UpdateCheckResult = {
        currentVersion,
        updateAvailable: false,
        canUpdate: options.canUpdate,
        checkStatus: "failed",
        cannotUpdateReason: options.canUpdate
          ? undefined
          : options.cannotUpdateReason,
        ...(options.manualCommand ? { manualCommand: options.manualCommand } : {}),
        checkedAt: now(),
      };
      const wrappedError = Object.assign(
        new Error(error instanceof Error ? error.message : String(error)),
        { result },
      );
      cachedFailure = { error: wrappedError, cachedAtMs: Date.now() };
      throw wrappedError;
    }
  }

  return { check };
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
