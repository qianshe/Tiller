export type HelmUpdateIntent = {
  targetVersion: string;
  requestedAt: string;
};

export const HELM_UPDATE_INTENT_TTL_MS = 10 * 60 * 1000;

type ParsedVersion = {
  core: [number, number, number];
  prerelease: string[];
};

type UpdateIntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function intentStorageKey(helmKey: string) {
  return `tiller.helm-update-intent:${encodeURIComponent(helmKey)}`;
}

function browserStorage(): UpdateIntentStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function readHelmUpdateIntent(
  helmKey: string,
  storage: UpdateIntentStorage | null = browserStorage(),
  nowMs = Date.now(),
): HelmUpdateIntent | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(intentStorageKey(helmKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HelmUpdateIntent>;
    if (
      typeof parsed.targetVersion !== "string" ||
      !parsed.targetVersion.trim() ||
      typeof parsed.requestedAt !== "string"
    ) {
      return null;
    }
    const requestedAtMs = Date.parse(parsed.requestedAt);
    if (!Number.isFinite(requestedAtMs)) return null;
    if (nowMs - requestedAtMs > HELM_UPDATE_INTENT_TTL_MS) {
      storage.removeItem(intentStorageKey(helmKey));
      return null;
    }
    return {
      targetVersion: parsed.targetVersion,
      requestedAt: parsed.requestedAt,
    };
  } catch {
    return null;
  }
}

export function writeHelmUpdateIntent(
  helmKey: string,
  targetVersion: string,
  storage: UpdateIntentStorage | null = browserStorage(),
) {
  if (!storage || !targetVersion.trim()) return;
  try {
    storage.setItem(
      intentStorageKey(helmKey),
      JSON.stringify({ targetVersion, requestedAt: new Date().toISOString() }),
    );
  } catch {
    // A storage failure must not block the update itself.
  }
}

export function clearHelmUpdateIntent(
  helmKey: string,
  storage: UpdateIntentStorage | null = browserStorage(),
) {
  if (!storage) return;
  try {
    storage.removeItem(intentStorageKey(helmKey));
  } catch {
    // A storage failure must not block the connection or reload flow.
  }
}

export function isHelmVersionAtLeast(current: string, target: string) {
  const currentVersion = parseVersion(current);
  const targetVersion = parseVersion(target);
  if (!currentVersion || !targetVersion) {
    return current.trim() === target.trim();
  }
  return compareVersions(currentVersion, targetVersion) >= 0;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): -1 | 0 | 1 {
  for (let index = 0; index < left.core.length; index += 1) {
    const leftPart = left.core[index] ?? 0;
    const rightPart = right.core[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const result = comparePrereleasePart(left.prerelease[index], right.prerelease[index]);
    if (result !== 0) return result;
  }
  return 0;
}

function comparePrereleasePart(left = "", right = ""): -1 | 0 | 1 {
  if (left === right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  const leftNumber = /^\d+$/u.test(left);
  const rightNumber = /^\d+$/u.test(right);
  if (leftNumber && rightNumber) {
    return Number(left) > Number(right) ? 1 : -1;
  }
  if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
  return left > right ? 1 : -1;
}
