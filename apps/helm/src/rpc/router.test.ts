import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleHelmRpcRequest } from "./router";

test("router validates params before dispatch", async () => {
  await assert.rejects(() => handleHelmRpcRequest("session/prompt", { sessionId: "s1" }, {} as any));
});

test("router dispatches helm/list to config handler", async () => {
  const result = await handleHelmRpcRequest("helm/list", {}, {
    loadAvailableHelms: () => [],
    setHelms: () => undefined,
  } as any);

  assert.deepEqual(result, { helms: [] });
});

test("router dispatches logging/get through protocol validation", async () => {
  const configPath = join(mkdtempSync(join(tmpdir(), "tiller-router-")), "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({ logging: { level: "warn", format: "pretty", acpTrace: "summary" } }),
    "utf8",
  );

  const result = await handleHelmRpcRequest("logging/get", {}, {
    configPath,
  } as any);

  assert.deepEqual(result, {
    logging: { level: "warn", format: "pretty", acpTrace: "summary" },
  });
});
