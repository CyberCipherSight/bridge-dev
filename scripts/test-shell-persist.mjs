/**
 * Global shell cwd persists across bootstrap (simulates ChatGPT new MCP sessions).
 */
import fs from "fs/promises";
import assert from "node:assert/strict";
import path from "path";
import { fileURLToPath } from "url";
import {
  bootstrapShellSession,
  shutdownShellCommands,
  execInShellSession,
  getShellStatus,
} from "../dist/lib/persistent-shell.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const stateDir = path.join(process.env.BRIDGEDEV_TEST_ROOT, "shell-persist");

process.env.MCP_SHELL_STATE_DIR = stateDir;

let passed = 0;
let failed = 0;
function ok(m) { console.log(`OK  ${m}`); passed++; }
function fail(m, e) { console.error(`FAIL ${m}: ${e && e.stack || e}`); failed++; }

try {
  await fs.rm(stateDir, { recursive: true, force: true });
  await bootstrapShellSession(root);
  await execInShellSession(process.platform === "win32" ? "cd src" : "cd src", root, 5000);

  const cwd1 = getShellStatus().cwd;
  if (!cwd1.replace(/\\/g, "/").endsWith("/src")) {
    throw new Error(`expected cwd in src, got ${cwd1}`);
  }
  ok(`cwd after cd: ${cwd1}`);

  await bootstrapShellSession(root);
  const cwd2 = getShellStatus().cwd;
  if (cwd2 !== cwd1) throw new Error(`persist failed: ${cwd1} -> ${cwd2}`);
  ok("cwd restored after re-bootstrap");
  if(process.platform!=="win32"){
    await fs.mkdir(stateDir,{recursive:true});
    const pidFile=path.join(stateDir,"child.pid"),quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
    const running=execInShellSession("echo $$ > "+quote(pidFile)+"; sleep 15 & wait",root,20000,stateDir);
    let pid;for(let i=0;i<40;i++){try{pid=Number(await fs.readFile(pidFile,"utf8"));if(pid)break;}catch{}await new Promise(r=>setTimeout(r,25));}
    assert.ok(pid);shutdownShellCommands();await running;assert.throws(()=>process.kill(pid,0),/ESRCH/);
    ok("gateway shutdown kills active command groups");
  }
} catch (e) {
  fail("shell persist", e.message || e);
}

await fs.rm(stateDir,{recursive:true,force:true});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);