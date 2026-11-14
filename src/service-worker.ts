#!/usr/bin/env node
import { runServiceJob, rollbackServiceJob } from "./lib/service-manager.js";
const [action, root, id] = process.argv.slice(2);
try {
  if (action === "run") await runServiceJob(root, id);
  else if (action === "guard") await rollbackServiceJob(root, id);
  else throw Error("Unknown service worker action");
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Service transaction failed",
  );
  process.exitCode = 1;
}
