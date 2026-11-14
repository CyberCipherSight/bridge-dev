import {atomicJson} from "./atomic-store.js";
import {z} from "zod";
import { createHash } from "node:crypto";
import fs from "fs/promises";
import path from "path";

export interface GlobalShellState {
  version?:1;
  workspace_key: string;
  cwd: string;
  updated_at: string;
  recent_commands: string[];
}

function getStateDir(): string {
  if (process.env.MCP_SHELL_STATE_DIR) return path.resolve(process.env.MCP_SHELL_STATE_DIR);
  if (process.env.HOME) return path.join(process.env.HOME, ".mcp-state");
  return path.join(process.cwd(), ".mcp-state");
}
const MAX_RECENT = 20;

function workspaceKey(workspaceRoot: string): string {
  return createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex").slice(0, 16);
}

function statePath(workspaceRoot: string): string {
  return path.join(getStateDir(), `shell-${workspaceKey(workspaceRoot)}.json`);
}

export async function loadGlobalShellState(
  workspaceRoot: string,
  defaultCwd: string
): Promise<GlobalShellState | null> {
  try {
    const raw = await fs.readFile(statePath(workspaceRoot), "utf-8");
    const schema=z.object({version:z.literal(1).optional(),workspace_key:z.literal(workspaceKey(workspaceRoot)),cwd:z.string().refine(p=>path.isAbsolute(p)),updated_at:z.string(),recent_commands:z.array(z.string().max(1048576)).max(MAX_RECENT)}).strict();
    return schema.parse(JSON.parse(raw));
  } catch(error) {
    if((error as NodeJS.ErrnoException).code==='ENOENT')return null;
    throw Error('SHELL_STATE_INVALID_OR_FUTURE_SCHEMA');
  }
}

export async function saveGlobalShellState(
  workspaceRoot: string,
  cwd: string,
  command?: string,
  previous?: GlobalShellState | null
): Promise<void> {
  const recent = [...(previous?.recent_commands ?? [])];
  if (command) {
    recent.push(command);
    while (recent.length > MAX_RECENT) recent.shift();
  }

  const state: GlobalShellState = {
    version:1,
    workspace_key: workspaceKey(workspaceRoot),
    cwd: path.resolve(cwd),
    updated_at: new Date().toISOString(),
    recent_commands: recent,
  };

  await atomicJson(statePath(workspaceRoot),state);
}

export async function restoreShellFromDisk(
  workspaceRoot: string,
  defaultCwd: string
): Promise<string> {
  const saved = await loadGlobalShellState(workspaceRoot, defaultCwd);
  return saved?.cwd ?? path.resolve(defaultCwd);
}