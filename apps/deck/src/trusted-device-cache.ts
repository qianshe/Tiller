export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type TrustedDeviceCache = {
  deviceId: string;
  token: string;
  trustedUntil?: string;
  lastAuthenticatedAt?: string;
};

const DEVICE_ID_STORAGE_KEY = "tiller.device-id";

export function trustedDeviceStorageKey(host: string, port: string) {
  return `tiller.trusted-device.${host}.${port}`;
}

export function getOrCreateDeviceId(storage: StorageLike, seed = fallbackDeviceId()) {
  const current = storage.getItem(DEVICE_ID_STORAGE_KEY);
  if (current) {
    return current;
  }
  storage.setItem(DEVICE_ID_STORAGE_KEY, seed);
  return seed;
}

export function readTrustedDeviceCache(storage: StorageLike, host: string, port: string): TrustedDeviceCache | null {
  try {
    const raw = storage.getItem(trustedDeviceStorageKey(host, port));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<TrustedDeviceCache>;
    if (!parsed.deviceId || !parsed.token) {
      return null;
    }
    return {
      deviceId: parsed.deviceId,
      token: parsed.token,
      trustedUntil: parsed.trustedUntil,
      lastAuthenticatedAt: parsed.lastAuthenticatedAt,
    };
  } catch {
    return null;
  }
}

export function writeTrustedDeviceCache(storage: StorageLike, host: string, port: string, cache: TrustedDeviceCache) {
  storage.setItem(trustedDeviceStorageKey(host, port), JSON.stringify(cache));
}

export function clearTrustedDeviceCache(storage: StorageLike, host: string, port: string) {
  storage.removeItem(trustedDeviceStorageKey(host, port));
}

function fallbackDeviceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `deck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
