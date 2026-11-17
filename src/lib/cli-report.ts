import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { redactAudit } from "./hash-audit.js";

export type CliLevel = "info" | "warning" | "error";
export interface CliEvent {
  command: string;
  status: string;
  level?: CliLevel;
  release?: string;
  job_id?: string;
  code?: string;
  detail?: string;
}

/** On-demand, private diagnostics; no raw provider payloads, auth tokens,
 * pairing URLs, operator output, or full command arguments are persisted. */
export function cliLogFile(): string {
  const home = os.homedir();
  const root = process.env.XDG_STATE_HOME && path.isAbsolute(process.env.XDG_STATE_HOME)
    ? process.env.XDG_STATE_HOME : path.join(home, ".local", "state");
  // Use a dedicated 0700 leaf; older installations may already have a
  // world-readable ~/.local/state/bridge-dev parent for non-secret metadata.
  return path.join(root, "bridge-dev", "private-cli", "events.jsonl");
}

const limited = (value: string): string => {
  let clean = String(redactAudit(value)).replace(/[\r\n\t\x00-\x1f\x7f]/g, " ");
  for (const key of ["MCP_TOKEN", "ADMIN_TOKEN", "BRIDGEDEV_ADMIN_TOKEN"]) {
    const token = process.env[key];
    if (token && token.length >= 8) clean = clean.split(token).join("[redacted]");
  }
  return clean.replace(/https?:\/\/\S+/g, "[URL hidden]").slice(0, 240);
};

export function writeCliEvent(event: CliEvent): boolean {
  try {
    const file = cliLogFile();
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Never follow a hostile file or directory symlink in a privileged CLI.
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink() ||
        (process.platform !== "win32" && ((st.mode & 0o077) || st.uid !== process.getuid?.()))) return false;
    try {
      const old = fs.lstatSync(file);
      if (!old.isFile() || old.isSymbolicLink() ||
          (process.platform !== "win32" && ((old.mode & 0o077) || old.uid !== process.getuid?.()))) return false;
      // Rotation occurs only during a CLI call; no persistent watcher.
      if (old.size > 2 * 1024 * 1024) fs.renameSync(file, file + ".1");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) return false;
    }
    const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT |
      (fs.constants.O_NOFOLLOW || 0);
    const fd = fs.openSync(file, flags, 0o600);
    try {
      const f = fs.fstatSync(fd);
      if (!f.isFile() || (process.platform !== "win32" && ((f.mode & 0o077) || f.uid !== process.getuid?.()))) return false;
      const record = {
        time: new Date().toISOString(),
        command: limited(event.command),
        status: limited(event.status),
        level: event.level || "info",
        ...(event.release ? { release: limited(event.release) } : {}),
        ...(event.job_id ? { job_id: limited(event.job_id) } : {}),
        ...(event.code ? { code: limited(event.code) } : {}),
        ...(event.detail ? { detail: limited(event.detail) } : {}),
      };
      fs.writeSync(fd, JSON.stringify(record) + "\n");
      return true;
    } finally { fs.closeSync(fd); }
  } catch { return false; } // Logging must never change the command outcome.
}

export function cliErrorMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return limited(value).replace(/^Fatal error:\s*/i, "");
}

export function cliResultLine(group: string, action: string, result: Record<string, unknown>): string {
  const label = group === "service" ? "Service" : group;
  const operation = action.replace(/_/g, " ");
  const id = typeof result.job_id === "string" ? result.job_id : undefined;
  const commit = typeof result.current === "string" ? result.current.slice(0, 7) :
    typeof result.commit === "string" ? result.commit.slice(0, 7) : undefined;
  const state = typeof result.status === "string" ? result.status :
    typeof result.state === "string" ? result.state : undefined;
  const issue = typeof result.error === "string" ? " · " + cliErrorMessage(result.error) : "";
  const short = group === "service" && action === "status"
    ? `Service: ${result.active ? "running" : "stopped"}${commit ? ` · ${commit}` : ""}${result.rollback_available ? " · rollback available" : ""}`
    : `${label} ${operation}: ${state ? state.toLowerCase() : "done"}${commit ? ` · ${commit}` : ""}`;
  return `${short}${id ? ` · job ${id}` : ""}${issue}`;
}