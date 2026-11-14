#!/usr/bin/env node
// Explicit Linux user-unit rehearsal. Synthetic authority and state only.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import{spawnSync}from'node:child_process';import{randomBytes}from'node:crypto';
import{Client}from'@modelcontextprotocol/sdk/client/index.js';import{StreamableHTTPClientTransport}from'@modelcontextprotocol/sdk/client/streamableHttp.js';import{fixturePorts}from'./test-ports.mjs';
if(process.platform!=='linux'||!process.argv.includes('--host-user-service'))throw Error('Explicit Linux --host-user-service required');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-qa-service-')),work=path.join(root,'work');await fs.mkdir(work);
const unit='bridge-dev-qa-'+randomBytes(6).toString('hex')+'.service',[port,adminPort]=await fixturePorts(2),token=randomBytes(32).toString('hex'),admin=randomBytes(32).toString('hex');
const env={PATH:'/usr/bin:/bin',HOME:root,XDG_CONFIG_HOME:path.join(root,'config'),XDG_DATA_HOME:path.join(root,'data'),XDG_STATE_HOME:path.join(root,'state'),XDG_CACHE_HOME:path.join(root,'cache'),BRIDGEDEV_TEST_ROOT:root,DOTENV_CONFIG_PATH:path.join(root,'absent.env'),BRIDGEDEV_RUNTIME_MODE:'portable',WORKSPACE_PATH:work,BRIDGEDEV_STATE_DIR:path.join(root,'state'),MCP_SHELL_STATE_DIR:path.join(root,'shell'),AUDIT_LOG_PATH:path.join(root,'activity.jsonl'),MCP_UPSTREAM_CONFIG:path.join(root,'providers.json'),CHECKPOINT_ENABLED:'false',PORT:String(port),ADMIN_PORT:String(adminPort),MCP_TOKEN:token,ADMIN_TOKEN:admin};
const file=path.join(root,'fixture.env');await fs.writeFile(file,Object.entries(env).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n',{mode:0o600});
const sys=(...args)=>spawnSync('/usr/bin/systemctl',['--user',...args],{encoding:'utf8',timeout:10000});
const report={unit,started_at:new Date().toISOString(),runtime_seconds:60};let client;
async function health(){for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Isolated service health timeout');}
try{
 const launch=spawnSync('/usr/bin/systemd-run',['--user','--unit='+unit,'--property=Type=exec','--property=NoNewPrivileges=yes','--property=UMask=0077','--property=KillMode=control-group','--property=Restart=on-failure','--property=RestartSec=100ms','--property=RuntimeMaxSec=60s','--property=EnvironmentFile='+file,'--working-directory='+process.cwd(),process.execPath,path.resolve('dist/cli.js'),'serve'],{encoding:'utf8',timeout:10000});assert.equal(launch.status,0,launch.stderr);await health();
 const first=Number(sys('show',unit,'-p','MainPID','--value').stdout.trim());assert.ok(first>0);report.initial_pid=first;
 client=new Client({name:'independent-user-service-qa',version:'1'},{capabilities:{}});await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers:{Authorization:'Bearer '+token}}}));report.tools=(await client.listTools()).tools.length;
 const started=await client.callTool({name:'start_process',arguments:{command:'sleep 15',max_runtime_seconds:20}});assert.ok(started.structuredContent?.ok);report.owned_child_pid=started.structuredContent.data.pid;await client.close();client=null;
 assert.equal(sys('kill','--kill-whom=main','--signal=SIGKILL',unit).status,0);await new Promise(r=>setTimeout(r,400));await health();
 const second=Number(sys('show',unit,'-p','MainPID','--value').stdout.trim());assert.ok(second>0&&second!==first);report.recovered_pid=second;assert.throws(()=>process.kill(report.owned_child_pid,0),/ESRCH/);
 assert.equal((await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);assert.equal((await fetch(`http://127.0.0.1:${adminPort}/health`)).status,401);
 assert.equal(sys('restart',unit).status,0);await health();report.restarted_pid=Number(sys('show',unit,'-p','MainPID','--value').stdout.trim());assert.notEqual(report.restarted_pid,second);
 report.properties=sys('show',unit,'-p','User','-p','NoNewPrivileges','-p','UMask','-p','KillMode','-p','UnitFileState').stdout.trim();assert.match(report.properties,/NoNewPrivileges=yes/);assert.match(report.properties,/UMask=0077/);
 const journal=spawnSync('/usr/bin/journalctl',['--user','-u',unit,'--no-pager','-n','80'],{encoding:'utf8',timeout:5000});assert.equal(journal.status,0);assert.ok(!journal.stdout.includes(token)&&!journal.stdout.includes(admin));report.journal_available=true;
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error);process.exitCode=1;
}finally{
 await client?.close().catch(()=>{});sys('stop',unit);sys('reset-failed',unit);report.cleaned=sys('is-active',unit).status!==0;
 for(const p of[port,adminPort]){await assert.rejects(fetch(`http://127.0.0.1:${p}/health`));}
 report.finished_at=new Date().toISOString();const index=process.argv.indexOf('--receipt');if(index>=0)await fs.writeFile(process.argv[index+1],JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report,null,2));await fs.rm(root,{recursive:true,force:true});
}
