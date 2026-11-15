import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { portableStateDir } from "./runtime.js";
import { atomicJson, withFileLock } from "./atomic-store.js";

export const integrationPreference = z
  .object({
    service: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    preference: z.enum([
      "auto",
      "prefer-bridgedev",
      "chatgpt-only",
      "bridgedev-only",
      "disabled",
    ]),
    availability: z
      .enum(["unknown", "connected", "not-connected"])
      .default("unknown"),
    native_kind: z.enum(["official", "third-party"]).default("official"),
    capabilities: z.array(z.string().min(1).max(100)).max(64).default([]),
    provider_id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,48}$/)
      .optional(),
  })
  .strict();
export type IntegrationPreference = z.infer<typeof integrationPreference>;
const schema = z
  .object({
    version: z.literal(1),
    services: z.array(integrationPreference).max(256),
  })
  .strict();
export type IntegrationPreferences = z.infer<typeof schema>;
const filename = () =>
  path.join(portableStateDir(), "integration-preferences.json");
export async function readIntegrationPreferences(): Promise<IntegrationPreferences> {
  try {
    const file = filename(),
      stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 131072)
      throw Error("INTEGRATION_PREFERENCES_UNSAFE");
    const data = schema.parse(JSON.parse(await fs.readFile(file, "utf8")));
    if (
      new Set(data.services.map((s) => s.service)).size !== data.services.length
    )
      throw Error("INTEGRATION_PREFERENCE_DUPLICATE");
    const bindings = data.services.flatMap((s) =>
      s.provider_id ? [s.provider_id] : [],
    );
    if (new Set(bindings).size !== bindings.length)
      throw Error("INTEGRATION_PROVIDER_ALREADY_BOUND");
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, services: [] };
    throw Error("INTEGRATION_PREFERENCES_INVALID: operator repair required");
  }
}
export async function saveIntegrationPreference(
  value: unknown,
): Promise<IntegrationPreferences> {
  const entry = integrationPreference.parse(value);
  return withFileLock(filename(), async () => {
    const current = await readIntegrationPreferences();
    // A provider has one unambiguous service binding. No inferred name matches.
    if (
      entry.provider_id &&
      current.services.some(
        (s) =>
          s.service !== entry.service && s.provider_id === entry.provider_id,
      )
    )
      throw Error("INTEGRATION_PROVIDER_ALREADY_BOUND");
    const next = schema.parse({
      version: 1,
      services: [
        ...current.services.filter((s) => s.service !== entry.service),
        entry,
      ],
    });
    await atomicJson(filename(), next);
    return next;
  });
}
/** Unknown client inventories never imply connection or grant execution permission. */
export function resolveIntegration(
  preference: IntegrationPreference | undefined,
  capability?: string,
  local = false,
) {
  const choice = preference?.preference || "auto",
    availability = preference?.availability || "unknown";
  const suitable =
    availability === "connected" &&
    !!capability &&
    !!preference?.capabilities.includes(capability);
  if (choice === "disabled")
    return {
      provider: "none",
      reason: "Disabled by operator",
      availability,
      offer_local: false,
    };
  if (choice === "chatgpt-only")
    return {
      provider: suitable ? "chatgpt" : "none",
      reason: suitable
        ? "User-declared connected capability"
        : "ChatGPT only; required connected capability is unverified",
      availability,
      offer_local: false,
    };
  if (choice === "bridgedev-only" || choice === "prefer-bridgedev")
    return {
      provider: "bridgedev",
      reason:
        "Explicit operator preference; execution still requires normal permissions",
      availability,
      offer_local: true,
    };
  if (suitable)
    return {
      provider: "chatgpt",
      reason:
        "User-declared connected " +
        preference!.native_kind +
        " plugin supports this capability",
      availability,
      offer_local: false,
    };
  return {
    provider: "bridgedev",
    reason: local
      ? "Local host/workspace capability"
      : "No verified suitable ChatGPT capability; offer reviewed BridgeDev fallback",
    availability,
    offer_local: true,
  };
}
export function providerPreferenceAllows(
  config: IntegrationPreferences,
  id: string,
): boolean {
  return !config.services.some(
    (s) =>
      s.provider_id === id &&
      ["disabled", "chatgpt-only"].includes(s.preference),
  );
}
