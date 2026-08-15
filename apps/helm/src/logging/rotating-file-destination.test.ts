import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRotatingFileDestination } from "./rotating-file-destination";

test("rotating destination keeps bounded generations before a write crosses the limit", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tiller-log-rotation-"));
  const filePath = join(directory, "tiller.log");
  try {
    const destination = createRotatingFileDestination({
      filePath,
      maxFileBytes: 5,
      retainedFiles: 2,
    });
    destination.write("1111");
    destination.write("2222");
    destination.write("3333");
    destination.write("4444");
    await destination.flush();
    const finished = new Promise<void>((resolve, reject) => {
      destination.once("finish", resolve);
      destination.once("error", reject);
    });
    destination.end();
    await finished;

    assert.equal(readFileSync(filePath, "utf8"), "4444");
    assert.equal(readFileSync(`${filePath}.1`, "utf8"), "3333");
    assert.equal(readFileSync(`${filePath}.2`, "utf8"), "2222");
    assert.equal(readFileSync(`${filePath}.2`, "utf8").includes("1111"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rotating destination drops low-priority queue overflow and records the count", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tiller-log-queue-"));
  const filePath = join(directory, "tiller.log");
  try {
    const destination = createRotatingFileDestination({
      filePath,
      maxQueueBytes: 32,
    });
    destination.write('{"level":"debug","event":"debug.one"}\n');
    destination.write('{"level":"debug","event":"debug.two"}\n');
    destination.write('{"level":"warn","event":"warn.one"}\n');
    await destination.flush();
    const finished = new Promise<void>((resolve, reject) => {
      destination.once("finish", resolve);
      destination.once("error", reject);
    });
    destination.end();
    await finished;

    assert.equal(destination.getDroppedCount() > 0, true);
    assert.match(readFileSync(filePath, "utf8"), /logging\.queue_dropped/u);
    assert.match(readFileSync(filePath, "utf8"), /warn\.one/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rotating destination disables file writes after an I/O failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tiller-log-write-failure-"));
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    const destination = createRotatingFileDestination({
      filePath: directory,
    });

    destination.write('{"level":"error","event":"write.failure"}\n');
    await destination.flush();
    destination.write('{"level":"error","event":"write.failure.again"}\n');
    await destination.flush();

    assert.equal(unhandledRejections.length, 0);
    destination.destroy();
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
    rmSync(directory, { recursive: true, force: true });
  }
});
