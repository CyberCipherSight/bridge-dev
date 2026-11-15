// Explicit local-provider inventory probe; no package acquisition or production configuration.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const [launcher, out, ...args] = process.argv.slice(2);
if (!launcher || !out || ![launcher, out].every(path.isAbsolute))
  throw Error(
    "Usage: node scripts/inspect-reviewed-provider.mjs /absolute/reviewed-node-script /absolute/output.json [args...]",
  );
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-reviewed-probe-"));
const client = new Client({ name: "bridge-reviewed-probe", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [launcher, ...args],
  env: {
    PATH: path.dirname(process.execPath),
    HOME: root,
    USERPROFILE: root,
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
    XDG_CACHE_HOME: path.join(root, "cache"),
  },
  stderr: "pipe",
});
try {
  await client.connect(transport);
  const list = await client.listTools();
  await fs.writeFile(out, JSON.stringify(list, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify({
      advertised: list.tools.length,
      readonly: list.tools
        .filter((t) => t.annotations?.readOnlyHint)
        .map((t) => t.name),
      runtime_invocations: 0,
    }),
  );
} finally {
  await client.close();
  await fs.rm(root, { recursive: true, force: true });
}
