import assert from "node:assert/strict";
import { proxyToolName } from "../../dist/lib/provider-security.js";

/**
 * Validate the native, pinned API without rejecting independently reviewed
 * optional upstream tools. Proxy exposure is verified against the authenticated
 * Admin configuration; cached provider health is NOT an authority because an
 * idle on-demand provider may have disconnected after tools/list.
 *
 * No optional provider is installed, connected, or invoked by this function.
 */
export function verifyGatewayToolInventory(tools, nativeNames, providers) {
  assert.ok(Array.isArray(tools) && Array.isArray(nativeNames) && Array.isArray(providers),
    "ACCEPTANCE_INVENTORY_INVALID_INPUT");
  assert.ok(nativeNames.length > 0 && nativeNames.every(name => typeof name === "string"),
    "ACCEPTANCE_NATIVE_MANIFEST_INVALID");

  const names = tools.map(tool => tool?.name);
  assert.ok(names.every(name => typeof name === "string" && name.length > 0),
    "ACCEPTANCE_TOOL_NAME_INVALID");
  const actual = new Set(names), natives = new Set(nativeNames);
  assert.equal(actual.size, names.length, "ACCEPTANCE_DUPLICATE_TOOLS");
  assert.equal(natives.size, nativeNames.length, "ACCEPTANCE_DUPLICATE_NATIVE_MANIFEST");
  const missing = nativeNames.filter(name => !actual.has(name));
  assert.deepEqual(missing, [], "ACCEPTANCE_NATIVE_TOOLS_MISSING");

  const optional = names.filter(name => !natives.has(name));
  if (!optional.length) return { native: natives.size, optional: 0, optional_names: [] };

  const permitted = new Set();
  for (const provider of providers) {
    if (!provider || provider.enabled !== true ||
        provider.reviewed === false ||
        !["allowlist", "all"].includes(provider.expose)) continue;
    const prefix = provider.tool_prefix || provider.id;
    if (typeof prefix !== "string" || !/^[a-zA-Z0-9_-]{1,48}$/.test(prefix))
      continue;
    const disabled = new Set(Array.isArray(provider.disabled_tools) ? provider.disabled_tools : []);
    if (provider.expose === "allowlist") {
      for (const tool of Array.isArray(provider.tools) ? provider.tools : []) {
        if (typeof tool === "string" && tool && !disabled.has(tool))
          permitted.add(proxyToolName(prefix, tool));
      }
    } else if (provider.reviewed === true) {
      // For "all", only individually approved tool permissions can justify
      // an extra advertised tool in the independent deployment acceptance.
      for (const [tool, level] of Object.entries(provider.tool_permissions || {})) {
        if (["R", "W", "X"].includes(level) && !disabled.has(tool))
          permitted.add(proxyToolName(prefix, tool));
      }
    }
  }

  const unexpected = optional.filter(name => !permitted.has(name));
  assert.deepEqual(unexpected, [], "ACCEPTANCE_UNREVIEWED_PROVIDER_TOOLS");
  return { native: natives.size, optional: optional.length, optional_names: optional };
}
