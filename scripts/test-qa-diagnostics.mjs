import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import{spawn,spawnSync}from'node:child_process';import{randomBytes,generateKeyPairSync,sign}from'node:crypto';
import{Client}from'@modelcontextprotocol/sdk/client/index.js';import{StreamableHTTPClientTransport}from'@modelcontextprotocol/sdk/client/streamableHttp.js';import{fixturePorts}from'./test-ports.mjs';
if(!process.env.BRIDGEDEV_TEST_ROOT)throw Error('Use isolated-tests.mjs');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-qa-diagnostics-')),work=path.join(root,'work');await fs.mkdir(work);
const[port,adminPort]=await fixturePorts(2),token=randomBytes(32).toString('hex'),admin=randomBytes(32).toString('hex');
const bin=path.join(root,'bin'),actions=path.join(root,'tailscale-actions');await fs.mkdir(bin);
await fs.writeFile(path.join(bin,'git'),'#!/bin/sh\ntouch "'+path.join(root,'shadow-executed')+'"\n',{mode:0o700});
await fs.writeFile(path.join(bin,'tailscale'),'#!/bin/sh\nprintf "%s\\n" "$*" >> "'+actions+'"\nprintf "{}\\n"\n',{mode:0o700});
const keys=generateKeyPairSync('ed25519'),publicKey=path.join(root,'operator.pub'),approvalDir=path.join(root,'approvals');await fs.writeFile(publicKey,keys.publicKey.export({type:'spki',format:'pem'}));
const {approvalPayload}=await import('../dist/lib/policy-approvals.js');
const {acceptPortableGateway}=await import('./deploy-acceptance/portable-client.mjs');
const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,POLICYGATE_APPROVAL_PUBLIC_KEY:publicKey,POLICYGATE_APPROVAL_DIR:approvalDir,SHELL_TIMEOUT:'1',BRIDGEDEV_RUNTIME_MODE:'portable',POLICYGATE_POLICY_FILE:'',WORKSPACE_PATH:work,BRIDGEDEV_STATE_DIR:path.join(root,'state'),PORT:String(port),ADMIN_PORT:String(adminPort),MCP_TOKEN:token,ADMIN_TOKEN:admin,MCP_UPSTREAM_CONFIG:path.join(root,'providers.json')};
let child,client,transport,logs='';const failures=[];
async function approved(name,args){
 const denied=await client.callTool({name,arguments:args});assert.match(JSON.stringify(denied),/POLICYGATE_APPROVAL_REQUIRED/);
 const requests=await fs.readdir(approvalDir);let request;
 for(const file of requests.filter(x=>x.endsWith('.request.json'))){const value=JSON.parse(await fs.readFile(path.join(approvalDir,file),'utf8'));if(value.tool===name&&value.args.command===args.command)request=value;}
 assert.ok(request);const signature=sign(null,Buffer.from(approvalPayload(request)),keys.privateKey).toString('base64');await fs.writeFile(path.join(approvalDir,request.id+'.approved.json'),JSON.stringify({...request,signature}),{mode:0o600});
 return client.callTool({name,arguments:args});
}
try{
 child=spawn(process.execPath,['dist/cli.js','serve'],{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 let ready=false;for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(`http://127.0.0.1:${port}/healthz`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready);
 client=new Client({name:'independent-qa-diagnostics',version:'1'},{capabilities:{}});transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers:{Authorization:'Bearer '+token}}});await client.connect(transport);await client.listTools();await fs.rm(path.join(root,"shadow-executed"),{force:true});
 for(const command of ['git --version','node --version','id -u','echo bridge-dev-qa']){const r=await client.callTool({name:'run_command',arguments:{command}});if(!r.structuredContent?.ok)failures.push({command,error:JSON.stringify(r)});}
 await assert.rejects(fs.stat(path.join(root,'shadow-executed')), {code:'ENOENT'});
 if(failures.length)throw Error('Ordinary diagnostics rejected: '+JSON.stringify(failures));
 const runtimeVersion=await client.callTool({name:'run_command',arguments:{command:'node --version'}});assert.equal(runtimeVersion.structuredContent.data.stdout,process.version);
 for(const [name,args]of[['start_process',{command:'node --version'}],['system_job',{action:'start',command:'node --version'}]]){const denied=await client.callTool({name,arguments:args});assert.match(JSON.stringify(denied),/POLICYGATE_APPROVAL_REQUIRED/);}
 const bg=await client.callTool({name:'start_process',arguments:{command:'sleep 0.2',max_runtime_seconds:2}});assert.ok(bg.structuredContent?.ok,JSON.stringify(bg));const id=bg.structuredContent.data.id;
 await new Promise(r=>setTimeout(r,350));const out=await client.callTool({name:'process_output',arguments:{id}});assert.equal(out.structuredContent.data.exit_code,0,JSON.stringify(out));
 const timed=await client.callTool({name:'start_process',arguments:{command:'sleep 10',max_runtime_seconds:1}});assert.ok(timed.structuredContent?.ok);
 await new Promise(r=>setTimeout(r,1200));const timedOut=await client.callTool({name:'process_output',arguments:{id:timed.structuredContent.data.id}});assert.equal(timedOut.structuredContent.data.timed_out,true);assert.equal(timedOut.structuredContent.data.running,false);
 const stopped=await client.callTool({name:'start_process',arguments:{command:'sleep 15'}});assert.ok(stopped.structuredContent?.ok);
 const killed=await client.callTool({name:'stop_process',arguments:{id:stopped.structuredContent.data.id,force:true}});assert.ok(killed.structuredContent?.ok);
 const nonzero=await client.callTool({name:'start_process',arguments:{command:'false'}});await new Promise(r=>setTimeout(r,100));assert.equal((await client.callTool({name:'process_output',arguments:{id:nonzero.structuredContent.data.id}})).structuredContent.data.exit_code,1);
 if(process.platform==='linux'){
  const tree=await approved('start_process',{command:"/usr/bin/bash --noprofile --norc -c 'sleep 15 & wait'",max_runtime_seconds:5});assert.ok(tree.structuredContent?.ok,JSON.stringify(tree));
  await new Promise(r=>setTimeout(r,100));const parent=tree.structuredContent.data.pid,descendants=(await fs.readFile(`/proc/${parent}/task/${parent}/children`,'utf8')).trim().split(/\s+/).filter(Boolean).map(Number);assert.ok(descendants.length);
  await client.callTool({name:'stop_process',arguments:{id:tree.structuredContent.data.id,force:true}});await new Promise(r=>setTimeout(r,150));
  for(const pid of [parent,...descendants]){try{const stat=await fs.readFile(`/proc/${pid}/stat`,'utf8');assert.equal(stat.slice(stat.lastIndexOf(')')+2).split(' ')[0],'Z','Owned child remains running');}catch(error){if(error.code!=='ENOENT')throw error;}}
  const timeout=await approved('run_command',{command:"/usr/bin/bash --noprofile --norc -c 'echo $$ > timeout.pid; sleep 15 & wait'"});assert.equal(timeout.isError,true,JSON.stringify(timeout));assert.match(JSON.stringify(timeout),/timed out/);
  const timedPid=Number(await fs.readFile(path.join(work,'timeout.pid'),'utf8'));assert.throws(()=>process.kill(timedPid,0),/ESRCH/);
 }
 const pending=await client.callTool({name:'start_process',arguments:{command:'sleep 30'}});assert.ok(pending.structuredContent?.ok);const shutdownPid=pending.structuredContent.data.pid;
 const health=await (await fetch(`http://127.0.0.1:${adminPort}/health`,{headers:{Authorization:'Bearer '+admin}})).json();assert.ok(!('mcp_token' in health));
 assert.equal((await fetch(`http://127.0.0.1:${adminPort}/api/access`)).status,401);
 const access=await fetch(`http://127.0.0.1:${adminPort}/api/access`,{headers:{Authorization:'Bearer '+admin}});assert.equal(access.headers.get('cache-control'),'no-store');assert.equal((await access.json()).mcp_token,token);
 const inventory=JSON.parse(await fs.readFile('profiles/native-tool-counts.json','utf8')).tools.slim;
 const acceptance=await acceptPortableGateway({url:`http://127.0.0.1:${port}/mcp`,adminUrl:`http://127.0.0.1:${adminPort}`,mcpToken:token,adminToken:admin,workspace:work,inventory});assert.ok(acceptance.ok);
 // Literal direct argv cannot execute shell expansions, wrappers or a PATH shadow.
 for(const command of ['echo $(id -u)','echo x > outside.txt','env NODE_OPTIONS=--eval=1 node --version','node -e "process.exit(0)"','sh -c "echo injected"','sleep 1; id -u']){
  const r=await client.callTool({name:'run_command',arguments:{command}});assert.ok(r.isError||r.structuredContent?.ok===false,'Unsafe syntax executed: '+command);
 }
 await client.close();client=null;
 const stoppedCli=spawnSync(process.execPath,['dist/cli.js','stop'],{env,encoding:'utf8',timeout:5000});assert.equal(stoppedCli.status,0,stoppedCli.stderr);
 await new Promise(r=>setTimeout(r,100));assert.throws(()=>process.kill(shutdownPid,0),/ESRCH|No such process/);
 // Admin health can inspect status; start and stop must never mutate Funnel.
 const invoked=await fs.readFile(actions,'utf8').catch(()=> '');assert.ok(invoked.split('\n').filter(Boolean).every(line=>line==='funnel status --json'),invoked);
 const oldExit=new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await oldExit;
 child=spawn(process.execPath,['dist/cli.js','serve','--funnel'],{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 let exposed=false;for(let i=0;i<120;i++){if(child.exitCode!==null)throw Error(logs);const calls=await fs.readFile(actions,'utf8').catch(()=> '');if(calls.includes('funnel --bg '+port)){exposed=true;break;}await new Promise(r=>setTimeout(r,50));}assert.ok(exposed,'Explicit Funnel was not requested');
 const beforeConflict=await fs.readFile(actions,'utf8');const conflict=spawnSync(process.execPath,['dist/cli.js','serve','--funnel'],{env,encoding:'utf8',timeout:5000});assert.equal(conflict.status,1);assert.equal(await fs.readFile(actions,'utf8'),beforeConflict,'Failed socket bind changed Funnel');
 assert.equal(spawnSync(process.execPath,['dist/cli.js','stop'],{env,encoding:'utf8',timeout:5000}).status,0);
 console.log('Ordinary diagnostics: real portable MCP client, exact argv, bounded process and shell/wrapper denials PASS');
}finally{await transport?.terminateSession().catch(()=>{});await client?.close().catch(()=>{});if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));await fetch(`http://127.0.0.1:${adminPort}/api/lifecycle/stop`,{method:'POST',headers:{Authorization:'Bearer '+admin,'Content-Type':'application/json'},body:'{}'}).catch(()=>child.kill());await exit;}await fs.rm(root,{recursive:true,force:true});}
