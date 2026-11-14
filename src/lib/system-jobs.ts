import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runReadOnly } from "./system-inspect.js";
import {diagnosticCommand,diagnosticEnvironment} from "./diagnostic-command.js";
import { getSecurityPolicy } from "./security-policy.js";

const getRoot = () => path.resolve(process.env.LOCAL_CODER_JOB_ROOT || path.join(os.homedir(), ".local/state/chatgpt-local-coder/jobs"));
const unitPrefix = "chatgpt-job-";
const idPattern = /^[a-f0-9]{16}$/;
type JobStatus = "running" | "completed" | "failed" | "stopped" | "timed_out" | "unknown";
interface Metadata {
  id: string;
  unit: string;
  command: string;
  working_directory: string;
  created_at: string;
  log_path: string;
  exit_file: string;
  max_runtime_seconds: number;
}
function validateId(id: string) {
  if (!idPattern.test(id)) throw new Error("Invalid Local Coder job ID");
}
async function metadata(id: string): Promise<Metadata> {
  validateId(id);
  const file = path.join(getRoot(), id + ".json");
  const raw = JSON.parse(await fs.readFile(file, "utf8")) as Metadata;
  if (raw.id !== id || raw.unit !== unitPrefix + id || raw.log_path !== path.join(getRoot(), id + ".log") || raw.exit_file !== path.join(getRoot(),id+".exit")) {
    throw new Error("Job metadata validation failed");
  }
  return raw;
}
async function tailFile(file: string, maxBytes: number): Promise<string> {
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const bytes = Buffer.alloc(length);
    await handle.read(bytes, 0, length, stat.size - length);
    return bytes.toString("utf8");
  } finally { await handle.close(); }
}
export async function startJob(command: string, workingDirectory: string, maxRuntimeSeconds = 7200, authToken?: string) {
  const plan=diagnosticCommand(command),direct=plan?.runtimeVersion?undefined:plan;
  const auth = direct?{allowed:true,error:undefined}:getSecurityPolicy().authorizeCommand(command, authToken);
  if (!auth.allowed) throw new Error(auth.error || "JOB_SECURITY_BLOCKED");
  if (command.trim().length === 0 || command.length > 12000) throw new Error("Invalid job command");
  const dir = path.resolve(workingDirectory);
  if (!(await fs.stat(dir)).isDirectory()) throw new Error("Working directory is not a directory");
  const id = randomUUID().replaceAll("-", "").slice(0, 16);
  const root = getRoot();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const info: Metadata = {
    id, unit: unitPrefix + id, command, working_directory: dir,
    created_at: new Date().toISOString(),
    log_path: path.join(root, id + ".log"),
    exit_file: path.join(root, id + ".exit"),
    max_runtime_seconds: maxRuntimeSeconds,
  };
  const scriptPath = path.join(root, id + ".sh");
  const script = [
    "#!/usr/bin/env bash", "set +e", 'exit_file="$1"', 'shift',
    `trap 'code=$?; printf "%s\\n" "$code" > "$exit_file.tmp"; mv -f -- "$exit_file.tmp" "$exit_file"' EXIT`,
    "trap 'exit 143' TERM", '"$@"', 'exit "$?"',
  ].join("\n") + "\n";
  await fs.writeFile(scriptPath, script, { mode: 0o700, flag: "wx" });
  await fs.writeFile(info.log_path, "", { mode: 0o600, flag: "wx" });
  const payload=direct?[direct.executable,...direct.args]:["/usr/bin/bash","--noprofile","--norc","-c",command];
  const payloadEnv=direct?diagnosticEnvironment():{PATH:process.env.PATH||"/usr/bin:/bin",HOME:os.homedir(),LANG:"C.UTF-8"};
  // Persist identity before submission: a timeout must remain inspectable.
  await fs.writeFile(path.join(root, id + ".json"), JSON.stringify(info, null, 2), { mode: 0o600, flag: "wx" });
  const result = await runReadOnly("systemd-run", [
    "--user", "--unit=" + info.unit, "--working-directory=" + dir,
    "--property=Type=exec", "--property=Restart=no",
    "--property=NoNewPrivileges=yes", "--property=RestrictSUIDSGID=yes", "--property=KillMode=control-group",
    "--property=UnsetEnvironment=LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT GCONV_PATH NODE_OPTIONS BASH_ENV ENV",
    "--property=RuntimeMaxSec=" + Math.min(Math.max(maxRuntimeSeconds, 1), 86400) + "s",
    "--property=StandardOutput=append:" + info.log_path,
    "--property=StandardError=append:" + info.log_path,
    "/usr/bin/env", "-i", ...Object.entries(payloadEnv).map(([key,value])=>key+"="+value), "/usr/bin/bash", scriptPath, info.exit_file, ...payload,
  ], 9000, 2500);
  if (!result.ok) {
    throw new Error("Job launch unconfirmed for " + id + "; inspect system_job status/logs before retry. No automatic retry was made.");
  }
  return { ...info, status: "launched", systemd_response: result.stdout.trim(), note: "Transient user job; no permanent service or linger enabled. Logs and exit record persist under user state." };
}
export async function statusJob(id: string) {
  const info = await metadata(id);
  const unit = await runReadOnly("systemctl", ["--user", "show", info.unit, "--property=ActiveState,Result,ExecMainStatus,ExecMainCode,MainPID,SubState", "--no-pager"], 4500, 2700);
  const entries = Object.fromEntries(unit.stdout.split("\n").filter((x) => x.includes("=")).map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]));
  let code: number | null = null;
  try {
    const v = (await fs.readFile(info.exit_file, "utf8")).trim();
    if (/^\d+$/.test(v)) code = Number(v);
  } catch {}
  const active = entries.ActiveState || "unknown";
  const running=["active","activating","deactivating"].includes(active);
  const resultFile=path.join(getRoot(),id+".result.json");
  {
    try{const saved=JSON.parse(await fs.readFile(resultFile,"utf8"));if(saved.id===id&&saved.unit===info.unit&&["completed","failed","stopped","timed_out"].includes(saved.status)&&Number.isInteger(saved.exit_code))return saved;}catch{}
  }
  const cancelled=await fs.stat(path.join(getRoot(),id+".stopped")).then(()=>true,()=>false);
  if(code===null&&!running&&unit.ok&&entries.Result&&["1","2","3"].includes(entries.ExecMainCode)){
    const raw=Number(entries.ExecMainStatus);if(Number.isInteger(raw)){code=entries.Result==="timeout"?124:(entries.ExecMainCode==="2"||entries.ExecMainCode==="3")?128+raw:raw;await fs.writeFile(info.exit_file,String(code)+"\n",{mode:0o600});}
  }
  const state: JobStatus = running?"running":cancelled?"stopped":entries.Result==="timeout"?"timed_out":code !== null ? (code === 0 ? "completed" : "failed")
    : active === "active" || active === "activating" ? "running"
    : entries.Result === "timeout" || entries.Result === "signal" ? "failed"
    : "unknown";
  const result={ id, unit: info.unit, status: state, exit_code: code, active_state: active, result: entries.Result || null, pid: Number(entries.MainPID) || null, created_at: info.created_at, command: info.command, log_path: info.log_path, exit_file: info.exit_file, note: state === "unknown" ? "Job has no recorded exit code; inspect logs and systemd state. Do not assume success." : undefined };
  if(!running&&state!=="unknown"&&code!==null){const tmp=resultFile+"."+randomUUID();try{await fs.writeFile(tmp,JSON.stringify(result),{mode:0o600,flag:"wx"});await fs.rename(tmp,resultFile);}finally{await fs.unlink(tmp).catch(()=>{});}}
  return result;
}
export async function logsJob(id: string, maxBytes = 10000) {
  const info = await metadata(id);
  let log = "";
  try { log = await tailFile(info.log_path, Math.max(200, Math.min(maxBytes, 100000))); }
  catch (error) { log = "[log unavailable] " + (error instanceof Error ? error.message : String(error)); }
  return { id, log_path: info.log_path, tail: log };
}
export async function stopJob(id: string, confirmed: boolean) {
  if (!confirmed) throw new Error("Job cancellation requires confirm=true");
  const info = await metadata(id);
  const out = await runReadOnly("systemctl", ["--user", "stop", info.unit], 6500, 1800);
  if (!out.ok) throw new Error("Unable to stop job: " + out.stderr);
  await fs.writeFile(path.join(getRoot(),id+".stopped"),"stopped\n",{mode:0o600});
  return { id, unit: info.unit, stop_requested: true, note: "Only this tracked unit was targeted. Verify final state with status." };
}
export async function listJobs(limit = 20) {
  let ids: string[] = [];
  try { ids = (await fs.readdir(getRoot())).filter((name) => /^[a-f0-9]{16}\.json$/.test(name)).map((name) => name.slice(0, 16)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const rows = await Promise.all(ids.slice(-Math.min(Math.max(limit, 1), 50)).map(async (id) => {
    try { return await statusJob(id); } catch { return { id, status: "unknown" }; }
  }));
  return { jobs: rows, count: rows.length, root: getRoot() };
}
