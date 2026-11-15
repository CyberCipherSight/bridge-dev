#!/usr/bin/env node
import {readPortableMode} from "./lib/portable-mode.js";

/**
 * BridgeDev CLI — Self-hosted MCP Development Gateway
 */

import "dotenv/config";
import {startConfiguredService} from "./lib/service-manager.js";
import {serviceCli} from "./lib/service-cli.js";
import {readServiceConfig,serviceStatus as userServiceStatus} from "./lib/service-config.js";
import {verifyAuditFile,redactAudit} from "./lib/hash-audit.js";
import {extensionCli,operatorApi} from "./lib/extension-cli.js";
import {controllerCli} from "./lib/controller-cli.js";
import {parseCliArguments} from "./lib/cli-arguments.js";
import {hostControllerAvailable} from "./lib/host-controller.js";
import {tailscaleEndpoint,enableTailscaleFunnel} from "./lib/tailscale.js";
import { execSync, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { formatMcpEndpoint, inspectLocalMode, resolveProjectDirectory, validateProjectName, verifyAuditProof } from "./lib/cli-security.js";
import { platformCapabilities, getRuntimeMode, portableStateDir, portableWorkspace, portableWorkspaceRoots } from "./lib/runtime.js";

const VERSION = "2.0.0";

// Standard canonical & backward-compatible paths
const CANONICAL_DIRS = {
  opt: "/opt/bridge-dev",
  etc: "/etc/bridge-dev",
  lib: "/var/lib/bridge-dev",
  log: "/var/log/bridge-dev",
  srv: "/srv/bridge-dev",
};

const LEGACY_DIRS = {
  opt: "/opt/local-coder-policygate",
  etc: "/etc/local-coder-policygate",
  lib: "/var/lib/local-coder-policygate",
  log: "/var/log/local-coder-policygate",
  srv: "/srv/local-coder",
};

function getActivePath(sub: "etc" | "lib" | "log" | "srv" | "opt"): string {
  if (getRuntimeMode() === "portable") return path.join(portableStateDir(), sub);
  const canon = CANONICAL_DIRS[sub];
  const legacy = LEGACY_DIRS[sub];
  if (fs.existsSync(canon)) return canon;
  if (fs.existsSync(legacy)) return legacy;
  return canon;
}

function getServiceUnit(): string | null {
  if (process.platform !== "linux" || getRuntimeMode() === "portable") return null;
  const units = [
    "bridge-dev.service",
    "chatgpt-local-coder-policygate.service",
    "chatgpt-local-coder.service",
  ];
  for (const u of units) {
    try {
      const out = execSync(`systemctl is-active ${u} 2>/dev/null`, { encoding: "utf8" }).trim();
      if (out === "active" || out === "activating") return u;
    } catch {}
  }
  return null;
}

interface HealthResponse {
  status: string;
  runtimeMode?: string;
  name?: string;
  workspace?: string;
  activeSessions?: number;
  instructions?: {
    tool_profile?: string;
  };
}

function fetchHealth(port = 3000): Promise<HealthResponse | null> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 1500,headers:{Authorization:"Bearer "+(process.env.MCP_TOKEN||"")} }, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function getActiveMode(): { mode: string; detail: string } {
  if (hostControllerAvailable()) {
    const libDir = fs.existsSync("/var/lib/local-coder-policygate")
      ? "/var/lib/local-coder-policygate"
      : fs.existsSync("/var/lib/bridge-dev")
      ? "/var/lib/bridge-dev"
      : getActivePath("lib");
    const etcDir = fs.existsSync("/etc/local-coder-policygate")
      ? "/etc/local-coder-policygate"
      : fs.existsSync("/etc/bridge-dev")
      ? "/etc/bridge-dev"
      : getActivePath("etc");
    const reading = inspectLocalMode({
      stateDir: libDir,
      publicKeyFile: process.env.POLICYGATE_APPROVAL_PUBLIC_KEY || path.join(etcDir, "operator-public.pem"),
      leaseFile: process.env.POLICYGATE_YOLO_LEASE || path.join(libDir, "yolo-lease.json"),
      modeFile: process.env.POLICYGATE_MODE_FILE || path.join(libDir, "mode.json"),
      activationFile: process.env.POLICYGATE_YOLO_ACTIVATION_FILE || "/var/lib/bridge-dev-operator/active-lease.json",
    });
    if (reading.mode === "YOLO") return reading;
  }
  if (getRuntimeMode() === "portable") {
    try {
      const mode = JSON.parse(fs.readFileSync(path.join(portableStateDir(), "mode.json"), "utf8"));
      if (mode.mode === "strict") return { mode: "STRICT", detail: "portable; stdio providers refused" };
    } catch {}
    return { mode: "STANDARD", detail: "portable scoped policy; OS account permissions apply" };
  }
  const libDir = getActivePath("lib");
  const etcDir = getActivePath("etc");
  return inspectLocalMode({
    stateDir: libDir,
    publicKeyFile: process.env.POLICYGATE_APPROVAL_PUBLIC_KEY || path.join(etcDir, "operator-public.pem"),
    leaseFile: process.env.POLICYGATE_YOLO_LEASE || path.join(libDir, "yolo-lease.json"),
    modeFile: process.env.POLICYGATE_MODE_FILE || path.join(libDir, "mode.json"),
    activationFile: process.env.POLICYGATE_YOLO_ACTIVATION_FILE || (hostControllerAvailable() ? "/var/lib/bridge-dev-operator/active-lease.json" : undefined),
  });
}

function getTailscaleEndpoint(): string | null {
  return tailscaleEndpoint(Number(process.env.PORT || 3000));
}

function getMappedProjects(): string[] {
  const srvDir = getActivePath("srv");
  const projDir = path.join(srvDir, "projects");
  if (!fs.existsSync(projDir)) return [];
  try {
    return fs.readdirSync(projDir).filter((f) => {
      const p = path.join(projDir, f);
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    });
  } catch {
    return [];
  }
}

async function cmdStatus(json = false) {
  const service = await userServiceStatus();
  const unit = getServiceUnit();
  const health = await fetchHealth(Number(process.env.PORT || 3000));
  const modeInfo = getActiveMode();
  const funnel = getTailscaleEndpoint();
  const projects = getMappedProjects();
  const roots = portableWorkspaceRoots();

  let serviceStatus = "stopped";
  let pid = "N/A";
  if (unit) {
    serviceStatus = "active";
    try {
      pid = execSync(`systemctl show -p MainPID --value ${unit} 2>/dev/null`, { encoding: "utf8" }).trim();
    } catch {}
  }

  const localEndpoint = `http://127.0.0.1:${process.env.PORT || 3000}`;
  const endpointStr = funnel ? `${funnel} -> ${localEndpoint}` : localEndpoint + " (local only)";

  const profile = health?.instructions?.tool_profile || "slim";
  const sessions = health?.activeSessions ?? 0;
  const workspace = health?.workspace || (getRuntimeMode() === "portable" ? portableWorkspace() : path.join(getActivePath("srv"), "workspace"));

  if (json) {
    console.log(JSON.stringify({
      ok: true,
      version: VERSION,
      platform: process.platform,
      runtime: health?.runtimeMode || (unit ? "managed" : getRuntimeMode()),
      service: {
        installed: service.installed,
        unit: service.unit || unit || null,
        state: service.state || serviceStatus,
        pid: service.pid || (pid !== "N/A" ? Number(pid) : null),
        enabled: service.enabled,
        linger: service.linger,
      },
      status: health ? "connected" : "offline",
      sessions,
      profile,
      mode: modeInfo.mode,
      mode_detail: modeInfo.detail,
      default_workspace: workspace,
      authorized_workspaces: roots,
      endpoint: localEndpoint,
      public_url: funnel || null,
    }));
    return;
  }

  console.log(`BridgeDev v${VERSION}`);
  console.log(`Runtime   : ${health?.runtimeMode || (unit ? "managed system service" : getRuntimeMode())} on ${process.platform}`);
  console.log(`Service   : ${service.installed ? service.unit + " " + service.state + " (PID: " + service.pid + ")" : unit ? serviceStatus + ` (PID: ${pid}, systemd: ${unit})` : health ? "foreground server reachable" : "not detected"}`);
  console.log(`Status    : ${health ? "connected" : "offline"}${health ? ` (Profile: ${profile}, Active Sessions: ${sessions})` : ""}`);
  console.log(`Mode      : ${modeInfo.mode} (${modeInfo.detail})`);
  console.log(`Workspace : ${workspace}`);
  const extras = roots.filter(r => r !== workspace);
  if (extras.length) {
    console.log(`Authorized: ${extras.join(", ")}`);
  }
  if (projects.length) {
    console.log(`Projects  : ${projects.length} mapped project${projects.length === 1 ? "" : "s"}`);
  }
  console.log(`Endpoint  : ${endpointStr}`);
  if (service.installed) console.log("Boot      : enabled=" + service.enabled + ", linger=" + service.linger_status + ", commit=" + service.current + ", rollback=" + (service.previous || "none"));
  console.log("Next step : Run 'bridge-dev help' for commands or 'bridge-dev doctor' for diagnostics.");
}

async function cmdConnect(showToken = false) {
  const funnel = getTailscaleEndpoint();
  const baseUrl = funnel || `http://127.0.0.1:${process.env.PORT || 3000}`;
  let token = "";
  if (showToken) {
    const envFile = process.env.POLICYGATE_ENV_FILE || path.join(getActivePath("etc"), "service.env");
    try {
      const match = fs.readFileSync(envFile, "utf8").match(/^MCP_TOKEN=(.+)$/m);
      token = match?.[1]?.trim() || "";
    } catch {}
    if (!token) token = process.env.MCP_TOKEN || "";
  }
  const endpoint = formatMcpEndpoint(baseUrl, token, showToken);
  console.log("BridgeDev MCP connection");
  console.log("Endpoint : " + endpoint);
  console.log("Protocol : Streamable HTTP MCP");
  console.log("Auth     : Legacy URL token shown; /mcp also accepts a Bearer token");
  console.log(`Admin UI : http://127.0.0.1:${process.env.ADMIN_PORT || 3001} (local only, separate admin token)`);
  console.log("");
  console.log("ChatGPT: configure the custom MCP connector URL to the endpoint above.");
  console.log("Codex/Claude Code: use this MCP server URL in the client configuration:");
  console.log(JSON.stringify({mcpServers:{"bridge-dev":{url:endpoint}}},null,2));
  if (!showToken) {
    console.log("Replace <MCP_TOKEN> locally with your configured MCP token.");
    console.log("Use --show-token only in a private terminal; URLs containing tokens are secrets.");
  } else if (!token) {
    console.error("Token is not readable here; retrieve it from the independent operator securely.");
  }
}

function getEnvConfigPath(): string {
  if (process.env.DOTENV_CONFIG_PATH && fs.existsSync(process.env.DOTENV_CONFIG_PATH)) return process.env.DOTENV_CONFIG_PATH;
  const userEnv = path.join(os.homedir(), ".config", "bridge-dev", ".env");
  if (fs.existsSync(userEnv)) return userEnv;
  const localEnv = path.resolve(process.cwd(), ".env");
  return localEnv;
}

function updateEnvVariable(key: string, value: string): void {
  const envFile = getEnvConfigPath();
  let content = "";
  try { content = fs.readFileSync(envFile, "utf8"); } catch {}
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, `${key}="${value}"`);
  } else {
    content = (content.trimEnd() + `\n${key}="${value}"\n`).trimStart();
  }
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(envFile, content, { mode: 0o600 });
}

function cmdWorkspace(args: string[], json = false) {
  const action = (args[0] || "list").toLowerCase();
  const roots = portableWorkspaceRoots();
  const defaultCwd = portableWorkspace();

  if (action === "list") {
    if (json) {
      console.log(JSON.stringify({ ok: true, default_workspace: defaultCwd, authorized_roots: roots }));
      return;
    }
    console.log("Authorized Workspaces:");
    console.log(`  Default workspace : ${defaultCwd}`);
    const extras = roots.filter(r => r !== defaultCwd);
    if (extras.length) {
      console.log("  Additional authorized roots:");
      for (const r of extras) console.log(`    - ${r}`);
    } else {
      console.log("  (no additional roots configured; use 'bridge-dev workspace add <path>')");
    }
    return;
  }

  if (action === "add") {
    const rawPath = args[1];
    if (!rawPath) {
      console.error("Usage: bridge-dev workspace add <path>");
      process.exitCode = 1;
      return;
    }
    const resolved = path.resolve(rawPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      console.error(`Invalid workspace: directory not found at ${resolved}`);
      process.exitCode = 1;
      return;
    }
    const currentExtras = (process.env.EXTRA_WORKSPACE_PATHS || "")
      .split(/[;,]/)
      .map(p => p.trim())
      .filter(Boolean);
    if (!currentExtras.includes(resolved)) {
      currentExtras.push(resolved);
      updateEnvVariable("EXTRA_WORKSPACE_PATHS", currentExtras.join(";"));
      process.env.EXTRA_WORKSPACE_PATHS = currentExtras.join(";");
    }
    if (json) {
      console.log(JSON.stringify({ ok: true, added: resolved, authorized_roots: portableWorkspaceRoots() }));
      return;
    }
    console.log(`Added authorized workspace root: ${resolved}`);
    console.log("Restart BridgeDev ('bridge-dev restart') for changes to take effect.");
    return;
  }

  if (action === "remove" || action === "rm") {
    const rawPath = args[1];
    if (!rawPath) {
      console.error("Usage: bridge-dev workspace remove <path>");
      process.exitCode = 1;
      return;
    }
    const resolved = path.resolve(rawPath);
    const currentExtras = (process.env.EXTRA_WORKSPACE_PATHS || "")
      .split(/[;,]/)
      .map(p => p.trim())
      .filter(Boolean);
    const filtered = currentExtras.filter(p => path.resolve(p) !== resolved);
    updateEnvVariable("EXTRA_WORKSPACE_PATHS", filtered.join(";"));
    process.env.EXTRA_WORKSPACE_PATHS = filtered.join(";");
    if (json) {
      console.log(JSON.stringify({ ok: true, removed: resolved, authorized_roots: portableWorkspaceRoots() }));
      return;
    }
    console.log(`Removed workspace root: ${resolved}`);
    console.log("Restart BridgeDev ('bridge-dev restart') for changes to take effect.");
    return;
  }

  console.error("Usage: bridge-dev workspace [list | add <path> | remove <path>]");
  process.exitCode = 1;
}

function cmdAccess(): void {
  // Never return credentials to MCP tools, pipes, redirected logs or JSON mode.
  // A user requests them explicitly from a private interactive terminal.
  if (getRuntimeMode() !== "portable" || !process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("Access details are available only from a private interactive terminal in portable mode.");
    process.exitCode = 1;
    return;
  }
  const mcp = process.env.MCP_TOKEN || "";
  const admin = process.env.ADMIN_TOKEN || "";
  if (!mcp || !admin || mcp === admin) {
    console.error("Portable credentials not configured; run 'bridge-dev setup' first.");
    process.exitCode = 1;
    return;
  }
  const port = process.env.PORT || "3000";
  const adminPort = process.env.ADMIN_PORT || "3001";
  const funnel = getTailscaleEndpoint();
  const baseMcpUrl = funnel || `http://127.0.0.1:${port}`;
  const connectionUrl = `${baseMcpUrl}/mcp/${mcp}`;
  const dashboardUrl = `http://127.0.0.1:${adminPort}/ui/`;

  console.log("BridgeDev Access & Integration Guide\n");
  console.log("Connection URL (paste into ChatGPT Web):");
  console.log(`  ${connectionUrl}\n`);
  console.log("Dashboard URL (local operations interface):");
  console.log(`  ${dashboardUrl}\n`);
  console.log("ChatGPT Web Setup Steps (Add custom MCP server):");
  console.log("  1. Name          : BridgeDev");
  console.log("  2. Connection    : Select 'Server URL' and paste the Connection URL above");
  console.log("  3. Authentication: Select 'None' (Authentication token is embedded in the URL)");
  console.log("  4. Save          : Click Add / Save to begin using native workstation tools\n");
  console.log("Dashboard Authentication:");
  console.log("  Enter your Admin Token in memory at http://127.0.0.1:3001/ui/ to manage servers.");
}

function runOperator(args: string[]): boolean {
  if (process.platform !== "linux") {
    console.error("Signed operator mode control requires the hardened Linux installation.");
    process.exitCode = 1;
    return false;
  }
  const script = fs.existsSync("/usr/local/libexec/bridge-dev/policygate-operator.mjs")
    ? "/usr/local/libexec/bridge-dev/policygate-operator.mjs"
    : path.join(getActivePath("opt"), "scripts", "policygate-operator.mjs");
  if (!fs.existsSync(script)) {
    console.error("Operator script not installed: " + script);
    process.exitCode = 1;
    return false;
  }
  // The operator script independently requires real root UID and an interactive terminal.
  const run = spawnSync("sudo", ["--", process.execPath, script, ...args], {stdio:"inherit"});
  if (run.error || run.status !== 0) {
    console.error("Operator authorization failed. Use an independent local root terminal.");
    process.exitCode = run.status || 1;
    return false;
  }
  return true;
}

async function cmdMode(args: string[], json = false) {
  const target = args[0]?.toLowerCase();
  if (!target || target === "status") {
    const reading = getActiveMode();
    const label = reading.mode === "YOLO" ? "Full System (sudo)" :
      reading.mode === "STANDARD" ? "Read & Write" :
      reading.mode === "STRICT" ? "Unavailable (internal safety lock)" : "Operator-only / unverified";
    if (json) {
      console.log(JSON.stringify({ ok: true, mode: reading.mode, label, detail: reading.detail }));
      return;
    }
    console.log("Mode: " + label + " (" + reading.detail + ")");
    if (reading.mode === "STRICT")
      console.log("Protected state prevents Read & Write. Use 'bridge-dev mode standard' from your own terminal.");
    if (reading.mode === "UNKNOWN")
      console.log("Mode state is not readable here. Verify with the independent operator and MCP agent_status.");
    return;
  }
  if (["read-write","readwrite","rw","standard"].includes(target)) {
    if (hostControllerAvailable()) {
      runOperator(["mode","standard"]);
      console.log("Active mode switched to STANDARD.");
      return;
    }
    if (getRuntimeMode()==="portable") {
      console.log(await operatorApi("/api/mode",{mode:"standard"}));
      return;
    }
    runOperator(["mode","standard"]);
    return;
  }
  if (["sudo","full-system","yolo"].includes(target)) {
    if (getRuntimeMode()==="portable" && !process.stdin.isTTY) {
      console.error("Full System (sudo) needs the optional Linux host controller; portable mode cannot elevate.");
      process.exitCode = 1;
      return;
    }
    if (!hostControllerAvailable() && getRuntimeMode()==="portable") {
      console.error("Full System (sudo) needs the optional Linux host controller; portable mode cannot elevate.");
      process.exitCode = 1;
      return;
    }
    if (args.includes("--off")) {
      runOperator(["mode","standard"]);
      console.log("Full System deactivated. Returned to STANDARD mode.");
      return;
    }
    const durIdx = args.indexOf("--duration");
    const dur = durIdx >= 0 ? args[durIdx + 1] : undefined;
    const opArgs = dur ? ["yolo", "--duration", dur] : ["yolo", "--until-off"];
    if (!runOperator(opArgs)) return;
    const mode = getActiveMode();
    if (mode.mode === "YOLO") {
      console.log("Full System (YOLO) active: " + mode.detail);
    } else {
      console.error("Full System not confirmed: protected state reports " + mode.mode);
      process.exitCode = 1;
    }
    return;
  }
  console.error("Usage: bridge-dev mode [standard | yolo [--duration <min>] | yolo --off | status]");
  process.exitCode = 1;
}

function cmdProject(args: string[]) {
  const action = args[0]?.toLowerCase() || "list";
  if(action==="unmap"&&args[1])validateProjectName(args[1]);
  if(getRuntimeMode()==="portable"&&action==="list"){console.log("Workspace: "+portableWorkspace());console.log("Portable workspace selection uses WORKSPACE_PATH; managed bind mounts require Linux operator configuration.");return;}
  if (process.platform !== "linux") {
    console.error("Project bind-mount management is supported only by the hardened Linux installation.");
    process.exitCode = 1;
    return;
  }
  if (action === "list") {
    const projects = getMappedProjects();
    console.log("Approved project mappings:");
    if (!projects.length) console.log("  (none readable)");
    for (const project of projects) console.log("  " + project);
    return;
  }
  if (action !== "map" && action !== "unmap") {
    console.error("Usage: bridge-dev project [list | map <path> | unmap <name>]");
    process.exitCode = 1;
    return;
  }
  const provided = args[1];
  if (!provided || args.length !== 2) {
    console.error("Usage: bridge-dev project " + action + " <" + (action==="map"?"path":"name") + ">");
    process.exitCode = 1;
    return;
  }
  let validated: string;
  try {
    validated = action === "map" ? resolveProjectDirectory(provided) : validateProjectName(provided);
  } catch (err) {
    console.error("Invalid project: " + (err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
    return;
  }
  // The independent operator helper owns the ACL, bind-mount and rollback policy.
  // Never construct sudo shell strings or recursively alter ACLs in this client.
  const helper = "/usr/local/bin/policygate-project";
  if (!fs.existsSync(helper)) {
    console.error("Reviewed project-mapping helper not installed: " + helper);
    process.exitCode = 1;
    return;
  }
  const run = spawnSync("sudo", ["--", helper, action, validated], {stdio:"inherit"});
  if (run.error || run.status !== 0) {
    console.error("Project " + action + " failed; no direct fallback will be attempted.");
    process.exitCode = run.status || 1;
  }
}

async function cmdStop() {
  if(getRuntimeMode()==="portable"&&(await readServiceConfig())){await serviceCli(["service","stop"]);return;}
  if (getRuntimeMode() === "portable") {await operatorApi("/api/lifecycle/stop",{});console.log("Foreground gateway stopping");return;}
  if (process.platform !== "linux") {
    console.error("Service stop is Linux systemd-only. Stop a foreground server with Ctrl-C.");
    process.exitCode = 1;
    return;
  }
  const unit = getServiceUnit();
  if (!unit) {
    console.log("BridgeDev service is not running.");
    return;
  }
  console.log(`Stopping ${unit}...`);
  try {
    execSync(`sudo systemctl stop ${unit}`);
    console.log("Service stopped.");
  } catch (err: any) {
    console.error(`Failed to stop service: ${err.message}`);
    process.exit(1);
  }
}

async function cmdRestart() {
  if(getRuntimeMode()==="portable"&&(await readServiceConfig())){await serviceCli(["service","restart"]);return;}
  if (getRuntimeMode() === "portable") {
    await cmdStop();
    await new Promise(resolve=>setTimeout(resolve,500));
    await import("./index.js");
    return;
  }
  if (process.platform !== "linux") {
    console.error("Service restart is Linux systemd-only. Restart foreground processes manually.");
    process.exitCode = 1;
    return;
  }
  const unit = getServiceUnit();
  if (!unit) throw new Error("No managed BridgeDev service is running");
  console.log(`Restarting ${unit}...`);
  try {
    execSync(`sudo systemctl restart ${unit}`);
    let recovered = false;
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const health = await fetchHealth(Number(process.env.PORT || 3000));
      if (health) {
        recovered = true;
        break;
      }
    }
    if (recovered) {
      console.log("Service restarted successfully and healthy.");
    } else {
      console.error("Service restart did not restore MCP health on port 3000.");
      process.exitCode = 1;
    }
  } catch (err: any) {
    console.error(`Failed to restart service: ${err.message}`);
    process.exit(1);
  }
}

async function cmdDoctor(json = false) {
  const service = await userServiceStatus();
  const checks: Array<{ label: string; status: "OK" | "UNVERIFIED" | "INFO"; detail: string }> = [];
  const add = (label: string, status: "OK" | "UNVERIFIED" | "INFO", detail: string) => checks.push({ label, status, detail });
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] || "0", 10);
  add("Node runtime", nodeMajor >= 20 ? "OK" : "UNVERIFIED", process.version);
  if (getRuntimeMode() === "portable") {
    add("Persistent service", service.installed && service.active ? "OK" : "INFO", service.installed ? service.unit + " " + service.state : "not installed; foreground runtime");
    if (service.installed) {
      add("Boot activation", service.enabled && service.linger ? "OK" : "UNVERIFIED", "enabled=" + service.enabled + ", linger=" + service.linger_status);
      add("Release pointer", service.pointer_consistent ? "OK" : "UNVERIFIED", service.current);
      add("Rollback", "INFO", service.rollback_available ? service.previous : "no previous release");
      add("Service hardening", service.hardening?.NoNewPrivileges === "yes" ? "OK" : "INFO", JSON.stringify(service.hardening));
    }
    const health = await fetchHealth(Number(process.env.PORT || 3000));
    add("MCP endpoint", health ? "OK" : "UNVERIFIED", health ? "authenticated MCP gateway reachable" : "configured gateway port is unavailable");
    const admin = await new Promise<number>((resolve) => {
      const req = http.get(`http://127.0.0.1:${process.env.ADMIN_PORT || 3001}/health`, { timeout: 1500 }, res => { res.resume(); resolve(res.statusCode || 0); });
      req.on("error", () => resolve(0)); req.on("timeout", () => { req.destroy(); resolve(0); });
    });
    add("Admin endpoint", admin === 401 ? "OK" : admin === 200 ? "UNVERIFIED" : "INFO",
      admin === 401 ? "reachable, unauthenticated request denied" : admin === 200 ? "reachable, but unauthenticated health allowed" : "not running or unreachable");
    const funnel = getTailscaleEndpoint();
    add("Public tunnel", "INFO", funnel || "not configured");
    const { McpUpstreamManager } = await import("./lib/mcp-upstream-manager.js");
    const manager = new McpUpstreamManager();
    await manager.init();
    add("Optional providers", manager.initializationError ? "UNVERIFIED" : "OK", manager.initializationError || manager.listServerConfigs().length + " registered; no providers executed");
    try {
      const proof = verifyAuditFile(path.join(portableStateDir(), "audit.jsonl"));
      add("Application audit", "OK", proof.entries + " chained entries; OS append-only protection not claimed");
    } catch (error) {
      add("Application audit", "UNVERIFIED", String(error));
    }
    const mode = getActiveMode();
    add("Security mode", mode.mode !== "UNKNOWN" ? "OK" : "UNVERIFIED", mode.mode + " — " + mode.detail);
    if (hostControllerAvailable()) {
      add("Host controller", "OK", "installed at /usr/local/bin/bridge-dev-controller");
    } else {
      add("Host controller", "INFO", "optional; not installed");
    }
    if (json) {
      console.log(JSON.stringify({ ok: !checks.some(c => c.status === "UNVERIFIED"), checks }));
      return;
    }
    console.log("BridgeDev doctor");
    for (const check of checks) console.log("[" + check.status + "] " + check.label.padEnd(22) + ": " + check.detail);
    if (checks.some(check => check.status === "UNVERIFIED")) process.exitCode = 1;
    return;
  }
  if (process.platform === "linux") {
    const unit = getServiceUnit();
    add("systemd", unit ? "OK" : "UNVERIFIED", unit || "no running BridgeDev system service found");
  } else {
    add("systemd", "INFO", "not available on " + process.platform + "; foreground source build only");
  }
  const health = await fetchHealth(Number(process.env.PORT || 3000));
  add("MCP endpoint", health ? "OK" : "UNVERIFIED", health ? "HTTP 200, sessions: " + (health.activeSessions ?? 0) : "port 3000 unavailable");
  if (process.platform === "linux") {
    const admin = await new Promise<number>((resolve) => {
      const req = http.get(`http://127.0.0.1:${process.env.ADMIN_PORT || 3001}/health`, { timeout: 1500 }, res => { res.resume(); resolve(res.statusCode || 0); });
      req.on("error", () => resolve(0)); req.on("timeout", () => { req.destroy(); resolve(0); });
    });
    add("Admin endpoint", admin === 401 ? "OK" : admin === 200 ? "UNVERIFIED" : "UNVERIFIED",
      admin === 401 ? "reachable, unauthenticated request denied" : admin === 200 ? "reachable, but unauthenticated health allowed" : "not reachable");
    const funnel = getTailscaleEndpoint();
    add("Public tunnel", "INFO", funnel || "not configured");
    const log = path.join(getActivePath("log"), "audit.jsonl");
    const anchor = process.env.POLICYGATE_AUDIT_ANCHOR_FILE || path.join(getActivePath("etc"), "audit-anchor.json");
    try {
      const proof = verifyAuditProof(log, anchor);
      const st = fs.statSync(log), ast = fs.statSync(anchor);
      const flags = execFileSync("lsattr", ["-d", "--", log], { encoding: "utf8", timeout: 3000 }).trim().split(/\s+/)[0] || "";
      if (st.uid !== 0 || (st.mode & 0o777) !== 0o660 || ast.uid !== 0 || !flags.includes("a"))
        throw new Error("owner, permissions, trusted anchor or append-only flag invalid");
      add("Audit ledger", "OK", proof.entries + " chained entries, " + proof.anchoredEntries + " anchored; append-only verified");
    } catch (e) {
      add("Audit ledger", "UNVERIFIED", "chain/anchor/append-only not verified: " +
        (e instanceof Error ? e.message : String(e)) + "; run doctor as an independent root operator");
    }
    const key = path.join(getActivePath("etc"), "operator-public.pem");
    try {
      const st = fs.statSync(key);
      add("Operator public key", st.isFile() && st.uid === 0 ? "OK" : "UNVERIFIED",
        st.isFile() && st.uid === 0 ? "present, root-owned (private key not accessed)" : "invalid ownership or type");
    } catch { add("Operator public key", "UNVERIFIED", "not readable; use independent operator inspection"); }
    const mode = getActiveMode();
    add("Security mode", mode.mode !== "UNKNOWN" ? "OK" : "UNVERIFIED", mode.mode + " — " + mode.detail);
  } else {
    add("Hardened policy checks", "INFO", "not verified outside Linux systemd");
  }
  if (json) {
    console.log(JSON.stringify({ ok: !checks.some(c => c.status === "UNVERIFIED"), checks }));
    return;
  }
  console.log("BridgeDev doctor");
  for (const c of checks) {
    console.log("[" + c.status + "] " + c.label.padEnd(22) + ": " + c.detail);
  }
  if (checks.some(c => c.status === "UNVERIFIED")) process.exitCode = 1;
}

async function cmdSetup(json = false) {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] || "0", 10);
  const nodeOk = nodeMajor >= 20;

  const defaultWs = path.join(os.homedir(), "BridgeDevWorkspace");
  if (!fs.existsSync(defaultWs)) {
    try { fs.mkdirSync(defaultWs, { recursive: true }); } catch {}
  }
  const wsOk = fs.existsSync(defaultWs);

  const envFile = getEnvConfigPath();
  let mcpToken = process.env.MCP_TOKEN || "";
  let adminToken = process.env.ADMIN_TOKEN || "";
  let generatedTokens = false;

  if (!mcpToken || !adminToken) {
    if (!mcpToken) mcpToken = randomBytes(32).toString("hex");
    if (!adminToken) adminToken = randomBytes(32).toString("hex");
    generatedTokens = true;
    updateEnvVariable("MCP_TOKEN", mcpToken);
    updateEnvVariable("ADMIN_TOKEN", adminToken);
    updateEnvVariable("WORKSPACE_PATH", defaultWs);
    updateEnvVariable("PORT", "3000");
    updateEnvVariable("ADMIN_PORT", "3001");
    process.env.MCP_TOKEN = mcpToken;
    process.env.ADMIN_TOKEN = adminToken;
  }

  const service = await userServiceStatus();
  const funnel = getTailscaleEndpoint();
  const caps = platformCapabilities().capabilities;
  const roots = portableWorkspaceRoots();

  if (json) {
    console.log(JSON.stringify({
      ok: true,
      node: { version: process.version, ok: nodeOk },
      workspace: { path: defaultWs, ok: wsOk, authorized_roots: roots },
      config: { path: envFile, tokens_configured: Boolean(mcpToken && adminToken), generated: generatedTokens },
      service: { installed: service.installed, state: service.state },
      funnel: funnel || null,
      capabilities: caps,
    }));
    return;
  }

  console.log("BridgeDev Guided Setup\n");
  console.log(`[${nodeOk ? "OK" : "WARN"}] Node.js runtime: ${process.version} (v20+ recommended)`);
  console.log(`[OK] Default runtime: ${getRuntimeMode()} (scoped policy)`);
  console.log(`[${wsOk ? "OK" : "WARN"}] Default workspace: ${defaultWs}`);
  console.log(`[OK] Extensions: ${path.join(defaultWs, ".bridge-dev", "extensions.json")}`);
  console.log(`[OK] Configuration: ${envFile} (mode 0600)`);
  console.log(`[OK] Tailscale Funnel: ${funnel ? funnel : "not detected (local loopback mode)"}`);
  console.log(`[INFO] Persistent service: ${service.installed ? service.unit + " (" + service.state + ")" : "not installed"}`);
  console.log("\nNext Steps:");
  if (!service.installed && process.platform === "linux") {
    console.log("  1. Install background service: bridge-dev service install --start");
  } else {
    console.log("  1. Start BridgeDev: bridge-dev start");
  }
  console.log("  2. Display connection instructions: bridge-dev access");
  console.log("  3. Manage authorized workspaces: bridge-dev workspace list");
  console.log("  4. Run system diagnostics: bridge-dev doctor");
}

function cmdLogin(args: string[] = []) {
  if (args.length && (args.length !== 1 || args[0] !== "--generate")) {
    console.error("Usage: bridge-dev login [--generate]");
    process.exitCode = 1;
    return;
  }
  if (args[0] === "--generate") {
    console.log("New MCP token (shown once; not installed or saved):");
    console.log(randomBytes(32).toString("hex"));
    console.log("Install the token in your private configuration through the operator-controlled workflow.");
    return;
  }
  const envFile = process.env.POLICYGATE_ENV_FILE || path.join(getActivePath("etc"), "service.env");
  let configured = Boolean(process.env.MCP_TOKEN);
  try {
    const content = fs.readFileSync(envFile, "utf8");
    configured = configured || /^MCP_TOKEN=.+$/m.test(content);
  } catch {}
  console.log(configured ? "MCP authentication token: configured (value hidden)" :
    "MCP token not confirmed from this user session.");
  console.log("Use 'bridge-dev login --generate' to create a new token; existing tokens are never printed.");
}

function cmdHelp() {
  console.log("Persistent Linux service: bridge-dev service install|uninstall|status|start|stop|restart|enable|disable|logs|update <sha-or-tag>|rollback");
  console.log(`BridgeDev v${VERSION} — Self-hosted MCP Development Gateway`);
  console.log("Usage: bridge-dev [command] [options]\n");
  console.log("Core Commands:");
  console.log("  setup                 Guided first-time configuration and environment check");
  console.log("  start                 Start BridgeDev (uses systemd user service if installed)");
  console.log("  stop                  Stop BridgeDev service or running gateway");
  console.log("  restart               Restart BridgeDev service or running gateway");
  console.log("  status                Show gateway status, mode, sessions, and endpoint");
  console.log("  doctor                Run comprehensive diagnostics on environment health");
  console.log("  access                Display secure connection instructions (interactive only)");
  console.log("  workspace <action>    list / add <path> / remove <path> authorized workspaces");
  console.log("  mode <profile>        standard / yolo [--duration <min>] / yolo --off / status");
  console.log("  service <action>      install / uninstall / status / update / rollback / logs");
  console.log("\nCompatibility Aliases:");
  console.log("  mode read-write       Alias for 'mode standard' (normal scoped work)");
  console.log("  mode sudo             Alias for 'mode yolo' (ask [y/N] to enable Full System)");
  console.log("  mode sudo --duration 60  Optional time-limited Full System access");
  console.log("  mode sudo --off       Revoke root access and return to Read & Write");
  console.log("  project <subcommand>  Linux only: operator-controlled project mappings");
  console.log("  operator status|yolo|exec|logs|cleanup  Optional Linux host controller");
  console.log("  serve, start-server   Run the MCP server in foreground");
  console.log("\nExtensibility & Providers:");
  console.log("  add <source>          Discover, select and preview an extension");
  console.log("  mcp <action>          list/search/info/add/remove/enable/disable/update/test/tools/logs/status/import/export/migrate");
  console.log("  mcp migrate           Operator file migration: --config <file> [--dry-run]");
  console.log("  skills <action>       list/search/info/add/remove/enable/disable/update/validate/sources");
  console.log("  instructions <action> list/add/info/remove/enable/disable/update");
  console.log("  pack <action>         add/info/list/update/remove");
  console.log("  approve <id>          Apply exact reviewed proposal using independent operator credentials");
  console.log("  deploy plan|start|status|logs|verify|rollback|cleanup  Recoverable cutover jobs");
  console.log("\nFlags:");
  console.log("  --json                Output machine-readable JSON");
  console.log("  --verbose             Show diagnostic error traces");
  console.log("  help, --help, -h      Show this help menu\n");
  console.log("Security Modes:");
  console.log("  STANDARD     : Approved workspace files, Git, ordinary shell; no blanket sudo.");
  console.log("  FULL SYSTEM  : Root commands until switched off, or optional timed; local [y/N].");
  console.log("  Invalid protected authorization stays in the internal STRICT safety lock.");
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const { args, json, verbose } = parseCliArguments(rawArgs);
  if (await serviceCli(args, json)) return;
  if (await extensionCli(args, json, verbose)) return;
  if (await controllerCli(args, json)) return;
  if (json) {
    const log = console.log, lines: string[] = [];
    console.log = (...values: unknown[]) => { lines.push(values.map(String).join(" ")); };
    process.once("beforeExit", () => {
      console.log = log;
      log(JSON.stringify({ ok: !process.exitCode, command: args[0] || "status", output: lines }));
    });
  }
  const cmd = (args[0] || "").toLowerCase();

  switch (cmd) {
    case "":
    case "status":
      await cmdStatus(json);
      break;
    case "connect":
      await cmdConnect(args.includes("--show-token"));
      break;
    case "access":
      cmdAccess();
      break;
    case "workspace":
      cmdWorkspace(args.slice(1), json);
      break;
    case "mode":
      await cmdMode(args.slice(1), json);
      break;
    case "project":
      if (args.length > 1 && ["list", "add", "remove", "rm"].includes(args[1]?.toLowerCase())) {
        cmdWorkspace(args.slice(1), json);
      } else {
        cmdProject(args.slice(1));
      }
      break;
    case "stop":
      await cmdStop();
      break;
    case "restart":
      await cmdRestart();
      break;
    case "doctor":
      await cmdDoctor(json);
      break;
    case "setup":
      await cmdSetup(json);
      break;
    case "login":
      cmdLogin(args.slice(1));
      break;
    case "start":
      if ((await userServiceStatus()).installed) {
        const expose = args.includes("--funnel") || process.env.BRIDGEDEV_FUNNEL === "true" || process.env.BRIDGEDEV_TRANSPORT === "tailscale";
        const status = await startConfiguredService(undefined, expose ? enableTailscaleFunnel : undefined);
        console.log(JSON.stringify(status));
        break;
      }
    case "serve":
    case "start-server": {
      const port = process.env.PORT || "3000";
      const wantFunnel = args.includes("--funnel") ||
        process.env.BRIDGEDEV_FUNNEL === "true" ||
        process.env.BRIDGEDEV_TRANSPORT === "tailscale";
      // Verify the local gateway is healthy before any explicitly requested exposure.
      const gateway = await import("./index.js");
      if (wantFunnel) {
        await gateway.waitForGatewayReady();
        enableTailscaleFunnel(Number(port));
      }
      break;
    }
    case "help":
    case "--help":
    case "-h":
      cmdHelp();
      break;
    default:
      throw new Error(`Unknown command: ${cmd}. Run bridge-dev help for usage.`);
  }
}

main().catch((err) => {
  const flags=parseCliArguments(process.argv.slice(2));
  const detail=String(redactAudit(flags.verbose?(err.stack||err.message):err.message));
  console.error(flags.json?JSON.stringify({ok:false,error:detail,code:"BRIDGEDEV_ERROR"}):`Fatal error: ${detail}`);
  process.exit(1);
});
