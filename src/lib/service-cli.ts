import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  serviceRoot,
  serviceStatus,
  readServiceConfig,
  sourceRoot,
  operatorEnvironment,
} from "./service-config.js";
import {
  installService,
  controlService,
  updateService,
  requestRollback,
  queueServiceOperation,
  jobResult,
} from "./service-manager.js";
import { stageVerifiedGithubRelease } from "./service-release.js";
import {cliErrorMessage,cliResultLine, writeCliEvent} from "./cli-report.js";
export async function serviceCli(
  args: string[],
  json = false,
  verbose = false,
  quiet = false,
): Promise<boolean> {
  if (args[0] !== "service") return false;
  if (args.includes("--crash-test"))
    process.env.BRIDGEDEV_DEPLOY_CRASH_TEST = "true";
  const browserIndex = args.indexOf("--browser");
  if (browserIndex >= 0)
    process.env.BRIDGEDEV_DEPLOY_BROWSER = args[browserIndex + 1];
  const action = args[1] || "status",
    value = args[2],
    option = (name: string) => {
      const i = args.indexOf(name);
      return i < 0 ? undefined : args[i + 1];
    };
  const root = path.resolve(option("--root") || serviceRoot());
  let result: any;
  if (action === "status")
    result = {
      ...(await serviceStatus(root)),
      ...(option("--job")
        ? { job: await jobResult(root, option("--job")!) }
        : {}),
    };
  else if (action === "install")
    result = await installService({
      root,
      envFile: option("--config"),
      unit: option("--unit"),
      sandbox: (option("--sandbox") || "basic") as "full" | "basic",
      source: option("--source"),
      enable: !args.includes("--no-enable"),
      start: args.includes("--start"),
      memory: option("--memory-mb") ? Number(option("--memory-mb")) : undefined,
      tasks: option("--tasks") ? Number(option("--tasks")) : undefined,
    });
  else if (
    ["uninstall", "start", "stop", "restart", "enable", "disable"].includes(
      action,
    )
  )
    result = await controlService(action as any, root);
  else if (action === "stage") {
    if (!value || value.startsWith("--"))
      throw Error("Usage: bridge-dev service stage <sha-or-tag>");
    result = await stageVerifiedGithubRelease(value, root);
  } else if (action === "update") {
    if (!value || value.startsWith("--"))
      throw Error("Usage: bridge-dev service update <sha-or-tag>");
    result = await updateService(value, root);
  } else if (action === "rollback") result = await requestRollback(root);
  else if (action === "adopt") {
    const c = await readServiceConfig(root);
    if (
      !c ||
      !value ||
      !/^[a-f0-9]{40}$/.test(value) ||
      !/^bridge-dev-portable-[a-f0-9]+\.service$/.test(
        option("--transient") || "",
      )
    )
      throw Error(
        "Usage: bridge-dev service adopt <verified-sha> --transient bridge-dev-portable-SHA.service --previous-app <path>",
      );
    const app = path.resolve(
      option("--previous-app") || path.join(root, "app"),
    );
    result = await queueServiceOperation("adopt", value, root, {
      unit: option("--transient")!,
      app,
      node: process.execPath,
      cwd: process.env.HOME || process.cwd(),
    });
  } else if (action === "logs") {
    const c = await readServiceConfig(root);
    if (!c) throw Error("SERVICE_NOT_INSTALLED");
    const name = option("--job")
      ? "bridge-dev-update-" + option("--job") + ".service"
      : c.unit;
    if (
      !/^bridge-dev(?:-update-[a-f0-9-]{36})?\.service$/.test(name) &&
      name !== c.unit
    )
      throw Error("SERVICE_JOB_ID_INVALID");
    if (option("--lines") && !/^[1-9][0-9]{0,3}$/.test(option("--lines")!))
      throw Error("SERVICE_LOG_LINES_INVALID");
    const p = spawn(
      "journalctl",
      ["--user", "-u", name, "--no-pager", "-n", option("--lines") || "80"],
      { env: operatorEnvironment(), stdio: "inherit" },
    );
    await new Promise<void>((resolve, reject) => {
      p.on("error", reject);
      p.on("close", (code) =>
        code === 0 ? resolve() : reject(Error("SERVICE_LOGS_FAILED")),
      );
    });
    return true;
  } else throw Error("Unknown service command: " + action);
  if (result?.job_id && !args.includes("--no-wait")) {
    const id = result.job_id,
      end = Date.now() + 190000;
    while (Date.now() < end) {
      const state = await jobResult(root, id);
      if (["SUCCESS", "ROLLED_BACK", "FAILED"].includes(state.status)) {
        result = { ...result, ...state };
        if (state.status !== "SUCCESS") process.exitCode = 1;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!["SUCCESS", "ROLLED_BACK", "FAILED"].includes(result.status)) {
      result = {
        ...result,
        note:
          "Job still recorded; inspect service status --job " +
          id +
          " before retry",
      };
      process.exitCode = 1;
    }
  }
  const status = typeof result?.status === "string" ? result.status :
    process.exitCode ? "FAILED" : "SUCCESS";
  writeCliEvent({command:"service "+action,status,level:process.exitCode ? "error":"info",
    ...(typeof result?.job_id === "string" ? {job_id:result.job_id}:{}),
    ...(typeof result?.commit === "string" ? {release:result.commit}:{}),
    ...(typeof result?.current === "string" ? {release:result.current}:{}),
    ...(typeof result?.error === "string" ? {detail:result.error}:{}),
  });
  if (quiet) return true;
  if (json) console.log(JSON.stringify({ok:!process.exitCode,data:result}));
  else if (verbose) console.log(JSON.stringify(result,null,2));
  else {
    console.log(cliResultLine("service",action,result||{}));
    const warnings=Array.isArray(result?.warnings)?result.warnings:
      typeof result?.warning==="string"?[result.warning]:[];
    for(const warning of warnings.slice(0,3))console.warn("Warning: "+cliErrorMessage(warning));
    if(process.exitCode&&result?.note)console.warn("Warning: "+cliErrorMessage(result.note));
  }
  return true;
}
