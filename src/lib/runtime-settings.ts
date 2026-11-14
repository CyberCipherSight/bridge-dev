import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { portableStateDir } from "./runtime.js";
export function settingsPath(name: string): string {
  if (!/^[a-z-]+$/.test(name)) throw Error("SETTINGS_NAME_INVALID");
  return path.join(portableStateDir(), "settings", name + ".json");
}
export function readSettings<T>(
  name: string,
  legacy: string,
  schema: z.ZodType<T>,
  fallback: T,
): T {
  for (const filename of [settingsPath(name), legacy]) {
    try {
      const st = fs.lstatSync(filename);
      if (!st.isFile() || st.isSymbolicLink() || st.size > 1048576)
        throw Error();
      const value = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (value.version !== undefined) {
        if (
          value.version !== 1 ||
          Object.keys(value).some((k) => !["version", "data"].includes(k))
        )
          throw Error();
        return schema.parse(value.data);
      }
      // Known unversioned legacy shape is read in memory; never silently rewritten.
      return schema.parse(value);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw Error("SETTINGS_INVALID_OR_FUTURE_SCHEMA: " + name);
    }
  }
  return fallback;
}
export function writeSettings<T>(
  name: string,
  schema: z.ZodType<T>,
  value: T,
): void {
  const data = schema.parse(value),
    filename = settingsPath(name);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  try {
    const st = fs.lstatSync(filename);
    if (!st.isFile() || st.isSymbolicLink())
      throw Error("SETTINGS_UNSAFE_PATH");
    const old = fs.readFileSync(filename);
    const backup = filename + ".backup-" + Date.now() + "-" + randomUUID();
    fs.writeFileSync(backup, old, { mode: 0o600, flag: "wx" });
    if (!fs.readFileSync(backup).equals(old))
      throw Error("SETTINGS_BACKUP_FAILED");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const temp = filename + "." + randomUUID();
  try {
    const fd = fs.openSync(temp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({ version: 1, data }) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, filename);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
export const toolSettingsSchema = z
  .object({
    enabled: z.array(z.string().max(256)).max(256).optional(),
    disabled: z.array(z.string().max(256)).max(256).optional(),
  })
  .strict();
