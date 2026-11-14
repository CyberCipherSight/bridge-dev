import {z} from "zod";
import {readSettings,writeSettings} from "./runtime-settings.js";
import fsp from "fs/promises";
import os from "os";
import path from "path";

export interface LocalPluginsConfig {
  computer_use?: { enabled?: boolean };
}

const configPath = () => path.resolve(process.cwd(), "profiles", "plugins.json");

const pluginSchema=z.object({computer_use:z.object({enabled:z.boolean().optional()}).strict().optional()}).strict();
export function getLocalPluginsConfig(): LocalPluginsConfig {
 return readSettings('plugins',configPath(),pluginSchema,{computer_use:{enabled:false}});
}
export function saveLocalPluginsConfig(next: LocalPluginsConfig): void {writeSettings('plugins',pluginSchema,next);}

export function isComputerUseEnabled(): boolean {
  return process.platform === "win32" && getLocalPluginsConfig().computer_use?.enabled === true;
}

export async function resolveComputerUseSkillPath(): Promise<string | undefined> {
  if (!isComputerUseEnabled()) return undefined;
  try {
    const versionsDir = path.join(os.homedir(), ".codex", "plugins", "cache", "openai-bundled", "computer-use");
    const versions = await fsp.readdir(versionsDir, { withFileTypes: true });
    const version = versions.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().at(-1);
    if (!version) return undefined;
    const skillPath = path.join(versionsDir, version, "skills", "computer-use", "SKILL.md");
    await fsp.access(skillPath);
    return skillPath;
  } catch {
    return undefined;
  }
}
