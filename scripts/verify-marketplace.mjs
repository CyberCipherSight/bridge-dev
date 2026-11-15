// Offline validation by default; --online explicitly rechecks public package metadata.
import assert from "node:assert/strict";
import { loadMarketplace } from "../dist/lib/marketplace.js";
import { downloadHttps } from "../dist/lib/safe-network.js";
const catalog = await loadMarketplace();
assert.ok(catalog.entries.length >= 100);
const online = process.argv.includes("--online");
let checked = 0;
if (online) {
  for (const entry of catalog.entries) {
    if (entry.evidence.level !== "package-metadata") continue;
    const metadata = JSON.parse(
      (await downloadHttps(entry.evidence.url, 4 * 1048576)).toString(),
    );
    const version =
      entry.installation.mechanism === "pypi"
        ? metadata.info?.version
        : metadata.version;
    if (version !== entry.version)
      throw Error(
        "CATALOG_VERSION_DRIFT: " +
          entry.id +
          "; review a new pinned snapshot explicitly",
      );
    checked++;
  }
}
console.log(
  JSON.stringify({
    entries: catalog.entries.length,
    types: catalog.entries.reduce(
      (a, e) => ((a[e.type] = (a[e.type] || 0) + 1), a),
      {},
    ),
    native_overlap: catalog.entries.filter((e) => e.native_alternative).length,
    verification: online ? "public package metadata" : "offline schema only",
    online_checked: checked,
    providers_launched: 0,
  }),
);
