import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {cliLogFile,writeCliEvent,cliResultLine,cliErrorMessage} from "../dist/lib/cli-report.js";

const base=fs.mkdtempSync(path.join(os.tmpdir(),"bridge-cli-report-"));
const previous={XDG_STATE_HOME:process.env.XDG_STATE_HOME,MCP_TOKEN:process.env.MCP_TOKEN,ADMIN_TOKEN:process.env.ADMIN_TOKEN};
try {
  process.env.XDG_STATE_HOME=path.join(base,"state");
  process.env.MCP_TOKEN="synthetic-mcp-token-12345678";
  process.env.ADMIN_TOKEN="synthetic-admin-token-12345678";
  const file=cliLogFile();
  assert.ok(file.startsWith(base));
  assert.equal(writeCliEvent({command:"update",status:"SUCCESS",release:"a".repeat(40),
    detail:"reason synthetic-mcp-token-12345678 https://example.org/?token=secret"}),true);
  if(process.platform!=="win32"){
    assert.equal(fs.statSync(path.dirname(file)).mode&0o777,0o700);
    assert.equal(fs.statSync(file).mode&0o777,0o600);
  }
  const record=JSON.parse(fs.readFileSync(file,"utf8").trim());
  assert.equal(record.command,"update");
  assert.equal(record.status,"SUCCESS");
  assert.ok(!JSON.stringify(record).includes("synthetic-mcp-token"));
  assert.ok(!JSON.stringify(record).includes("example.org"));
  assert.equal(cliResultLine("service","update",{status:"SUCCESS",job_id:"fixture-id",commit:"a".repeat(40)}),
    "Service update: success · aaaaaaa · job fixture-id");
  assert.equal(cliResultLine("service","status",{active:true,current:"a".repeat(40),rollback_available:true}),
    "Service: running · aaaaaaa · rollback available");
  assert.equal(cliErrorMessage(Error("failure\nother line")),"failure other line");
  if(process.platform!=="win32"){
    fs.chmodSync(file,0o644);
    assert.equal(writeCliEvent({command:"update",status:"FAILED"}),false);
    fs.chmodSync(file,0o600);
    fs.renameSync(file,file+".saved");
    fs.symlinkSync(file+".saved",file);
    assert.equal(writeCliEvent({command:"update",status:"FAILED"}),false);
    fs.unlinkSync(file);
  }
  assert.equal(writeCliEvent({command:"doctor",status:"OK"}),true);
  fs.writeFileSync(file,"x".repeat(2*1024*1024+5),{mode:0o600});
  assert.equal(writeCliEvent({command:"doctor",status:"OK"}),true);
  assert.ok(fs.statSync(file+".1").size>2*1024*1024);
  assert.ok(fs.statSync(file).size<1000);

  const env={...process.env,BRIDGEDEV_RUNTIME_MODE:"portable",POLICYGATE_POLICY_FILE:"",
    DOTENV_CONFIG_PATH:path.join(base,"empty.env"),BRIDGEDEV_UPDATE_NOTICE:"off"};
  const cli=path.resolve("dist/cli.js");
  const invalid=spawnSync(process.execPath,[cli,"unknown-command"],{env,encoding:"utf8",timeout:9000});
  assert.equal(invalid.status,1);
  assert.match(invalid.stderr,/^Error: Unknown command:/);
  assert.equal(invalid.stderr.trim().split("\n").length,1);
  const structured=spawnSync(process.execPath,[cli,"unknown-command","--json"],{env,encoding:"utf8",timeout:9000});
  assert.equal(structured.status,1);
  assert.equal(JSON.parse(structured.stderr).code,"BRIDGEDEV_ERROR");
  const usage=spawnSync(process.execPath,[cli,"help"],{env,encoding:"utf8",timeout:9000});
  assert.equal(usage.status,0,usage.stderr);
  assert.match(usage.stdout,/--verbose/);
}finally{
  for(const [key,val] of Object.entries(previous)){
    if(val===undefined)delete process.env[key];else process.env[key]=val;
  }
  fs.rmSync(base,{recursive:true,force:true});
}
console.log("CLI output: one-line errors, private event log, rotation, symlink denial, JSON compatibility PASS");