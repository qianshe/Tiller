import assert from "node:assert/strict";
import test from "node:test";
import { generateOpenRpcDocument } from "./openrpc";

test("OpenRPC document includes core request and notification methods", () => {
  const doc = generateOpenRpcDocument();
  assert.equal(doc.openrpc, "1.3.2");
  assert.equal(doc.info.title, "Tiller Sync Protocol");
  const names = doc.methods.map((method) => method.name);
  assert.ok(names.includes("helm/list"));
  assert.ok(names.includes("session/prompt"));
  assert.ok(names.includes("session/update"));
  assert.ok(names.includes("session/cancel"));
});

test("request methods carry a result schema, notifications do not", () => {
  const doc = generateOpenRpcDocument();
  const prompt = doc.methods.find((method) => method.name === "session/prompt");
  const cancel = doc.methods.find((method) => method.name === "session/cancel");
  assert.ok(prompt?.result);
  assert.equal(cancel?.result, undefined);
});
