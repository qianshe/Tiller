import assert from "node:assert/strict";
import test from "node:test";
import type { AcpAgentProvider } from "@tiller/shared";
import { cleanupDraftProviderRuntime } from "./draft-cleanup";

const openCodeProvider: AcpAgentProvider = {
  id: "opencode",
  name: "OpenCode",
  command: "opencode",
  args: ["acp"],
  transport: "stdio",
  protocol: "acp",
};

test("cleanupDraftProviderRuntime uses provider-native delete after ACP close", async () => {
  let closeCalled = false;
  const result = await cleanupDraftProviderRuntime(
    {
      runtimeSessionId: "ses_draft",
      sessionCapabilities: { sessionClose: true },
      close: async () => {
        closeCalled = true;
        return {
          kind: "remote-closed",
          providerId: "opencode",
          message: "closed",
        };
      },
      cancel: () => undefined,
    },
    openCodeProvider,
    {
      exec(command, args) {
        assert.equal(command, "opencode");
        assert.deepEqual(args, ["session", "delete", "ses_draft"]);
        return "deleted";
      },
    },
  );

  assert.equal(closeCalled, true);
  assert.deepEqual(result, {
    kind: "remote-deleted",
    providerId: "opencode",
    message: "OpenCode remote session deleted: ses_draft",
  });
});

test("cleanupDraftProviderRuntime keeps SDK close result when provider has no native cleanup", async () => {
  const result = await cleanupDraftProviderRuntime(
    {
      runtimeSessionId: "runtime-1",
      sessionCapabilities: { sessionClose: true },
      close: async () => ({
        kind: "remote-closed",
        providerId: "codex",
        message: "closed",
      }),
      cancel: () => undefined,
    },
    {
      id: "codex",
      name: "Codex",
      command: "codex-acp",
      transport: "stdio",
      protocol: "acp",
    },
  );

  assert.deepEqual(result, {
    kind: "remote-closed",
    providerId: "codex",
    message: "closed",
  });
});
