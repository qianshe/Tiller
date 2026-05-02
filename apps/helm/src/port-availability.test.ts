import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { assertHelmPortAvailable, resolvePortProbeHosts } from "./port-availability.js";

test("resolvePortProbeHosts probes loopback when binding all interfaces", () => {
  const hosts = resolvePortProbeHosts("0.0.0.0");

  assert.ok(hosts.includes("127.0.0.1"));
});

test("assertHelmPortAvailable rejects when loopback already owns the port", async () => {
  const server = createServer();
  await listen(server, 0, "127.0.0.1");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  await assert.rejects(
    () => assertHelmPortAvailable({ host: "0.0.0.0", port: address.port, timeoutMs: 100 }),
    /already in use/u,
  );

  await close(server);
});

test("assertHelmPortAvailable allows a free loopback port", async () => {
  const server = createServer();
  await listen(server, 0, "127.0.0.1");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await close(server);

  await assertHelmPortAvailable({ host: "127.0.0.1", port, timeoutMs: 100 });
});

function listen(server: ReturnType<typeof createServer>, port: number, host: string) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
