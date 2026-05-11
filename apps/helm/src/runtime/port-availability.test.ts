import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import {
  assertHelmPortAvailable,
  resolveLanAddressesFromInterfaces,
  resolvePortProbeHosts,
} from "./port-availability.js";

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

test("resolveLanAddressesFromInterfaces prefers reachable private LAN addresses", () => {
  const hosts = resolveLanAddressesFromInterfaces({
    "Virtual Test": [
      { family: "IPv4", internal: false, address: "198.18.0.1" },
      { family: "IPv4", internal: false, address: "169.254.83.107" },
    ],
    "vEthernet (WSL)": [{ family: "IPv4", internal: false, address: "172.24.224.1" }],
    "VMware Network Adapter VMnet8": [
      { family: "IPv4", internal: false, address: "192.168.80.1" },
    ],
    "Wi-Fi": [{ family: "IPv4", internal: false, address: "192.168.1.9" }],
  });

  assert.deepEqual(hosts, ["192.168.1.9", "172.24.224.1", "192.168.80.1"]);
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
