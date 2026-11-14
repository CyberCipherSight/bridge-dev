#!/usr/bin/env node
// Explicit host rehearsal: temporary gateway + tracked, bounded systemd user jobs.
// No production configuration, credentials, sudo, leases, or permanent units.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';import{randomBytes}from'node:crypto';
import{Client}from'@modelcontextprotocol/sdk/client/index.js';import{StreamableHTTPClientTransport}from'@modelcontextprotocol/sdk/client/streamableHttp.js';
import{fixturePorts}from'./test-ports.mjs';
if(process.platform!=='linux'||!process.argv.includes('--host-user-jobs')||!process.env.XDG_RUNTIME_DIR)throw Error('Explicit --host-user-jobs on Linux with an available user bus required');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-qa-userjobs-')),work=path.join(root,'work');await fs.mkdir(work);
const [port,adminPort]=await fixturePorts(2),token=randomBytes(32).toString('hex'),admin=randomBytes(32).toString('hex');
const env={PATH:'/usr/bin:/bin',HOME:root,XDG_CONFIG_HOME:path.join(root,'config'),XDG_DATA_HOME:path.join(root,'data'),XDG_STATE_HOME:path.join(root,'state'),XDG_CACHE_HOME:path.join(root,'cache'),XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR,...(process.env.DBUS_SESSION_BUS_ADDRESS?{DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS}:{}),BRIDGEDEV_TEST_ROOT:root,DOTENV_CONFIG_PATH:path.join(root,'absent.env'),BRIDGEDEV_RUNTIME_MODE:'portable',WORKSPACE_PATH:work,BRIDGEDEV_STATE_DIR:path.join(root,'state'),LOCAL_CODER_JOB_ROOT:path.join(root,'jobs'),AUDIT_LOG_PATH:path.join(root,'audit.jsonl'),MCP_UPSTREAM_CONFIG:path.join(root,'providers.json'),CHECKPOINT_ENABLED:'false',PORT:String(port),ADMIN_PORT:String(adminPort),MCP_TOKEN:token,ADMIN_TOKEN:admin,CHATGPT_TOOL_PROFILE:'full'};
let child,client,transport,logs='';const jobs=[],report={kind:'real Linux user jobs; unprivileged, isolated gateway',started_at:new Date().toISOString(),jobs};
const sys=(...args)=>spawnSync('/usr/bin/systemctl',['--user',...args],{encoding:'utf8',timeout:5000});
async function connect(){client=new Client({name:'independent-host-job-qa',version:'1'},{capabilities:{}});transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers:{Authorization:'Bearer '+token}}});await client.connect(transport);await client.listTools();}
async function call(args){const r=await client.callTool({name:'system_job',arguments:args});assert.ok(r.structuredContent?.ok,JSON.stringify(r));return r.structuredContent.data;}
async function final(id){for(let i=0;i<80;i++){const s=await call({action:'status',id});if(s.status!=='running'&&s.status!=='unknown')return s;await new Promise(r=>setTimeout(r,100));}throw Error('Job completion timeout: '+id);}
try{
 child=spawn(process.execPath,['dist/index.js'],{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 let ready=false;for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready);await connect();
 for(const [command,max_runtime_seconds,expected]of[['/usr/bin/true',5,'completed'],['/usr/bin/false',5,'failed'],['sleep 15',1,'timed_out'],['sleep 15',30,'stopped']]){
  const job=await call({action:'start',command,max_runtime_seconds});jobs.push(job);
  if(expected==='stopped'){
   const properties=sys('show',job.unit,'-p','NoNewPrivileges','-p','KillMode');assert.equal(properties.status,0);assert.match(properties.stdout,/NoNewPrivileges=yes/);assert.match(properties.stdout,/KillMode=control-group/);
   await client.close();
   const exited=new Promise(r=>child.once('exit',r));await fetch(`http://127.0.0.1:${adminPort}/api/lifecycle/stop`,{method:'POST',headers:{Authorization:'Bearer '+admin,'Content-Type':'application/json'},body:'{}'});await exited;
   child=spawn(process.execPath,['dist/index.js'],{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
   let restarted=false;for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){restarted=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(restarted);report.gateway_restart_recovered=true;
   await connect();assert.equal((await call({action:'status',id:job.id})).id,job.id);
   await call({action:'stop',id:job.id,confirm_stop:true});
  }
  const result=await final(job.id);Object.assign(job,result);assert.equal(result.status,expected,JSON.stringify(result));assert.equal(result.exit_code,expected==='completed'?0:expected==='failed'?1:143);
  const output=await call({action:'logs',id:job.id});assert.equal(typeof output.tail,'string');
  sys('reset-failed',job.unit);const recovered=await call({action:'status',id:job.id});assert.equal(recovered.exit_code,result.exit_code);assert.equal(recovered.status,result.status);
 }
 report.passed=true;
} catch(error){report.passed=false;report.error=String(error);process.exitCode=1;
}finally{
 for(const job of jobs){sys('stop',job.unit);sys('reset-failed',job.unit);job.cleanup=sys('is-active',job.unit).status!==0;}
 await transport?.terminateSession().catch(()=>{});await client?.close().catch(()=>{});
 if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));await fetch(`http://127.0.0.1:${adminPort}/api/lifecycle/stop`,{method:'POST',headers:{Authorization:'Bearer '+admin,'Content-Type':'application/json'},body:'{}'}).catch(()=>child.kill());await done;}
 const audit=await fs.readFile(path.join(root,'state','audit.jsonl'),'utf8').catch(()=> '');report.audit_entries=audit.trim().split('\n').filter(Boolean).length;report.finished_at=new Date().toISOString();
 const output=process.argv.indexOf('--receipt');if(output>=0)await fs.writeFile(process.argv[output+1],JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(report,null,2));await fs.rm(root,{recursive:true,force:true});
}
