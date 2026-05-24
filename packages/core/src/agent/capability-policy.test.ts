import assert from "node:assert/strict";
import test from "node:test";
import type { AgentProviderDescriptor } from "@tiller/domain-contracts";
import { resolveAgentCapabilities, resolveSessionConfigSupport, supportsProviderCapability } from "./capability-policy";

const baseProvider: AgentProviderDescriptor = {
  id: "generic",
  name: "Generic",
  command: "generic-acp",
  transport: "stdio",
  protocol: "acp",
};

test("capability policy defaults missing booleans to false", () => {
  const capabilities = resolveAgentCapabilities(baseProvider);

  assert.equal(capabilities.streaming, false);
  assert.equal(capabilities.sessionLoad, false);
  assert.equal(capabilities.imageInput, false);
  assert.deepEqual(capabilities.sessionConfig, { model: "none", reasoningEffort: "none" });
});

test("capability policy preserves explicit provider capabilities", () => {
  const provider: AgentProviderDescriptor = {
    ...baseProvider,
    capabilities: {
      streaming: true,
      sessionLoad: true,
      imageInput: true,
    },
  };

  assert.equal(supportsProviderCapability(provider, "streaming"), true);
  assert.equal(supportsProviderCapability(provider, "sessionLoad"), true);
  assert.equal(supportsProviderCapability(provider, "sessionResume"), false);
  assert.equal(supportsProviderCapability(provider, "imageInput"), true);
});

test("capability policy applies legacy command defaults for known providers", () => {
  assert.deepEqual(resolveSessionConfigSupport({ ...baseProvider, command: "codex-acp" }), {
    model: "startup",
    reasoningEffort: "startup",
    modelFormat: "model",
  });

  assert.deepEqual(resolveSessionConfigSupport({ ...baseProvider, command: "opencode" }), {
    model: "startup",
    reasoningEffort: "none",
    modelFormat: "provider/model",
  });
});
