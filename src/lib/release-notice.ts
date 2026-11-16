import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const SOURCE = "https://api.github.com/repos/kmanisk/bridge-dev/commits/main";
const SHA = /^[a-f0-9]{40}$/;
export const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
export interface LatestRelease {
  current: string | null;
  latest_main: string;
  update_available: boolean | null;
  checked_at: string;
  source: "github" | "cache";
}
type Cached = { sha: string; checked_at: string };

export async function fetchLatestMainSha(
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const result = await fetcher(SOURCE, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "BridgeDev-update-check",
    },
    signal: AbortSignal.timeout(2400),
    redirect: "error",
    cache: "no-store",
  });
  if (!result.ok) throw Error("UPDATE_CHECK_REMOTE_HTTP_" + result.status);
  const body: unknown = await result.json();
  const sha =
    body && typeof body === "object" && "sha" in body
      ? (body as { sha: unknown }).sha
      : undefined;
  if (typeof sha !== "string" || !SHA.test(sha))
    throw Error("UPDATE_CHECK_INVALID_MAIN_COMMIT");
  return sha;
}

function cachePath(): string {
  return path.join(
    process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
    "bridge-dev",
    "main-sha.json",
  );
}
async function readCache(file: string): Promise<Cached | null> {
  try {
    const st = await fs.lstat(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 2048) return null;
    const x: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (!x || typeof x !== "object") return null;
    const record = x as Record<string, unknown>;
    if (
      !SHA.test(String(record.sha || "")) ||
      typeof record.checked_at !== "string" ||
      !Number.isFinite(Date.parse(record.checked_at))
    ) return null;
    return { sha: String(record.sha), checked_at: record.checked_at };
  } catch { return null; }
}
async function writeCache(file: string, data: Cached): Promise<void> {
  const dir = path.dirname(file);
  const temp = path.join(dir, ".main-sha-" + process.pid + "-" + Math.random().toString(16).slice(2));
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const h = await fs.open(temp, "wx", 0o600);
    try {
      await h.writeFile(JSON.stringify(data) + "\n", "utf8");
      await h.sync();
    } finally { await h.close(); }
    await fs.rename(temp, file);
  } finally { await fs.unlink(temp).catch(() => {}); }
}

/** Read-only. No polling, background thread, update, or service management. */
export async function checkLatestMain(
  current: string | null,
  options: { fresh?: boolean; cacheFile?: string; now?: number; fetcher?: typeof fetch } = {},
): Promise<LatestRelease | null> {
  const now = options.now ?? Date.now();
  const file = options.cacheFile ?? cachePath();
  const saved = await readCache(file);
  let chosen: Cached | null = saved;
  let source: "cache" | "github" = "cache";
  if (
    options.fresh ||
    !saved ||
    Date.parse(saved.checked_at) > now ||
    now - Date.parse(saved.checked_at) >= UPDATE_CHECK_TTL_MS
  ) {
    try {
      chosen = { sha: await fetchLatestMainSha(options.fetcher), checked_at: new Date(now).toISOString() };
      source = "github";
      await writeCache(file, chosen).catch(() => {});
    } catch {
      // Offline, GitHub unavailable, or no gh: never interrupt the CLI.
      if (!saved) return null;
    }
  }
  if (!chosen) return null;
  return {
    current: current && SHA.test(current) ? current : null,
    latest_main: chosen.sha,
    update_available: current && SHA.test(current) ? current !== chosen.sha : null,
    checked_at: chosen.checked_at,
    source,
  };
}

export function formatUpdateHint(result: LatestRelease | null): string | null {
  if (!result || result.update_available !== true) return null;
  return "BridgeDev update available: installed " +
    result.current!.slice(0, 7) + " → main " +
    result.latest_main.slice(0, 7) +
    ". Run 'bridge-dev update --check' then 'bridge-dev update' (requires STANDARD).";
}
