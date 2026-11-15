// Explicit real-package acceptance. Offline: accepts already installed, operator-reviewed paths.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { fixturePorts } from "./test-ports.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const [rea, filesystem] = process.argv.slice(2);
if (!rea || !filesystem || ![rea, filesystem].every(path.isAbsolute))
  throw Error(
    "Supply reviewed absolute REA launcher and filesystem entrypoint paths. No packages are installed by this test.",
  );
for (const p of [rea, filesystem]) assert.ok((await fs.stat(p)).isFile());
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-real-providers-")),
  [port, adminPort] = await fixturePorts(2),
  token = randomBytes(32).toString("hex"),
  admin = randomBytes(32).toString("hex"),
  work = path.join(root, "work"),
  source = path.join(root, "source");
await fs.mkdir(work);
await fs.mkdir(source);
await fs.writeFile(
  path.join(work, "fixture.txt"),
  "reviewed real filesystem MCP fixture",
);
const providerEnv = {
  REA_MCP_OUTPUT_SCHEMA_PROFILE: "compact",
  HOME: root,
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_STATE_HOME: path.join(root, "state"),
  XDG_CACHE_HOME: path.join(root, "cache"),
  PATH: path.dirname(process.execPath),
};
await fs.writeFile(
  path.join(source, "bridge-dev.json"),
  JSON.stringify({
    version: 1,
    servers: [
      {
        id: "rea",
        name: "Reviewed real REA",
        transport: "stdio",
        command: process.execPath,
        args: [rea, "mcp"],
        env: providerEnv,
        enabled: false,
        expose: "none",
      },
      {
        id: "real_filesystem",
        name: "Reviewed official filesystem",
        transport: "stdio",
        command: process.execPath,
        args: [filesystem, work],
        env: providerEnv,
        enabled: false,
        expose: "none",
      },
    ],
  }),
);
const env = {
  ...process.env,
  HOME: root,
  USERPROFILE: root,
  XDG_CONFIG_HOME: providerEnv.XDG_CONFIG_HOME,
  XDG_DATA_HOME: providerEnv.XDG_DATA_HOME,
  XDG_STATE_HOME: providerEnv.XDG_STATE_HOME,
  XDG_CACHE_HOME: providerEnv.XDG_CACHE_HOME,
  POLICYGATE_POLICY_FILE: "",
  BRIDGEDEV_RUNTIME_MODE: "portable",
  WORKSPACE_PATH: work,
  BRIDGEDEV_STATE_DIR: path.join(root, "gateway-state"),
  MCP_UPSTREAM_CONFIG: path.join(root, "mcp.json"),
  AUDIT_LOG_PATH: path.join(root, "audit.jsonl"),
  PORT: String(port),
  ADMIN_PORT: String(adminPort),
  MCP_TOKEN: token,
  ADMIN_TOKEN: admin,
};
let client,
  logs = "";
const gateway = spawn(process.execPath, ["dist/index.js"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
for (const pipe of [gateway.stdout, gateway.stderr])
  pipe.on("data", (b) => (logs = (logs + b).slice(-16000)));
async function api(url, body) {
  const r = await fetch(`http://127.0.0.1:${adminPort}` + url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + admin,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await r.json();
  assert.equal(r.status, 200, JSON.stringify(value));
  return value.data;
}
try {
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
    if (n === 99) throw Error(logs);
  }
  const discovery = await api("/api/extensions/discover", { source });
  const proposal = await api("/api/extensions/discover", {
    source,
    selection: discovery.components.map((c) => "mcp:" + c.id),
  });
  await api("/api/extensions/apply", { id: proposal.id });
  const reaTest = await api("/api/extensions/provider-test", { name: "rea" }),
    filesystemTest = await api("/api/extensions/provider-test", {
      name: "real_filesystem",
    });
  assert.ok(reaTest.tools.some((t) => t.name === "search_guidance"));
  const fsTool = filesystemTest.tools.find((t) => t.name === "read_text_file");
  assert.ok(fsTool, JSON.stringify(filesystemTest.tools.map((t) => t.name)));
  for (const [name, tools] of [
    ["rea", ["search_guidance", "read_guidance_section", "guided_workflows"]],
    ["real_filesystem", ["read_text_file"]],
  ]) {
    const p = await api("/api/extensions/provider-review", {
      name,
      enabled: true,
      tools,
      permission: "R",
    });
    await api("/api/extensions/apply", { id: p.id });
  }
  client = new Client({
    name: "real-independent-provider-client",
    version: "1",
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer " + token } },
    }),
  );
  let list;
  for (let n = 0; n < 100; n++) {
    list = (await client.listTools()).tools;
    if (
      list.some((t) => t.name === "rea__search_guidance") &&
      list.some((t) => t.name === "real_filesystem__read_text_file")
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(list.some((t) => t.name === "rea__search_guidance"));
  const guidance = await client.callTool({
    name: "rea__search_guidance",
    arguments: { query: "javascript", limit: 1 },
  });
  assert.ok(!guidance.isError, JSON.stringify(guidance));
  assert.ok(guidance.structuredContent?.result);
  const result = guidance.structuredContent.result;
  const match = result.matches?.[0];
  if (match?.locator) {
    const section = await client.callTool({
      name: "rea__read_guidance_section",
      arguments: { locator: match.locator },
    });
    assert.ok(!section.isError, JSON.stringify(section));
  }
  const workflows = await client.callTool({
    name: "rea__guided_workflows",
    arguments: { action: "list" },
  });
  assert.ok(!workflows.isError, JSON.stringify(workflows));
  const file = await client.callTool({
    name: "real_filesystem__read_text_file",
    arguments: { path: path.join(work, "fixture.txt") },
  });
  assert.ok(!file.isError, JSON.stringify(file));
  assert.match(JSON.stringify(file), /reviewed real filesystem MCP fixture/);
  const denied = await client.callTool({
    name: "real_filesystem__write_file",
    arguments: { path: path.join(work, "escape.txt"), content: "denied" },
  });
  assert.equal(denied.isError, true);
  for (const name of ["rea", "real_filesystem"]) {
    const p = await api("/api/extensions/provider-review", {
      name,
      enabled: false,
    });
    await api("/api/extensions/apply", { id: p.id });
  }
  assert.equal(
    (
      await client.callTool({
        name: "rea__search_guidance",
        arguments: { query: "stale" },
      })
    ).isError,
    true,
  );
  const audit = await fs.readFile(
    path.join(root, "gateway-state", "audit.jsonl"),
    "utf8",
  );
  assert.match(audit, /operator_extension_approval/);
  assert.ok(!logs.includes(token) && !logs.includes(admin));
  console.log(
    JSON.stringify({
      result: "PASS",
      rea_accepted_schemas: reaTest.tools.length,
      rea_rejected_schemas: (
        await api("/api/extensions/provider-tools?name=rea")
      ).rejected.length,
      rea_exposed: 3,
      rea_invoked: match?.locator ? 3 : 2,
      rea_guidance_status: result.status,
      filesystem_discovered: filesystemTest.tools.length,
      filesystem_exposed: 1,
      filesystem_invoked: 1,
      schemas_validated_by: "official SDK client",
      credentials: "synthetic",
      source_hashes: await Promise.all(
        [rea, filesystem].map(async (p) =>
          createHash("sha256")
            .update(await fs.readFile(p))
            .digest("hex"),
        ),
      ),
    }),
  );
} finally {
  await client?.close().catch(() => {});
  gateway.kill("SIGTERM");
  await new Promise((r) =>
    gateway.exitCode !== null ? r() : gateway.once("exit", r),
  );
  await fs.rm(root, { recursive: true, force: true });
}
