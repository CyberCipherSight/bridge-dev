#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sign, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { formatMcpEndpoint, isValidSignedLease, inspectLocalMode,
  validateProjectName, resolveProjectDirectory, verifyAuditProof } from "../dist/lib/cli-security.js";
import { HashAudit } from "../dist/lib/hash-audit.js";
import {rotateCredentialFile,inspectCredentialFile} from "../dist/lib/token-rotation.js";
import {swayShortcut} from "../dist/lib/monitor-cli.js";
import {offerPersistentBootService} from "../dist/lib/yolo-autostart.js";
import {parseCliArguments,cliOption} from "../dist/lib/cli-arguments.js";

const rootArgs=['operator','exec','--json','--cwd','/fixture','--','/bin/echo','--json','--verbose','--cwd','/other'];
const parsed=parseCliArguments(rootArgs);
assert.equal(parsed.json,true);assert.equal(parsed.verbose,false);
assert.deepEqual(parsed.args.slice(parsed.args.indexOf('--')+1),['/bin/echo','--json','--verbose','--cwd','/other']);
assert.equal(cliOption(parsed.args,'--cwd'),'/fixture');
assert.equal(cliOption(['operator','exec','--','/bin/echo','--cwd','/other'],'--cwd'),undefined);
assert.equal(parseCliArguments(['operator','exec','--','/bin/echo','--json']).json,false);

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"bridge-dev-cli-test-"));
const cli=path.resolve("dist/cli.js");
function run(args,env={}) {
  return spawnSync(process.execPath,[cli,...args],{
    encoding:"utf8",timeout:9000,
    env:{...process.env,POLICYGATE_POLICY_FILE:"",BRIDGEDEV_RUNTIME_MODE:"portable",BRIDGEDEV_STATE_DIR:path.join(tmp,"state"),HOME:tmp,MCP_TOKEN:"cli-regression-private-token",...env}
  });
}
try {
  assert.equal(formatMcpEndpoint("https://test.example/","secret"),"https://test.example/mcp/<MCP_TOKEN>");
  assert.equal(formatMcpEndpoint("https://test.example","abc",true),"https://test.example/mcp/abc");
  const invalid=run(["unknown-command","--json"]);assert.equal(invalid.status,1);assert.equal(JSON.parse(invalid.stderr).code,"BRIDGEDEV_ERROR");
  const help=run(["help"]);assert.equal(help.status,0,help.stderr);
  assert.match(help.stdout,/mode read-write/);assert.match(help.stdout,/mode sudo --duration 60/);
  const recovery=fs.readFileSync("scripts/bridge-dev-recover.sh","utf8");
  assert.match(recovery,/CLI=\/usr\/local\/bin\/bridge-dev/);
  assert.match(recovery,/active_lease\(\)/);
  assert.match(recovery,/rollback\(\)/);
  assert.match(recovery,/full_machine_access=true/);
  assert.doesNotMatch(recovery,/sudo\s+(?:rm|chown|chmod|systemctl)|\bexec\s+sudo\b/);
  if(process.platform!=="win32"){
    const syntax=spawnSync("sh",["-n","scripts/bridge-dev-recover.sh"],{encoding:"utf8"});
    assert.equal(syntax.status,0,syntax.stderr);
    const helpScript=spawnSync("sh",["scripts/bridge-dev-recover.sh","--help"],{encoding:"utf8"});
    assert.equal(helpScript.status,0,helpScript.stderr);
    assert.match(helpScript.stdout,/check.*on.*off/);
    const deniedScript=spawnSync("sh",["scripts/bridge-dev-recover.sh","on","121"],{encoding:"utf8"});
    assert.notEqual(deniedScript.status,0);
    // No actual activation is possible from the test environment.
  }
  const denied=run(["mode","sudo"]);assert.notEqual(denied.status,0);
  assert.match(denied.stderr,/portable mode cannot elevate/);
  const access=run(["access"]);
  assert.notEqual(access.status,0);
  assert.match(access.stderr,/private interactive terminal/);
  const conn=run(["connect"]);
  assert.equal(conn.status,0,conn.stderr);
  assert.match(conn.stdout,/\/mcp\/<MCP_TOKEN>/);
  assert.doesNotMatch(conn.stdout,/cli-regression-private-token|headers.*Authorization/i);
  const visible=run(["connect","--show-token"]);
  assert.equal(visible.status,0,visible.stderr);
  assert.match(visible.stdout,/\/mcp\/cli-regression-private-token/);
  const login=run(["login"]);
  assert.equal(login.status,0,login.stderr);
  assert.doesNotMatch(login.stdout,/cli-regression-private-token/);
  const generated=run(["login","--generate"]);
  assert.equal(generated.status,0,generated.stderr);
  assert.match(generated.stdout,/[a-f0-9]{64}/);

  assert.throws(()=>validateProjectName("../../etc"));
  assert.throws(()=>validateProjectName("bad;name"));
  const validDir=path.join(tmp,"safe-project");
  fs.mkdirSync(validDir);
  assert.equal(fs.realpathSync.native(resolveProjectDirectory(validDir,tmp)),fs.realpathSync.native(validDir));
  assert.throws(()=>resolveProjectDirectory(path.join(tmp,"missing"),tmp));
  const unsafe=run(["project","unmap","../../etc"]);
  assert.notEqual(unsafe.status,0);
  assert.match(unsafe.stderr,/Invalid project/);
  const src=fs.readFileSync("src/cli.ts","utf8");
  assert.match(src,/policygate-project/);
  assert.doesNotMatch(src,/sudo setfacl|sudo mount --bind|sudo umount/);
  // A failed operator revocation must never be reported as a successful mode change.
  // No real controller/lease is invoked by this portable regression test.
  const modeSwitch = src.slice(src.indexOf("async function cmdMode("),src.indexOf("function cmdProject("));
  assert.match(modeSwitch,/if \(hostControllerAvailable\(\)\) \{\s*if \(!runOperator\(\["mode","standard"\]\)\) return;/);
  assert.match(modeSwitch,/if \(args.includes\("--off"\)\) \{\s*if \(!runOperator\(\["mode","standard"\]\)\) return;/);
  assert.equal((modeSwitch.match(/verified\.mode !== "STANDARD"/g)||[]).length,2);
  assert.match(modeSwitch,/STANDARD transition not confirmed/);
  assert.match(modeSwitch,/Full System revocation not confirmed/);

  // An optional second confirmation must never modify YOLO state, and must
  // never install, enable or sudo without explicit operator opt-in.
  async function bootFixture(initial, decision) {
    const state={...initial}, actions=[], notes=[];
    const ops={
      status:async()=>({...state}),
      confirm:async()=>{actions.push("confirm");return decision;},
      install:async()=>{actions.push("install");state.installed=true;state.enabled=true;},
      enable:async()=>{actions.push("enable");state.enabled=true;},
      enableLinger:async()=>{actions.push("linger");state.linger=true;},
      log:(text)=>notes.push(text),
    };
    const result=await offerPersistentBootService(ops);
    return {result,actions,notes,state};
  }
  const bootDeclined=await bootFixture({installed:true,enabled:false,linger:false},false);
  assert.equal(bootDeclined.result,"declined");
  assert.deepEqual(bootDeclined.actions,["confirm"]);
  const bootAlready=await bootFixture({installed:true,enabled:true,linger:true,active:true},true);
  assert.equal(bootAlready.result,"already-enabled");
  assert.deepEqual(bootAlready.actions,["confirm"]);
  const bootExisting=await bootFixture({installed:true,enabled:false,linger:false,active:true},true);
  assert.equal(bootExisting.result,"enabled");
  assert.deepEqual(bootExisting.actions,["confirm","enable","linger"]);
  const bootFresh=await bootFixture({installed:false,enabled:false,linger:false,active:false},true);
  assert.equal(bootFresh.result,"enabled");
  assert.deepEqual(bootFresh.actions,["confirm","install","linger"]);
  const bootLingerOnly=await bootFixture({installed:true,enabled:true,linger:false,active:true},true);
  assert.deepEqual(bootLingerOnly.actions,["confirm","linger"]);
  await assert.rejects(offerPersistentBootService({
    status:async()=>({installed:true,enabled:false,linger:false}),
    confirm:async()=>true,
    install:async()=>{throw Error("not called");},
    enable:async()=>{throw Error("systemctl failed");},
    enableLinger:async()=>{throw Error("not called");},
    log:()=>{},
  }),/systemctl failed/);
  assert.match(src,/await offerBootAutostartAfterLocalYolo\(\)/);
  assert.match(src,/if \(mode\.mode === "YOLO"\)/);

  // Native credential rotation is operator-owned, backup-first and atomic.
  // No real machine secrets, services, or independent root controller are touched.
  if (process.platform !== "win32") {
  const creds=path.join(tmp,"private.env");
  const original="MCP_TOKEN="+"a".repeat(64)+"\nADMIN_TOKEN="+"b".repeat(64)+"\nPORT=3000\n";
  fs.writeFileSync(creds,original,{mode:0o600});
  assert.equal((await inspectCredentialFile(creds)).configured,true);
  const changed=await rotateCredentialFile(creds,"admin",()=>"c".repeat(64));
  assert.equal(fs.readFileSync(changed.backup,"utf8"),original);
  assert.equal(fs.statSync(changed.backup).mode & 0o777,0o600);
  assert.equal(fs.statSync(creds).mode & 0o777,0o600);
  assert.equal(fs.readFileSync(creds,"utf8"),original.replace("b".repeat(64),"c".repeat(64)));
  const duplicate=path.join(tmp,"duplicate.env");
  fs.writeFileSync(duplicate,original+"ADMIN_TOKEN=other\n",{mode:0o600});
  await assert.rejects(rotateCredentialFile(duplicate,"admin"),/DUPLICATE_OR_MISSING/);
  const worldReadable=path.join(tmp,"unsafe.env");
  fs.writeFileSync(worldReadable,original,{mode:0o644});
  await assert.rejects(rotateCredentialFile(worldReadable,"admin"),/TOKEN_FILE_UNSAFE/);
  }
  assert.match(swayShortcut("Mod4+Mod1+d"),/bindsym --no-repeat Mod4\+Mod1\+d/);
  assert.throws(()=>swayShortcut("Mod4+Mod1+d;rm"),/INVALID_KEY/);
  assert.match(fs.readFileSync("src/cli.ts","utf8"),/case "update":/);
  assert.match(fs.readFileSync("src/cli.ts","utf8"),/repos\/kmanisk\/bridge-dev\/commits\/main/);
  const blocked=run(["token","rotate","admin"]);
  assert.notEqual(blocked.status,0);
  assert.match(blocked.stderr,/TOKEN_ROTATION_LOCAL_TTY_REQUIRED/);
  const kp=generateKeyPairSync("ed25519"),now=Date.now();
  const lease={mode:"dangerous",expires_at:now+180000,nonce:"hello"};
  const pem=kp.publicKey.export({type:"spki",format:"pem"});
  const signed={...lease,signature:sign(null,Buffer.from(JSON.stringify(lease)),kp.privateKey).toString("base64")};
  assert.equal(isValidSignedLease(signed,pem,now),true);
  assert.equal(isValidSignedLease({...signed,mode:"standard"},pem,now),false);
  assert.equal(isValidSignedLease({...signed,expires_at:now-1},pem,now),false);
  const state=path.join(tmp,"state");fs.mkdirSync(state);
  const pub=path.join(tmp,"operator-public.pem");fs.writeFileSync(pub,pem);
  fs.writeFileSync(path.join(state,"yolo-lease.json"),JSON.stringify(signed));
  assert.equal(inspectLocalMode({stateDir:state,publicKeyFile:pub,now}).mode,"UNKNOWN","Legacy signatures do not activate full host access");
  if(process.platform!=="win32"){
    const scoped={...lease,scope:"host-root-v1"};
    const scopedSigned={...scoped,signature:sign(null,Buffer.from(JSON.stringify(scoped)),kp.privateKey).toString("base64")};
    const activationFile=path.join(state,"active.json");
    fs.writeFileSync(activationFile,JSON.stringify({mode:"standard",nonce:lease.nonce,expires:lease.expires_at}));
    fs.writeFileSync(path.join(state,"yolo-lease.json"),JSON.stringify(scopedSigned));
    assert.equal(inspectLocalMode({stateDir:state,publicKeyFile:pub,activationFile,now}).mode,"YOLO");
    const permanent={mode:"dangerous",expires_at:null,nonce:"manual-toggle",scope:"host-root-v1",lifetime:"until_off"};
    const signedPermanent={...permanent,signature:sign(null,Buffer.from(JSON.stringify(permanent)),kp.privateKey).toString("base64")};
    assert.equal(isValidSignedLease(signedPermanent,pem,now),true);
    assert.equal(isValidSignedLease({...signedPermanent,lifetime:"fake"},pem,now),false);
    assert.equal(isValidSignedLease({...signedPermanent,expires_at:undefined},pem,now),false);
    fs.writeFileSync(activationFile,JSON.stringify({mode:"standard",nonce:permanent.nonce,expires:null,lifetime:"until_off"}));
    fs.writeFileSync(path.join(state,"yolo-lease.json"),JSON.stringify(signedPermanent));
    assert.equal(inspectLocalMode({stateDir:state,publicKeyFile:pub,activationFile,now}).mode,"YOLO");
    fs.writeFileSync(activationFile,JSON.stringify({mode:"standard"}));
    assert.equal(inspectLocalMode({stateDir:state,publicKeyFile:pub,activationFile,now}).mode,"STANDARD");
    fs.writeFileSync(path.join(state,"yolo-lease.json"),JSON.stringify(scopedSigned));
    fs.writeFileSync(activationFile,JSON.stringify({mode:"standard"}));
    assert.equal(inspectLocalMode({stateDir:state,publicKeyFile:pub,activationFile,now}).mode,"STANDARD");
    fs.writeFileSync(activationFile,JSON.stringify({mode:"strict"}));
    fs.writeFileSync(path.join(state,"mode.json"),JSON.stringify({mode:"standard"}));
    assert.equal(inspectLocalMode({stateDir:state,publicKeyFile:pub,activationFile,now}).mode,"STRICT");
  }
  fs.writeFileSync(path.join(state,"yolo-lease.json"),JSON.stringify({...signed,signature:"invalid"}));
  assert.equal(inspectLocalMode({stateDir:state,publicKeyFile:pub,now}).mode,"UNKNOWN");
  fs.unlinkSync(path.join(state,"yolo-lease.json"));
  fs.writeFileSync(path.join(state,"mode.json"),JSON.stringify({mode:"strict"}));
  assert.equal(inspectLocalMode({stateDir:state,publicKeyFile:pub,now}).mode,"STRICT");

  const log=path.join(tmp,"audit.jsonl"),audit=new HashAudit(log);
  await audit.append({type:"fixture",path:"safe-project"});
  const entry=JSON.parse(fs.readFileSync(log,"utf8").trim());
  const anchor=path.join(tmp,"anchor.json");
  fs.writeFileSync(anchor,JSON.stringify({entries:1,last_hash:entry.hash}));
  assert.equal(verifyAuditProof(log,anchor).entries,1);
  fs.writeFileSync(anchor,JSON.stringify({entries:1,last_hash:"f".repeat(64)}));
  assert.throws(()=>verifyAuditProof(log,anchor));
  console.log("BridgeDev CLI security regression: PASS");
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
