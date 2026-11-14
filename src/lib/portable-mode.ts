import fs from "node:fs";
import path from "node:path";
import { portableStateDir } from "./runtime.js";
export function readPortableMode(): "strict" | "standard" {
  try {
    const filename = path.join(portableStateDir(), "mode.json"),
      st = fs.lstatSync(filename);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 4096) throw Error();
    const value = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (
      (value.version !== undefined && value.version !== 1) ||
      !["strict", "standard"].includes(value.mode) ||
      Object.keys(value).some((k) => !["version", "mode"].includes(k))
    )
      throw Error();
    return value.mode;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "standard";
    throw Error(
      "PORTABLE_MODE_INVALID_OR_FUTURE_SCHEMA: refusing to assume STANDARD",
    );
  }
}
