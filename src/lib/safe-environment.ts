import path from "node:path";
import { z } from "zod";
import {
  readSettings,
  writeSettings,
  settingsPath,
} from "./runtime-settings.js";
const schema = z
  .object({
    CHATGPT_TOOL_PROFILE: z.enum(["slim", "full"]).optional(),
    SHELL_TIMEOUT: z
      .string()
      .regex(/^[1-9][0-9]{0,3}$/)
      .refine((v) => Number(v) <= 3600)
      .optional(),
    CHECKPOINT_ENABLED: z.enum(["true", "false"]).optional(),
  })
  .strict();
export function safeEnvironment(): Record<string, string> {
  return readSettings(
    "environment",
    path.join(
      path.dirname(settingsPath("environment")),
      "unused-legacy-environment",
    ),
    schema,
    {},
  );
}
export function applySafeEnvironment(): void {
  for (const [k, v] of Object.entries(safeEnvironment())) process.env[k] = v;
}
export function saveSafeEnvironment(value: unknown): void {
  const values = schema.parse(value);
  writeSettings("environment", schema, { ...safeEnvironment(), ...values });
}
