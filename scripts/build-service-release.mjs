// CI only: invoke after frozen install, build and production dependency pruning.
import fs from "node:fs/promises";
import { createReleaseBundle } from "../dist/lib/service-release.js";
const sha = process.env.GITHUB_SHA || process.argv[2];
if (!/^[a-f0-9]{40}$/.test(sha || ""))
  throw Error("Provide the exact source commit");
await fs.mkdir("release-artifact", { recursive: true });
await fs.writeFile(
  "release-artifact/bridge-dev.release.json.gz",
  await createReleaseBundle(process.cwd(), sha),
);
console.log("Created versioned service artifact for " + sha);
