import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "dotenv";
import { z } from "zod";
import { atomicJson } from "./atomic-store.js";
const exec = promisify(execFile);
export const SERVICE_NAME = "bridge-dev.service";
export const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const shaPattern = /^[a-f0-9]{40}$/;
export function serviceRoot(): string {
  return path.resolve(
    process.env.BRIDGEDEV_SERVICE_ROOT ||
      process.env.BRIDGEDEV_INSTALL_ROOT ||
      path.join(
        process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"),
        "bridge-dev",
      ),
  );
}
const absolute = z
  .string()
  .refine(
    (p) => path.isAbsolute(p) && !/[\x00-\x1f\x7f]/.test(p),
    "Safe absolute path required",
  );
const schema = z
  .object({
    version: z.literal(1),
    root: absolute,
    unit: z.string().regex(/^bridge-dev(?:-[a-zA-Z0-9_-]+)?\.service$/),
    unit_file: absolute,
    env_file: absolute,
    node: absolute,
    working_directory: absolute,
    workspace: z.array(absolute).min(1).max(16),
    writable: z.array(absolute).min(1).max(32),
    port: z.number().int().min(1).max(65535),
    admin_port: z.number().int().min(1).max(65535),
    audit_file: absolute,
    sandbox: z.enum(["full", "basic"]),
    sandbox_omissions: z.array(z.string()).max(16),
    memory_max_mb: z.number().int().min(256).max(8192),
    tasks_max: z.number().int().min(32).max(1024),
    current: z.string().regex(shaPattern),
    previous: z.string().regex(shaPattern).nullable(),
    last_operation: z.enum(["install", "update", "rollback", "auto_rollback"]),
    updated_at: z.string(),
  })
  .strict();
export type ServiceConfig = z.infer<typeof schema>;
export function configFile(root = serviceRoot()): string {
  return path.join(root, "service/config.json");
}
export async function readServiceConfig(
  root = serviceRoot(),
): Promise<ServiceConfig | null> {
  try {
    const st = await fsp.lstat(configFile(root));
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.uid !== process.getuid?.() ||
      st.mode & 0o077
    )
      throw Error("SERVICE_CONFIG_OWNER_OR_MODE");
    const raw = schema.parse(
      JSON.parse(await fsp.readFile(configFile(root), "utf8")),
    );
    if (raw.root !== path.resolve(root) || raw.port === raw.admin_port)
      throw Error("SERVICE_CONFIG_PATH_OR_PORT_MISMATCH");
    return raw;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw Error(
      "SERVICE_CONFIG_INVALID_OR_FUTURE_SCHEMA: validate the protected service configuration with schema version 1",
    );
  }
}
export async function writeServiceConfig(c: ServiceConfig): Promise<void> {
  schema.parse(c);
  await atomicJson(configFile(c.root), c);
}
export function privateEnvironment(filename: string): Record<string, string> {
  const s = fs.lstatSync(filename);
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    s.uid !== process.getuid?.() ||
    s.mode & 0o077
  )
    throw Error("SERVICE_ENVIRONMENT_MUST_BE_USER_OWNED_0600");
  const env = parse(fs.readFileSync(filename));
  if (
    env.POLICYGATE_POLICY_FILE?.trim() ||
    (env.BRIDGEDEV_RUNTIME_MODE && env.BRIDGEDEV_RUNTIME_MODE !== "portable")
  )
    throw Error(
      "SERVICE_PORTABLE_ONLY: managed Linux provisioning is independent",
    );
  for (const name of ["MCP_TOKEN", "ADMIN_TOKEN"])
    if (
      !/^[A-Za-z0-9._-]{32,1024}$/.test(env[name] || "") ||
      /^(REPLACE_|CHANGE_ME|EXAMPLE_)/.test(env[name])
    )
      throw Error("SERVICE_INDEPENDENT_CREDENTIALS_REQUIRED");
  if (env.MCP_TOKEN === env.ADMIN_TOKEN)
    throw Error("SERVICE_INDEPENDENT_CREDENTIALS_REQUIRED");
  if (env.HOST && !["127.0.0.1", "localhost", "::1"].includes(env.HOST))
    throw Error("SERVICE_LOOPBACK_REQUIRED");
  return env;
}
export function systemdQuote(value: string, execution = true): string {
  if (/[\x00-\x1f\x7f]/.test(value))
    throw Error("SERVICE_UNIT_CONTROL_CHARACTER");
  return (
    '"' +
    value
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("%", "%%")
      .replaceAll("$", execution ? "$$" : "$") +
    '"'
  );
}
export function renderUnit(c: ServiceConfig): string {
  schema.parse(c);
  const q = (value: string) => systemdQuote(value, false);
  const hardening = [
    "NoNewPrivileges=yes",
    "UMask=0077",
    "RestrictSUIDSGID=yes",
    "LockPersonality=yes",
    "SystemCallArchitectures=native",
    "RestrictNamespaces=yes",
  ];
  if (c.sandbox === "full")
    hardening.push(
      "PrivateUsers=yes",
      "ProtectKernelTunables=yes",
      "ProtectKernelModules=yes",
      "ProtectControlGroups=yes",
      "PrivateTmp=yes",
      "ProtectSystem=strict",
      "ProtectHome=read-only",
      "ReadOnlyPaths=" + q(path.join(c.root, "releases")),
      "ReadWritePaths=" + c.writable.map(q).join(" "),
    );
  return [
    "# BridgeDev generated user service; schema 1. No credentials inline.",
    "[Unit]",
    "Description=BridgeDev MCP gateway",
    "After=network-online.target",
    "Wants=network-online.target",
    "StartLimitIntervalSec=60s",
    "StartLimitBurst=4",
    "",
    "[Service]",
    "Type=exec",
    `ExecStart=${systemdQuote(c.node)} ${systemdQuote(path.join(c.root, "current/dist/index.js"))}`,
    `WorkingDirectory=${c.working_directory.replaceAll("%", "%%")}`,
    `EnvironmentFile=${c.env_file.replaceAll("%", "%%")}`,
    "Environment=BRIDGEDEV_RUNTIME_MODE=portable",
    `Environment=DOTENV_CONFIG_PATH=${q(c.env_file)}`,
    "UnsetEnvironment=NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH",
    `Environment=BRIDGEDEV_SERVICE_ROOT=${q(c.root)}`,
    "Restart=on-failure",
    "RestartSec=3s",
    "TimeoutStopSec=30s",
    "KillSignal=SIGTERM",
    "KillMode=control-group",
    "SendSIGKILL=yes",
    "StandardOutput=journal",
    "StandardError=journal",
    "SyslogIdentifier=bridge-dev",
    "LogRateLimitIntervalSec=30s",
    "LogRateLimitBurst=200",
    `MemoryHigh=${Math.floor(c.memory_max_mb * 0.75)}M`,
    `MemoryMax=${c.memory_max_mb}M`,
    `TasksMax=${c.tasks_max}`,
    "OOMPolicy=stop",
    ...hardening,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}
export function operatorEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    [
      "PATH",
      "HOME",
      "LANG",
      "XDG_RUNTIME_DIR",
      "XDG_CONFIG_HOME",
      "DBUS_SESSION_BUS_ADDRESS",
    ]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
}
export async function systemctl(
  args: string[],
  required = true,
): Promise<string> {
  try {
    return (
      await exec("systemctl", ["--user", ...args], {
        env: operatorEnvironment(),
        encoding: "utf8",
        timeout: 35000,
        maxBuffer: 262144,
      })
    ).stdout;
  } catch (error) {
    if (!required) return (error as { stdout?: string }).stdout || "";
    throw Error(
      "SERVICE_SYSTEMD_FAILED: " +
        args[0] +
        "; inspect systemctl --user status and journal",
    );
  }
}
export async function serviceStatus(
  root = serviceRoot(),
): Promise<Record<string, any>> {
  if (process.platform !== "linux")
    return {
      supported: false,
      installed: false,
      reason: "Linux systemd user service only",
    };
  const c = await readServiceConfig(root);
  if (!c) return { supported: true, installed: false };
  const raw = await systemctl(
    [
      "show",
      c.unit,
      "-p",
      "LoadState,ActiveState,SubState,MainPID,NRestarts,Result,UnitFileState,NoNewPrivileges,PrivateTmp,ProtectHome,ProtectSystem,MemoryMax,TasksMax",
    ],
    false,
  );
  const properties = Object.fromEntries(
    raw
      .split("\n")
      .filter((x) => x.includes("="))
      .map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]),
  );
  let linger = "unknown";
  try {
    linger = (
      await exec(
        "loginctl",
        ["show-user", String(process.getuid?.()), "-p", "Linger", "--value"],
        { env: operatorEnvironment(), timeout: 5000, encoding: "utf8" },
      )
    ).stdout.trim();
  } catch {}
  const current = await fsp
      .readlink(path.join(root, "current"))
      .catch(() => null),
    expected = path.join("releases", c.current);
  return {
    supported: true,
    installed: fs.existsSync(c.unit_file),
    unit: c.unit,
    unit_file: c.unit_file,
    enabled: properties.UnitFileState === "enabled",
    active: properties.ActiveState === "active",
    state: properties.ActiveState || "unknown",
    substate: properties.SubState || "unknown",
    pid: Number(properties.MainPID) || null,
    restarts: Number(properties.NRestarts) || 0,
    result: properties.Result || null,
    linger: linger === "yes",
    linger_status: linger,
    current: c.current,
    previous: c.previous,
    rollback_available: Boolean(
      c.previous && fs.existsSync(path.join(root, "releases", c.previous)),
    ),
    pointer_consistent: current === expected,
    environment_source: c.env_file,
    port: c.port,
    admin_port: c.admin_port,
    hardening: properties,
    sandbox: c.sandbox,
    sandbox_omissions: c.sandbox_omissions,
  };
}
export function runtimeVersion(): { version: string; commit: string | null } {
  let version = "unknown",
    commit: string | null = null;
  try {
    version = JSON.parse(
      fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"),
    ).version;
  } catch {}
  try {
    const value = fs
      .readFileSync(path.join(sourceRoot, "DEPLOYED_COMMIT"), "utf8")
      .trim();
    if (shaPattern.test(value)) commit = value;
  } catch {}
  return { version, commit };
}
export async function makeServiceConfig(options: {
  root?: string;
  envFile?: string;
  unit?: string;
  sandbox?: "full" | "basic";
  sourceCommit: string;
  memory?: number;
  tasks?: number;
}): Promise<ServiceConfig> {
  const root = path.resolve(options.root || serviceRoot()),
    envFile = path.resolve(
      options.envFile ||
        process.env.DOTENV_CONFIG_PATH ||
        path.join(
          process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
          "bridge-dev/.env",
        ),
    ),
    env = privateEnvironment(envFile);
  const workspace = [
    ...new Set(
      [
        "WORKSPACE_PATH",
        "EXTRA_WORKSPACE_PATHS",
        "WORKSPACE_PATHS",
        "ALLOWED_WORKSPACE_PATHS",
      ]
        .flatMap((k) => (env[k] || "").split(";"))
        .filter(Boolean)
        .map((p) => fs.realpathSync.native(p)),
    ),
  ];
  if (!workspace.length) throw Error("SERVICE_WORKSPACE_REQUIRED");
  const state = path.resolve(
    env.BRIDGEDEV_STATE_DIR || path.join(os.homedir(), ".bridge-dev/state"),
  );
  const writable = [
    ...new Set(
      [
        ...workspace,
        state,
        env.MCP_SHELL_STATE_DIR || path.join(os.homedir(), ".mcp-state"),
        env.LOCAL_CODER_JOB_ROOT ||
          path.join(os.homedir(), ".local/state/chatgpt-local-coder/jobs"),
        ...(env.CHECKPOINT_ENABLED === "true"
          ? [env.CHECKPOINT_PATH || path.join(os.homedir(), ".mcp-checkpoints")]
          : []),
      ].map((p) => path.resolve(p)),
    ),
  ];
  for (const p of writable) {
    if (p === os.homedir() || p === path.parse(p).root || p === root)
      throw Error("SERVICE_WRITABLE_ROOT_TOO_BROAD");
    await fsp.mkdir(p, { recursive: true, mode: 0o700 });
  }
  const unit = options.unit || SERVICE_NAME,
    sandbox = options.sandbox || "basic";
  return schema.parse({
    version: 1,
    root,
    unit,
    unit_file: path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      "systemd/user",
      unit,
    ),
    env_file: envFile,
    node: process.execPath,
    working_directory: os.homedir(),
    workspace,
    writable,
    port: Number(env.PORT || 3000),
    admin_port: Number(env.ADMIN_PORT || 3001),
    audit_file: path.join(state, "audit.jsonl"),
    sandbox,
    sandbox_omissions:
      sandbox === "basic"
        ? [
            "PrivateUsers, PrivateTmp, ProtectHome, ProtectSystem, ProtectKernelTunables, ProtectKernelModules and ProtectControlGroups omitted: rootless user namespaces hide host root ownership and break trusted-executable verification",
          ]
        : [],
    memory_max_mb: options.memory || 1024,
    tasks_max: options.tasks || 256,
    current: options.sourceCommit,
    previous: null,
    last_operation: "install",
    updated_at: new Date().toISOString(),
  });
}
