import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Only inspect this user's conventional local skill directory. The public
// marketplace never contains machine-specific paths, resources or examples.
export async function listLocalSkills(
  directory = path.join(os.homedir(), ".agents", "skills"),
) {
  try {
    if (!(await fs.lstat(directory)).isDirectory()) return { skills: [] };
    const names = await fs.readdir(directory, { withFileTypes: true });
    const skills = [];
    for (const entry of names.slice(0, 256)) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(entry.name)) continue;
      const source = path.join(directory, entry.name);
      try {
        const skillFile = path.join(source, "SKILL.md");
        if (!(await fs.lstat(skillFile)).isFile()) continue;
        // Bounded inert display metadata; never execute local skill content.
        const handle = await fs.open(skillFile, "r");
        const prefix = Buffer.alloc(4096);
        let bytesRead = 0;
        try { ({bytesRead} = await handle.read(prefix, 0, prefix.length, 0)); }
        finally { await handle.close(); }
        const sample = prefix.toString("utf8", 0, bytesRead);
        const title = /^#\s+([^\r\n]{3,100})$/m.exec(sample)?.[1]?.trim();
        const description = /^description:\s*([^\r\n]{1,320})$/m.exec(sample)?.[1]?.trim() || "";
        skills.push({
          id: entry.name,
          name: title || entry.name.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          description,
          source,
        });
      } catch { /* Missing or inaccessible SKILL.md: not a discoverable skill. */ }
    }
    return { skills: skills.sort((a, b) => a.name.localeCompare(b.name)) };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error &&
        (error.code === "ENOENT" || error.code === "EACCES")) return { skills: [] };
    throw error;
  }
}