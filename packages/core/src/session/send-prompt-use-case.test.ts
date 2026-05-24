import assert from "node:assert/strict";
import test from "node:test";
import { SendPromptUseCase } from "./send-prompt-use-case";

test("SendPromptUseCase sends the first prompt asynchronously after acknowledging it", async () => {
  const calls: string[] = [];
  let inFlight = false;
  let rejectRuntimePrompt!: (error: Error) => void;
  let runtimePromptStartedResolve!: () => void;
  const runtimePromptBlocked = new Promise<never>((_resolve, reject) => {
    rejectRuntimePrompt = reject;
  });
  const useCase = new SendPromptUseCase({
    runtime: {
      prompt: async () => {
        calls.push("runtime.prompt");
        runtimePromptStartedResolve();
        return runtimePromptBlocked;
      },
    },
    promptQueue: {
      hasInFlight: () => inFlight,
      enqueue: () => {
        throw new Error("should not queue first prompt");
      },
      markInFlight: () => {
        inFlight = true;
        calls.push("queue.markInFlight");
        return { id: "in-flight" };
      },
      snapshot: () => ({ inFlight }),
    },
    projector: {
      appendUserMessage: async () => {
        calls.push("projector.appendUserMessage");
      },
    },
    createUserMessage: ({ text }) => ({ text }),
    onQueueChanged: () => {
      calls.push("queue.changed");
    },
    onPromptFailed: () => {
      calls.push("prompt.failed");
    },
    onPromptSettled: () => {
      inFlight = false;
      calls.push("prompt.settled");
    },
    createClientMessageId: () => "client-1",
    now: () => new Date("2026-05-24T00:00:00.000Z"),
  });
  runtimePromptStartedResolve = () => undefined;

  const promptStarted = new Promise<void>((resolve) => {
    runtimePromptStartedResolve = resolve;
  });
  const result = await useCase.execute({ sessionId: "s1", text: "hello" });

  assert.deepEqual(result, { accepted: "sent" });
  assert.deepEqual(calls, ["queue.markInFlight", "queue.changed"]);

  await promptStarted;
  assert.deepEqual(calls, [
    "queue.markInFlight",
    "queue.changed",
    "projector.appendUserMessage",
    "runtime.prompt",
  ]);

  rejectRuntimePrompt(new Error("runtime failed"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    "queue.markInFlight",
    "queue.changed",
    "projector.appendUserMessage",
    "runtime.prompt",
    "prompt.failed",
    "prompt.settled",
  ]);
  assert.equal(inFlight, false);
});

test("SendPromptUseCase queues prompts while another prompt is in flight", async () => {
  const queueItem = { id: "queued-1" };
  const calls: string[] = [];
  const useCase = new SendPromptUseCase({
    runtime: {
      prompt: async () => {
        throw new Error("should not call runtime when queuing");
      },
    },
    promptQueue: {
      hasInFlight: () => true,
      enqueue: (input) => {
        calls.push(`queue:${input.clientMessageId}`);
        return queueItem;
      },
      markInFlight: () => {
        throw new Error("should not mark second prompt in flight");
      },
      snapshot: () => ({ queued: [queueItem] }),
    },
    projector: {
      appendUserMessage: async () => {
        throw new Error("should not persist queued prompt as message");
      },
    },
    createUserMessage: ({ text }) => ({ text }),
    onQueueChanged: () => {
      calls.push("queue.changed");
    },
    onPromptFailed: () => {
      throw new Error("queued prompt should not fail immediately");
    },
    onPromptSettled: () => {
      throw new Error("queued prompt should not settle immediately");
    },
  });

  const result = await useCase.execute({ sessionId: "s1", text: "later", clientMessageId: "client-2" });

  assert.deepEqual(result, { accepted: "queued", queueItem });
  assert.deepEqual(calls, ["queue:client-2", "queue.changed"]);
});
