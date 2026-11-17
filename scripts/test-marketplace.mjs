import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { loadMarketplace, marketplace } from "../dist/lib/marketplace.js";
import {
  resolveIntegration,
  saveIntegrationPreference,
  readIntegrationPreferences,
  providerPreferenceAllows,
} from "../dist/lib/integration-preferences.js";
import {
  inspectProviderTools,
  resolveLocalSchema,
  validateToolArguments,
  sanitizeProviderResult,
} from "../dist/lib/provider-security.js";
const start = performance.now(),
  catalog = await loadMarketplace();
assert.ok(catalog.entries.length >= 100);
assert.equal(
  new Set(catalog.entries.map((e) => e.id)).size,
  catalog.entries.length,
);
for (const entry of catalog.entries) {
  assert.ok(entry.version && entry.license && entry.maintainer);
  assert.match(entry.evidence.sha256, /^[a-f0-9]{64}$/);
  if (entry.type === "mcp") {
    assert.equal(entry.tools.verified, false);
    assert.equal(entry.tools.count, null);
    assert.ok(entry.requirements.length);
  }
}
assert.ok(catalog.entries.some((e) => e.type === "skill"));
assert.ok(catalog.entries.some((e) => e.type === "tool"));
const base = {
  service: "github",
  preference: "auto",
  availability: "unknown",
  native_kind: "official",
  capabilities: ["repositories.read"],
};
assert.equal(
  resolveIntegration(base, "repositories.read").provider,
  "bridgedev",
);
assert.equal(
  resolveIntegration(
    { ...base, availability: "connected" },
    "repositories.read",
  ).provider,
  "chatgpt",
);
assert.equal(
  resolveIntegration(
    { ...base, availability: "connected" },
    "repositories.write",
  ).provider,
  "bridgedev",
);
assert.equal(
  resolveIntegration(
    { ...base, availability: "connected", native_kind: "third-party" },
    "repositories.read",
  ).provider,
  "chatgpt",
);
for (const preference of ["prefer-bridgedev", "bridgedev-only"])
  assert.equal(
    resolveIntegration(
      { ...base, preference, availability: "connected" },
      "repositories.read",
    ).provider,
    "bridgedev",
  );
assert.equal(
  resolveIntegration(
    { ...base, preference: "chatgpt-only" },
    "repositories.read",
  ).provider,
  "none",
);
assert.equal(
  resolveIntegration({ ...base, preference: "disabled" }, "repositories.read")
    .provider,
  "none",
);
assert.equal(
  resolveIntegration({ ...base, availability: "connected" }).provider,
  "bridgedev",
  "Connection alone is not evidence of task coverage",
);
const manager = {
  listStatusesCached() {
    return [];
  },
};
const all = await marketplace(manager, {});
assert.equal(all.entries.length, 20);
assert.equal(all.total, catalog.entries.length);
assert.equal(
  (await marketplace(manager, { query: "Reverse Engineer Anything" }))
    .entries[0].state.registered,
  false,
);
const misleading = {
  listStatusesCached() {
    return [
      {
        id: "rea",
        enabled: true,
        connected: true,
        tool_count: 255,
        proxied_tools: ["rea__example"],
      },
    ];
  },
};
assert.equal(
  (await marketplace(misleading, { query: "Reverse Engineer Anything" }))
    .entries[0].state.registered,
  false,
  "A catalog ID matching a provider name is not proof of provenance",
);
await saveIntegrationPreference({
  service: "rea",
  preference: "bridgedev-only",
  availability: "unknown",
  provider_id: "rea",
});
assert.equal(
  (await marketplace(misleading, { query: "Reverse Engineer Anything" }))
    .entries[0].state.registered,
  true,
  "Explicit operator binding is authoritative",
);
const selection = await marketplace(manager, { type: "skill", limit: 50 });
assert.ok(selection.entries.every((e) => e.type === "skill"));
assert.equal((await marketplace(manager, { offset: 10000 })).entries.length, 0);
await saveIntegrationPreference({
  ...base,
  availability: "connected",
  provider_id: "fixture",
});
assert.equal(
  providerPreferenceAllows(await readIntegrationPreferences(), "fixture"),
  true,
  "Auto must preserve an existing provider",
);
await saveIntegrationPreference({
  ...base,
  preference: "chatgpt-only",
  provider_id: "fixture",
});
assert.equal(
  providerPreferenceAllows(await readIntegrationPreferences(), "fixture"),
  false,
);
assert.equal(
  providerPreferenceAllows(await readIntegrationPreferences(), "other"),
  true,
);
await assert.rejects(
  saveIntegrationPreference({
    ...base,
    service: "other",
    provider_id: "fixture",
  }),
  /ALREADY_BOUND/,
);
const field = { type: "string", minLength: 1 };
const normalized = resolveLocalSchema({
  type: "object",
  properties: { value: { $ref: "#/$defs/v" } },
  required: ["value"],
  $defs: { v: field },
  additionalProperties: false,
});
assert.deepEqual(normalized.properties.value, field);
const tool = { name: "local_refs", inputSchema: normalized };
validateToolArguments(tool, { value: "safe" });
assert.throws(
  () => validateToolArguments(tool, { value: "" }),
  /INVALID_ARGUMENTS/,
);
for (const schema of [
  { $ref: "https://hostile.invalid/schema" },
  { $ref: "#/$defs/a", $defs: { a: { $ref: "#/$defs/a" } } },
  { $ref: "#/$defs/missing" },
])
  assert.throws(() => resolveLocalSchema(schema), /PROVIDER_SCHEMA/);
const partition = inspectProviderTools([
  tool,
  {
    name: "hostile",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string", pattern: "(a+)+$" } },
    },
  },
]);
assert.equal(partition.tools.length, 1);
assert.equal(
  partition.rejected[0].reason,
  "PROVIDER_SCHEMA_PATTERN_UNSAFE",
);
assert.equal(partition.rejected[0].path,"#/properties/value/pattern");
// Distinguish a field literally named "pattern" from the JSON Schema
// regex keyword; validate both tool input and structured output at runtime.
const acceptedPatterns=inspectProviderTools([{
  name:"pattern_fixture",
  inputSchema:{type:"object",properties:{
    pattern:{type:"string"},
    code:{type:"string",pattern:"^[A-Z0-9]{3,7}$"},
  },required:["code"]},
  outputSchema:{type:"object",properties:{hash:{type:"string",pattern:"^[a-f0-9]{64}$"}},required:["hash"]},
}]);
assert.equal(acceptedPatterns.tools.length,1);
validateToolArguments(acceptedPatterns.tools[0],{pattern:"plain field",code:"ABC12"});
assert.throws(()=>validateToolArguments(acceptedPatterns.tools[0],{code:"not valid"}),/PROVIDER_INVALID_ARGUMENTS/);
assert.throws(()=>sanitizeProviderResult({content:[{type:"text",text:"ok"}],structuredContent:{hash:"wrong"}},
  "fixture",acceptedPatterns.tools[0]),/PROVIDER_INVALID_OUTPUT/);
assert.equal(sanitizeProviderResult({content:[{type:"text",text:"ok"}],structuredContent:{hash:"a".repeat(64)}},
  "fixture",acceptedPatterns.tools[0]).isError,undefined);
for(const expression of [
  "^(a+)+$", "^(a|aa)+$", "^a*a*a*$", "^a?a?a?a?a?a?a?a?a?a?$",
  "^(?=a)a$", "^\\p{L}+$", "^\\_$", "^a{0,9000}$", "^"+"a".repeat(180)+"$",
  "^(a|aa){20}$", "^(a|a)(a|a)(a|a)(a|a)$", "^(?:a{256}){256}$",
]){
  const denied=inspectProviderTools([{name:"unsafe_regex",inputSchema:{type:"object",properties:{value:{type:"string",pattern:expression}}}}]);
  assert.equal(denied.tools.length,0,"Unsafe pattern must not be admitted: "+expression);
  assert.match(denied.rejected[0].reason,/PROVIDER_SCHEMA_PATTERN_(?:UNSAFE|COMPLEX|INVALID)/);
}
assert.throws(() => inspectProviderTools([tool, tool]), /INVALID_TOOL_NAME/);
const { McpUpstreamManager } =
  await import("../dist/lib/mcp-upstream-manager.js");
const config = path.join(process.env.BRIDGEDEV_STATE_DIR, "closed-config.json");
await fs.writeFile(
  config,
  JSON.stringify({
    version: 1,
    servers: [
      {
        id: "fixture",
        name: "Fixture",
        transport: "stdio",
        command: process.execPath,
        args: [],
        enabled: false,
        expose: "none",
      },
    ],
  }),
);
const failClosed = new McpUpstreamManager(config);
await failClosed.init();
assert.equal(failClosed.getConfig().servers.length, 1);
await fs.writeFile(
  path.join(process.env.BRIDGEDEV_STATE_DIR, "integration-preferences.json"),
  '{"version":99,"services":[]}',
);
await assert.rejects(readIntegrationPreferences(), /PREFERENCES_INVALID/);
await assert.rejects(failClosed.reloadConfig(), /PREFERENCES_INVALID/);
assert.equal(
  failClosed.getConfig().servers.length,
  0,
  "Corrupted preferences must not retain an executable registry",
);
await failClosed.shutdown();
await fs.rm(
  path.join(process.env.BRIDGEDEV_STATE_DIR, "integration-preferences.json"),
);
console.log(
  JSON.stringify({
    catalog: catalog.entries.length,
    elapsed_ms: Math.round(performance.now() - start),
    result:
      "PASS: metadata, preferences, unknown inventory, capability fallback, no auto-disable, isolation, local refs and unsafe schema rejection",
  }),
);
