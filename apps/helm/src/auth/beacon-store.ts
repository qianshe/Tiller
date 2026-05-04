import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TrustedClientKind } from "@tiller/shared";

export type TrustedDeviceRecord = {
  deviceId: string;
  deviceName: string;
  clientKind: TrustedClientKind;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt?: string | null;
};

export type TrustedDeviceRegistry = {
  devices: TrustedDeviceRecord[];
};

export type TrustedDeviceIssueInput = {
  deviceId: string;
  deviceName: string;
  clientKind: TrustedClientKind;
};

export type TrustedDeviceAuthenticateInput = {
  deviceId: string;
  token: string;
};

export type TrustedDeviceAuthenticateResult =
  | {
      ok: true;
      record: TrustedDeviceRecord;
      trustedUntil: string;
      message: string;
    }
  | {
      ok: false;
      requiresPairing: true;
      message: string;
      reason: "not-found" | "token-mismatch" | "expired" | "revoked";
    };

export function createTrustedDeviceStore(filePath: string, options?: { now?: () => Date }) {
  const now = options?.now ?? (() => new Date());
  let registry = loadTrustedDeviceRegistry(filePath);

  return {
    issue(input: TrustedDeviceIssueInput) {
      const token = randomBytes(32).toString("hex");
      const issuedAt = now().toISOString();
      const existing = registry.devices.find((item) => item.deviceId === input.deviceId);
      const record: TrustedDeviceRecord = {
        deviceId: input.deviceId,
        deviceName: input.deviceName,
        clientKind: input.clientKind,
        tokenHash: hashToken(token),
        createdAt: existing?.createdAt ?? issuedAt,
        lastSeenAt: issuedAt,
        expiresAt: addDays(issuedAt, 7),
        revokedAt: null,
      };
      registry = upsertTrustedDeviceRecord(registry, record);
      persistOrDeleteRegistry(filePath, registry);
      return { token, record };
    },
    authenticate(input: TrustedDeviceAuthenticateInput): TrustedDeviceAuthenticateResult {
      const currentTime = now().toISOString();
      const record = registry.devices.find((item) => item.deviceId === input.deviceId);
      if (!record) {
        persistOrDeleteRegistry(filePath, registry);
        return {
          ok: false,
          requiresPairing: true,
          reason: "not-found",
          message: "Beacon not found. Pair again.",
        };
      }
      if (record.revokedAt) {
        return {
          ok: false,
          requiresPairing: true,
          reason: "revoked",
          message: "Beacon revoked. Pair again.",
        };
      }
      if (Date.parse(record.expiresAt) <= Date.parse(currentTime)) {
        registry = {
          devices: registry.devices.filter((item) => item.deviceId !== input.deviceId),
        };
        persistOrDeleteRegistry(filePath, registry);
        return {
          ok: false,
          requiresPairing: true,
          reason: "expired",
          message: "Beacon expired. Pair again.",
        };
      }
      if (record.tokenHash !== hashToken(input.token)) {
        return {
          ok: false,
          requiresPairing: true,
          reason: "token-mismatch",
          message: "Beacon token mismatch. Pair again.",
        };
      }

      const nextRecord: TrustedDeviceRecord = {
        ...record,
        lastSeenAt: currentTime,
        expiresAt: addDays(currentTime, 7),
      };
      registry = upsertTrustedDeviceRecord(registry, nextRecord);
      persistOrDeleteRegistry(filePath, registry);
      return {
        ok: true,
        record: nextRecord,
        trustedUntil: nextRecord.expiresAt,
        message: "Beacon authenticated.",
      };
    },
    list() {
      registry = pruneExpiredRecords(registry, now);
      persistOrDeleteRegistry(filePath, registry);
      return [...registry.devices];
    },
    revoke(deviceId: string) {
      const exists = registry.devices.some((item) => item.deviceId === deviceId);
      registry = {
        devices: registry.devices.filter((item) => item.deviceId !== deviceId),
      };
      persistOrDeleteRegistry(filePath, registry);
      return exists;
    },
  };
}

function loadTrustedDeviceRegistry(filePath: string): TrustedDeviceRegistry {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as TrustedDeviceRegistry;
    if (!parsed?.devices || !Array.isArray(parsed.devices)) {
      return { devices: [] };
    }
    return { devices: parsed.devices.filter(isTrustedDeviceRecord) };
  } catch {
    return { devices: [] };
  }
}

function persistOrDeleteRegistry(filePath: string, registry: TrustedDeviceRegistry) {
  if (!registry.devices.length) {
    try {
      unlinkSync(filePath);
    } catch {
      // ignore
    }
    return;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(registry, null, 2));
}

function upsertTrustedDeviceRecord(
  registry: TrustedDeviceRegistry,
  record: TrustedDeviceRecord,
): TrustedDeviceRegistry {
  return {
    devices: [record, ...registry.devices.filter((item) => item.deviceId !== record.deviceId)],
  };
}

function pruneExpiredRecords(
  registry: TrustedDeviceRegistry,
  now: () => Date,
): TrustedDeviceRegistry {
  const currentTime = now().toISOString();
  return {
    devices: registry.devices.filter(
      (item) => !item.revokedAt && Date.parse(item.expiresAt) > Date.parse(currentTime),
    ),
  };
}

function isTrustedDeviceRecord(value: unknown): value is TrustedDeviceRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.deviceId === "string" &&
    typeof record.deviceName === "string" &&
    (record.clientKind === "web" || record.clientKind === "app") &&
    typeof record.tokenHash === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.lastSeenAt === "string" &&
    typeof record.expiresAt === "string"
  );
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function addDays(iso: string, days: number) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
