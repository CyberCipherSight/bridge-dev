import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fixturePorts } from "./test-ports.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-market-http-")),
  [port, adminPort] = await fixturePorts(2),
  token = randomBytes(32).toString("hex"),
  admin = randomBytes(32).toString("hex"),
  work = path.join(root, "work");
await fs.mkdir(work);
const env = {
  ...process.env,
  POLICYGATE_POLICY_FILE: "",
  BRIDGEDEV_RUNTIME_MODE: "portable",
  WORKSPACE_PATH: work,
  BRIDGEDEV_STATE_DIR: path.join(root, "state"),
  MCP_UPSTREAM_CONFIG: path.join(root, "mcp.json"),
  PORT: String(port),
  ADMIN_PORT: String(adminPort),
  MCP_TOKEN: token,
  ADMIN_TOKEN: admin,
};
const gateway = spawn(process.execPath, ["dist/index.js"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "",
  client;
gateway.stderr.on("data", (b) => (logs = (logs + b).slice(-6000)));
gateway.stdout.on("data", (b) => (logs = (logs + b).slice(-6000)));
async function api(url, body, credential = admin) {
  const r = await fetch(`http://127.0.0.1:${adminPort}` + url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + credential,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await r.json();
  return { status: r.status, ...value };
}
try {
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
    if (n === 99) throw Error(logs);
  }
  assert.equal((await api("/api/marketplace", undefined, "wrong")).status, 401);
  assert.equal((await api("/api/marketplace")).data.catalog_total >= 100, true);
  assert.equal((await api("/api/marketplace?limit=1000000")).status, 400);
  assert.equal(
    (
      await api("/api/marketplace/preferences", {
        service: "fixture",
        preference: "disabled",
        provider_id: "missing",
      })
    ).status,
    400,
  );
  await api("/api/marketplace/preferences", {
    service: "github",
    preference: "chatgpt-only",
    availability: "unknown",
    capabilities: [],
  });
  assert.equal(
    (await api("/api/marketplace/propose", { id: "github" })).status,
    400,
  );
  assert.equal((await api("/api/extensions")).data.providers.length, 0);
  const broken = await api("/api/extensions/provider-definition", {
    id: "missing-fixture",
    name: "Missing runtime",
    transport: "stdio",
    command: process.execPath,
    args: ["--bridge-fixture-invalid-option"],
  });
  assert.equal(
    (await api("/api/extensions/apply", { id: broken.data.id })).status,
    200,
  );
  assert.equal(
    (await api("/api/extensions/provider-test", { name: "missing-fixture" }))
      .status,
    400,
  );
  assert.match(
    (await api("/api/extensions")).data.providers.find(
      (p) => p.id === "missing-fixture",
    ).last_error,
    /PROVIDER_TEST_FAILED/,
  );
  const removal = await api("/api/extensions/provider-remove", {
    name: "missing-fixture",
  });
  await api("/api/extensions/apply", { id: removal.data.id });
  assert.ok(
    !(await api("/api/extensions")).data.entries.some(
      (e) => e.key === "mcp:missing-fixture",
    ),
    "Provider removal must remove its managed lock entry",
  );
  assert.equal(
    (await api("/api/marketplace/propose", { id: "npm-angular-cli" })).status,
    400,
    "Developer CLI must not be mistaken for an MCP provider",
  );
  const definition = await api("/api/extensions/provider-definition", {
    id: "fixture",
    name: "Reviewed fixture",
    transport: "stdio",
    command: process.execPath,
    args: [path.resolve("scripts/mock-stdio-mcp.mjs")],
  });
  assert.equal(definition.status, 200);
  assert.equal(definition.data.discovery.components[0].provider.enabled, false);
  assert.equal(
    (await api("/api/extensions")).data.providers.length,
    0,
    "Preview must not install",
  );
  assert.equal(
    (await api("/api/extensions/apply", { id: definition.data.id })).status,
    200,
  );
  const enable = await api("/api/extensions/provider-review", {
    name: "fixture",
    enabled: true,
    tools: ["echo"],
    permission: "R",
  });
  assert.equal(
    (await api("/api/extensions/apply", { id: enable.data.id })).status,
    200,
  );
  client = new Client({
    name: "independent-marketplace-schema-client",
    version: "1",
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer " + token } },
    }),
  );
  let listed = [];
  for (let n = 0; n < 80; n++) {
    listed = (await client.listTools()).tools;
    if (listed.some((t) => t.name === "fixture__echo")) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(
    listed.some((t) => t.name === "fixture__echo"),
    JSON.stringify((await api("/api/extensions")).data.providers) +
      " " +
      logs.slice(-1500),
  );
  assert.match(
    JSON.stringify(
      await client.callTool({
        name: "fixture__echo",
        arguments: { message: "marketplace-fixture" },
      }),
    ),
    /marketplace-fixture/,
  );
  const search = await client.callTool({
    name: "extensions_search",
    arguments: { query: "Reverse Engineer Anything" },
  });
  assert.equal(
    search.structuredContent.data.entries[0].state.registered,
    false,
  );
  const preference = {
    service: "fixture",
    preference: "chatgpt-only",
    availability: "unknown",
    provider_id: "fixture",
    capabilities: [],
  };
  assert.equal(
    (await api("/api/marketplace/preferences", preference)).status,
    200,
  );
  assert.equal(
    (
      await client.callTool({
        name: "fixture__echo",
        arguments: { message: "stale" },
      })
    ).isError,
    true,
  );
  assert.ok(
    !(await client.listTools()).tools.some((t) => t.name === "fixture__echo"),
  );
  assert.equal(
    (await api("/api/extensions/provider-test", { name: "fixture" })).status,
    400,
  );
  assert.equal(
    (
      await api("/api/marketplace/preferences", {
        ...preference,
        preference: "auto",
      })
    ).status,
    200,
  );
  assert.ok(
    (await client.listTools()).tools.some((t) => t.name === "fixture__echo"),
  );
  assert.equal(
    (await api("/api/extensions")).data.providers.find(
      (p) => p.id === "fixture",
    ).enabled,
    true,
    "Preferences must not rewrite reviewed configuration",
  );
  assert.ok(!logs.includes(token) && !logs.includes(admin));
  console.log(
    "PASS: authenticated catalog, disabled registration proposal, independent SDK routing, stale manifest denial, explicit opt-out, reconnect, schemas and no token leak",
  );
} finally {
  await client?.close().catch(() => {});
  gateway.kill("SIGTERM");
  await new Promise((r) =>
    gateway.exitCode !== null ? r() : gateway.once("exit", r),
  );
  await fs.rm(root, { recursive: true, force: true });
}
