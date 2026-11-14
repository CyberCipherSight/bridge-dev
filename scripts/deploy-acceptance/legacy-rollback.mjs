// Real user-manager compatibility gate for an explicitly supplied old public runtime.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { fixturePorts } from "../test-ports.mjs";
import {
  createReleaseBundle,
  stageBundle,
  seedLocalRelease,
} from "../../dist/lib/service-release.js";
import {
  installService,
  controlService,
  queueServiceOperation,
  jobResult,
} from "../../dist/lib/service-manager.js";
import { readServiceConfig, systemctl } from "../../dist/lib/service-config.js";
if (!process.argv.includes("--execute-staging"))
  throw Error("Explicit --execute-staging required");
const value = (key) => process.argv[process.argv.indexOf(key) + 1];
if (
  !process.argv.includes("--legacy-release") ||
  !process.argv.includes("--evidence")
)
  throw Error("--legacy-release and --evidence required");
const old = path.resolve(value("--legacy-release")),
  evidence = path.resolve(value("--evidence"));
await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
const root = await fs.mkdtemp(
    path.join(os.homedir(), ".local/state/bridge-dev-legacy-qa-"),
  ),
  workspace = path.join(root, "workspace"),
  state = path.join(root, "state"),
  envFile = path.join(root, "fixture.env"),
  install = path.join(root, "install"),
  unit = "bridge-dev-legacy-qa-" + randomUUID() + ".service",
  [port, admin] = await fixturePorts(2),
  current = "f".repeat(40);
await fs.mkdir(workspace);
await fs.mkdir(state);
let configured = false,
  result = { unit, root, production: "unchanged" };
await fs.writeFile(
  path.join(evidence, "plan.json"),
  JSON.stringify(
    {
      unit,
      root,
      source: old,
      ports: [port, admin],
      operations: [
        "install temporary candidate unit with synthetic credentials",
        "queue rollback to retained public old runtime",
        "verify final success receipt and selected release",
        "uninstall own unit and remove own fixture",
      ],
      rollback:
        "controller restores candidate on failure; finally uninstalls staging unit",
    },
    null,
    2,
  ),
);
try {
  await fs.writeFile(
    envFile,
    `HOME=${root}\nBRIDGEDEV_RUNTIME_MODE=portable\nBRIDGEDEV_STATE_DIR=${state}\nWORKSPACE_PATH=${workspace}\nPORT=${port}\nADMIN_PORT=${admin}\nMCP_TOKEN=${randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "")}\nADMIN_TOKEN=${randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "")}\nMCP_UPSTREAM_CONFIG=${state}/providers.json\nMCP_SHELL_STATE_DIR=${state}/shell\nLOCAL_CODER_JOB_ROOT=${state}/jobs\nCHECKPOINT_ENABLED=false\n`,
    { mode: 0o600 },
  );
  await stageBundle(
    await createReleaseBundle(process.cwd(), current),
    install,
    current,
    { staging: true },
  );
  await installService({
    root: install,
    envFile,
    source: path.join(install, "releases", current),
    unit,
    enable: false,
  });
  configured = true;
  await controlService("start", install);
  const legacy = await seedLocalRelease(install, old);
  const launch = await queueServiceOperation(
    "rollback",
    legacy.commit,
    install,
  );
  result.job = launch;
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    const done = await jobResult(install, launch.job_id);
    if (["SUCCESS", "ROLLED_BACK", "FAILED"].includes(done.status)) {
      result.result = done;
      break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.equal(result.result?.status, "SUCCESS", JSON.stringify(result.result));
  assert.equal((await readServiceConfig(install)).current, legacy.commit);
  assert.equal(
    await fs.readlink(path.join(install, "operator")),
    path.join("releases", current),
    "Management CLI must survive a pre-service gateway rollback",
  );
  result.ok = true;
} finally {
  if (configured) await controlService("uninstall", install);
  await systemctl(["reset-failed", unit], false);
  await fs.writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(result, null, 2),
  );
  await fs.rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(result, null, 2));
}
