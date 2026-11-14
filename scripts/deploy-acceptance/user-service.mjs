// Explicit opt-in real-user-manager rehearsal. Never uses production env/state.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";
import { fixturePorts } from "../test-ports.mjs";
import {
  createReleaseBundle,
  stageBundle,
} from "../../dist/lib/service-release.js";
import {
  makeServiceConfig,
  readServiceConfig,
  serviceStatus,
  systemctl,
} from "../../dist/lib/service-config.js";
import {
  installService,
  controlService,
  checkGateway,
  queueServiceOperation,
  jobResult,
} from "../../dist/lib/service-manager.js";
import { verifyAuditFile } from "../../dist/lib/hash-audit.js";
if (!process.argv.includes("--execute-staging") || process.platform !== "linux")
  throw Error("Explicit --execute-staging on Linux required");
const evidence = path.resolve(
  process.argv[process.argv.indexOf("--evidence") + 1] || "",
);
if (!process.argv.includes("--evidence"))
  throw Error("--evidence path required");
await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
const root = await fs.mkdtemp(
    path.join(os.homedir(), ".local/state/bridge-dev-service-qa-"),
  ),
  installRoot = path.join(root, "install"),
  workspace = path.join(root, "workspace"),
  state = path.join(root, "state"),
  envFile = path.join(root, "fixture.env"),
  unit = "bridge-dev-qa-" + randomUUID() + ".service";
await fs.mkdir(workspace);
await fs.mkdir(state);
const [port, adminPort] = await fixturePorts(2),
  token = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
  admin = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
const plan = {
  root,
  unit,
  ports: [port, adminPort],
  unit_file: path.join(os.homedir(), ".config/systemd/user", unit),
  environment: "synthetic, user-owned 0600",
  permissions:
    "0700 fixture root; read-only release files; generated compatible sandbox",
  commands: [
    "service install --no-enable",
    "service start",
    "independent SDK acceptance",
    "kill -9 staging MainPID",
    "port conflict test",
    "reviewed mock stdio provider with child",
    "service stop/start",
    "detached update success",
    "detached update failed acceptance and automatic rollback",
    "start-limit disposable drop-in",
    "service uninstall",
    "remove only enumerated staging paths",
  ],
  production:
    "no production unit, port, config, credential, ledger or Funnel changes",
  rollback:
    "stop/uninstall this uniquely named unit and remove its own drop-in and staging directory",
};
await fs.writeFile(
  path.join(evidence, "staging-plan.json"),
  JSON.stringify(plan, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(
  "Recorded staging change inventory: " +
    path.join(evidence, "staging-plan.json"),
);
const transientUnit =
    "bridge-dev-portable-" + randomUUID().replaceAll("-", "") + ".service",
  restoredUnit = transientUnit.replace(".service", "-restored.service");
await fs.writeFile(
  path.join(evidence, "transient-plan.json"),
  JSON.stringify(
    {
      units: [transientUnit, restoredUnit],
      properties: [
        "Type=exec",
        "NoNewPrivileges=yes",
        "UMask=0077",
        "KillMode=control-group",
        "Restart=no",
      ],
      environment: "same synthetic environment only",
      rollback:
        "stop only these two units and uninstall staging persistent unit",
    },
    null,
    2,
  ),
);
const result = { unit, root, checks: {}, jobs: [] },
  a = "c".repeat(40),
  b = "d".repeat(40),
  bad = "e".repeat(40);
let c;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, ms = 25000) {
  const end = Date.now() + ms;
  let error;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) {
      error = e;
    }
    await sleep(100);
  }
  throw Error("Staging deadline: " + (error?.message || "condition unmet"));
}
async function api(route, body, method) {
  const r = await fetch(`http://127.0.0.1:${adminPort}` + route, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      Authorization: "Bearer " + admin,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  const data = await r.json();
  assert.ok(r.ok, JSON.stringify(data));
  return data;
}
async function job(target, operation = "update", transient) {
  const started = await queueServiceOperation(
    operation,
    target,
    installRoot,
    transient,
  );
  result.jobs.push(started);
  const done = await wait(async () => {
    const r = await jobResult(installRoot, started.job_id);
    return ["SUCCESS", "FAILED", "ROLLED_BACK"].includes(r.status) ? r : null;
  }, 150000);
  Object.assign(started, done);
  await fs.writeFile(
    path.join(evidence, started.job_id + ".json"),
    JSON.stringify(done, null, 2),
  );
  return done;
}
try {
  await fs.writeFile(
    envFile,
    `MCP_TOKEN=${token}\nADMIN_TOKEN=${admin}\nBRIDGEDEV_RUNTIME_MODE=portable\nBRIDGEDEV_STATE_DIR=${state}\nWORKSPACE_PATH=${workspace}\nPORT=${port}\nADMIN_PORT=${adminPort}\nMCP_UPSTREAM_CONFIG=${state}/providers.json\nMCP_SHELL_STATE_DIR=${state}/shell\nCHECKPOINT_ENABLED=false\n`,
    { mode: 0o600 },
  );
  const bundle = await createReleaseBundle(process.cwd(), a);
  await stageBundle(bundle, installRoot, a, { staging: true });
  await installService({
    root: installRoot,
    envFile,
    unit,
    source: path.join(installRoot, "releases", a),
    enable: false,
    sandbox: "basic",
  });
  c = await readServiceConfig(installRoot);
  await controlService("start", installRoot);
  await wait(async () => {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(1000),
    });
    return r.ok;
  });
  result.acceptance = await checkGateway(c);
  result.checks.sdk = true;
  result.status = await serviceStatus(installRoot);
  for (const [k, v] of Object.entries({
    NoNewPrivileges: "yes",
    PrivateTmp: "no",
    ProtectHome: "no",
    ProtectSystem: "no",
  }))
    assert.equal(result.status.hardening[k], v, k);
  result.checks.hardening = true;
  const firstPid = result.status.pid;
  assert.equal(
    await fs.readlink("/proc/" + firstPid + "/ns/mnt"),
    await fs.readlink("/proc/self/ns/mnt"),
  );
  result.checks.mount_namespace = true;
  const prefix = await fs.readFile(c.audit_file),
    inode = (await fs.stat(c.audit_file)).ino;
  process.kill(firstPid, "SIGKILL");
  await wait(async () => {
    const r = await serviceStatus(installRoot);
    return r.active && r.pid !== firstPid && r.restarts >= 1;
  });
  await checkGateway(c);
  verifyAuditFile(c.audit_file);
  assert.equal((await fs.stat(c.audit_file)).ino, inode);
  assert.ok(
    (await fs.readFile(c.audit_file)).subarray(0, prefix.length).equals(prefix),
  );
  result.checks.crash_restart_audit_prefix = true;
  const conflict = spawn(
    process.execPath,
    [path.join(installRoot, "current/dist/index.js")],
    {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: root, DOTENV_CONFIG_PATH: envFile },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let conflictLog = "";
  conflict.stderr.on(
    "data",
    (b) => (conflictLog = (conflictLog + b).slice(-4000)),
  );
  assert.equal(await new Promise((r) => conflict.once("close", r)), 1);
  assert.match(conflictLog, /already in use|EADDRINUSE|failed to listen/i);
  result.checks.port_conflict = true;
  await api("/api/upstream", {
    server: {
      id: "staging-child",
      name: "Staging child fixture",
      enabled: true,
      transport: "stdio",
      command: process.execPath,
      args: [path.resolve("scripts/mock-stdio-mcp.mjs")],
      env: { PROVIDER_CHILD_FILE: path.join(workspace, "child.pid") },
      expose: "allowlist",
      tools: ["echo"],
      tool_permissions: { echo: "R" },
    },
  });
  await api("/api/extensions/provider-test", { name: "staging-child" });
  const provider = (await api("/health")).upstream.find(
    (p) => p.id === "staging-child",
  );
  const child = Number(
    await fs.readFile(path.join(workspace, "child.pid"), "utf8"),
  );
  assert.ok(provider.pid > 0 && child > 0);
  await controlService("stop", installRoot);
  for (const pid of [provider.pid, child])
    await wait(async () => {
      try {
        const s = await fs.readFile("/proc/" + pid + "/stat", "utf8");
        return /\) Z /.test(s);
      } catch {
        return true;
      }
    });
  result.provider_cleanup = { pid: provider.pid, child, stopped: true };
  await sleep(3200);
  assert.equal((await serviceStatus(installRoot)).active, false);
  result.checks.clean_stop_does_not_restart = true;
  await controlService("start", installRoot);
  await wait(async () => {
    try {
      return (await api("/health")).status === "ok";
    } catch {
      return false;
    }
  });
  await api("/api/upstream/staging-child", undefined, "DELETE");
  const other = JSON.parse(gunzipSync(bundle));
  other.commit = b;
  const marker = other.files.find((f) => f.path === "DEPLOYED_COMMIT");
  marker.data = Buffer.from(b + "\n").toString("base64");
  marker.sha256 = createHash("sha256")
    .update(b + "\n")
    .digest("hex");
  await stageBundle(gzipSync(JSON.stringify(other)), installRoot, b, {
    staging: true,
  });
  assert.equal((await job(b)).status, "SUCCESS");
  result.checks.detached_update = true;
  const broken = JSON.parse(JSON.stringify(other));
  broken.commit = bad;
  const bm = broken.files.find((f) => f.path === "DEPLOYED_COMMIT");
  bm.data = Buffer.from(bad + "\n").toString("base64");
  bm.sha256 = createHash("sha256")
    .update(bad + "\n")
    .digest("hex");
  const index = broken.files.find((f) => f.path === "dist/index.js"),
    original = { ...index, path: "dist/staging-original.js" };
  broken.files.push(original);
  const source =
    "if(process.env.BRIDGEDEV_SERVICE_ROOT)process.exit(1);else await import('./staging-original.js');\n";
  index.data = Buffer.from(source).toString("base64");
  index.sha256 = createHash("sha256").update(source).digest("hex");
  await stageBundle(gzipSync(JSON.stringify(broken)), installRoot, bad, {
    staging: true,
  });
  assert.equal((await job(bad)).status, "ROLLED_BACK");
  assert.equal((await readServiceConfig(installRoot)).current, b);
  result.checks.failed_acceptance_rollback = true;
  const dropin = path.join(os.homedir(), ".config/systemd/user", unit + ".d");
  await fs.mkdir(dropin, { mode: 0o700 });
  await fs.writeFile(
    path.join(dropin, "fixture.conf"),
    "[Unit]\nStartLimitIntervalSec=5s\nStartLimitBurst=3\n[Service]\nExecStart=\nExecStart=/usr/bin/false\nRestartSec=100ms\n",
    { mode: 0o600 },
  );
  await systemctl(["daemon-reload"]);
  await systemctl(["restart", unit], false);
  await wait(async () =>
    /Result=start-limit-hit/.test(
      await systemctl(["show", unit, "-p", "Result"], false),
    ),
  );
  result.checks.start_limit = true;
  await fs.rm(dropin, { recursive: true });
  await systemctl(["daemon-reload"]);
  await systemctl(["reset-failed", unit]);
  await systemctl(["start", unit]);
  await checkGateway(await readServiceConfig(installRoot));
  result.checks.recovery_after_start_limit = true;
  // Rehearse the actual transient restoration path with the same synthetic state.
  await controlService("stop", installRoot);
  await new Promise((resolve, reject) => {
    const child = spawn(
      "systemd-run",
      [
        "--user",
        "--collect",
        "--unit=" + transientUnit,
        "--property=Type=exec",
        "--property=Restart=no",
        "--property=NoNewPrivileges=yes",
        "--property=UMask=0077",
        "--property=KillMode=control-group",
        "--property=EnvironmentFile=" + envFile,
        "--working-directory=" + os.homedir(),
        process.execPath,
        path.join(installRoot, "releases", b, "dist/index.js"),
      ],
      { stdio: "ignore" },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error("staging transient launch")),
    );
  });
  await wait(async () => {
    try {
      return (await api("/health")).status === "ok";
    } catch {
      return false;
    }
  });
  const transient = {
    unit: transientUnit,
    app: path.join(installRoot, "releases", b),
    node: process.execPath,
    cwd: os.homedir(),
  };
  assert.equal((await job(bad, "adopt", transient)).status, "ROLLED_BACK");
  assert.equal(
    (await systemctl(["is-active", restoredUnit], false)).trim(),
    "active",
  );
  assert.equal((await serviceStatus(installRoot)).active, false);
  result.checks.transient_automatic_restore = true;
  await systemctl(["stop", restoredUnit]);
  // A successful adoption must enable the persistent unit only after acceptance.
  await new Promise((resolve, reject) => {
    const child = spawn(
      "systemd-run",
      [
        "--user",
        "--collect",
        "--unit=" + transientUnit,
        "--property=Type=exec",
        "--property=Restart=no",
        "--property=NoNewPrivileges=yes",
        "--property=UMask=0077",
        "--property=EnvironmentFile=" + envFile,
        "--working-directory=" + os.homedir(),
        process.execPath,
        path.join(installRoot, "releases", b, "dist/index.js"),
      ],
      { stdio: "ignore" },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error("staging transient launch")),
    );
  });
  await wait(async () => {
    try {
      return (await api("/health")).status === "ok";
    } catch {
      return false;
    }
  });
  assert.equal((await job(a, "adopt", transient)).status, "SUCCESS");
  assert.equal((await serviceStatus(installRoot)).enabled, true);
  result.checks.transient_adoption_enabled = true;
  result.ok = true;
} finally {
  await systemctl(["stop", transientUnit, restoredUnit], false);
  await systemctl(["reset-failed", transientUnit, restoredUnit], false);
  if (c) {
    await controlService("uninstall", installRoot).catch((e) => {
      result.cleanup_error = e.message;
    });
    await systemctl(["reset-failed", unit], false);
  }
  await fs.rm(path.join(os.homedir(), ".config/systemd/user", unit + ".d"), {
    recursive: true,
    force: true,
  });
  await systemctl(["daemon-reload"], false);
  await fs.writeFile(
    path.join(evidence, "staging-result.json"),
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
  if (!result.cleanup_error)
    await fs.rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(result, null, 2));
}
