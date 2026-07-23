import assert from "node:assert/strict";
import test from "node:test";
import * as helmList from "./helm/list";
import * as helmSave from "./helm/save";
import * as loggingGet from "./logging/get";
import * as loggingSave from "./logging/save";
import * as agentTest from "./agent/test";
import * as deviceRevoke from "./device/revoke";
import * as sessionListLegacyEvidence from "./session/list-legacy-evidence";

test("R1 descriptor parses empty params and array result", () => {
  assert.equal(helmList.method, "helm/list");
  assert.deepEqual(helmList.ParamsSchema.parse({}), {});
  assert.deepEqual(helmList.ResultSchema.parse({ helms: [] }), { helms: [] });
});

test("R2 descriptor requires the typed payload param", () => {
  assert.equal(helmSave.method, "helm/save");
  assert.throws(() => helmSave.ParamsSchema.parse({}), /helm/);
  assert.deepEqual(
    helmSave.ResultSchema.parse({ ok: true, helmId: "h1", message: "saved" }),
    { ok: true, helmId: "h1", message: "saved" },
  );
});

test("R3 descriptor expects single id param and ok/message result", () => {
  assert.equal(agentTest.method, "agent/test");
  assert.deepEqual(
    agentTest.ParamsSchema.parse({ providerId: "claude" }),
    { providerId: "claude" },
  );
  assert.equal(deviceRevoke.method, "device/revoke");
  assert.deepEqual(
    deviceRevoke.ResultSchema.parse({ ok: true, deviceId: "d1", message: "ok" }),
    { ok: true, deviceId: "d1", message: "ok" },
  );
});

test("logging descriptors parse current settings and patches", () => {
  assert.equal(loggingGet.method, "logging/get");
  assert.deepEqual(loggingGet.ParamsSchema.parse({}), {});
  assert.deepEqual(
    loggingGet.ResultSchema.parse({
      logging: { level: "trace", format: "pretty", acpTrace: "summary" },
    }),
    { logging: { level: "trace", format: "pretty", acpTrace: "summary" } },
  );
  assert.equal(loggingSave.method, "logging/save");
  assert.deepEqual(
    loggingSave.ParamsSchema.parse({ logging: { level: "debug" } }),
    { logging: { level: "debug" } },
  );
  assert.throws(
    () => loggingSave.ParamsSchema.parse({ logging: { level: "verbose" } }),
    /Invalid option/,
  );
});

test("legacy evidence descriptor pages one raw source without timeline entities", () => {
  assert.equal(sessionListLegacyEvidence.method, "session/list_legacy_evidence");
  assert.deepEqual(
    sessionListLegacyEvidence.ParamsSchema.parse({
      sessionId: "session-1",
      source: "message",
      limit: 20,
      after: "12",
    }),
    { sessionId: "session-1", source: "message", limit: 20, after: "12" },
  );
  assert.deepEqual(
    sessionListLegacyEvidence.ResultSchema.parse({
      sessionId: "session-1",
      source: "message",
      items: [{ source: "message", sourcePosition: 12, entity: { id: "legacy-message" } }],
      issues: [],
      hasMore: false,
    }),
    {
      sessionId: "session-1",
      source: "message",
      items: [{ source: "message", sourcePosition: 12, entity: { id: "legacy-message" } }],
      issues: [],
      hasMore: false,
    },
  );
});
