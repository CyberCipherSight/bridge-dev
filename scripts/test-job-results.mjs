import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import{mock}from'node:test';
if(!process.env.BRIDGEDEV_TEST_ROOT)throw Error('Use isolated-tests.mjs');
const root=path.join(process.env.BRIDGEDEV_TEST_ROOT,'jobs-regression');process.env.LOCAL_CODER_JOB_ROOT=root;
let launchOK=false,properties='',showOK=false;let launchArgs;
mock.module('../dist/lib/system-inspect.js',{namedExports:{runReadOnly:async(cmd,args)=>{
 if(cmd==='systemd-run'){launchArgs=args;return {ok:launchOK,stdout:'',stderr:'fixture unconfirmed launch'};}
 return {ok:showOK,stdout:properties,stderr:''};
}}});
const {startJob,statusJob}=await import('../dist/lib/system-jobs.js');
let id;
try{await startJob('true',process.env.WORKSPACE_PATH,1);assert.fail('Unconfirmed launch reported success');}catch(error){assert.match(error.message,/inspect system_job status\/logs before retry/);id=error.message.match(/for ([a-f0-9]{16})/)[1];}
const metadataFile=path.join(root,id+'.json'),metadata=JSON.parse(await fs.readFile(metadataFile,'utf8'));assert.equal(metadata.id,id);
assert.ok(launchArgs.includes('--property=NoNewPrivileges=yes'));assert.ok(launchArgs.includes('-i'));assert.ok(!launchArgs.includes('-lc'));
properties='ActiveState=inactive\nResult=success\nExecMainStatus=0\nExecMainCode=0\nMainPID=0';
assert.equal((await statusJob(id)).status,'unknown');assert.equal((await statusJob(id)).exit_code,null,'Never report unconfirmed launch as exit 0');
await fs.writeFile(metadataFile,JSON.stringify({...metadata,exit_file:path.join(root,'outside.exit')}));await assert.rejects(statusJob(id),/metadata validation failed/);await fs.writeFile(metadataFile,JSON.stringify(metadata));
showOK=true;properties='ActiveState=failed\nResult=exit-code\nExecMainStatus=1\nExecMainCode=1\nMainPID=0';const failed=await statusJob(id);assert.equal(failed.exit_code,1);assert.equal(failed.status,'failed');
showOK=false;properties='';assert.deepEqual(await statusJob(id),JSON.parse(JSON.stringify(failed)));
launchOK=true;const timed=await startJob('sleep 1',process.env.WORKSPACE_PATH,1);showOK=true;properties='ActiveState=failed\nResult=timeout\nExecMainStatus=15\nExecMainCode=2\nMainPID=0';
const result=await statusJob(timed.id);assert.equal(result.status,'timed_out');assert.equal(result.exit_code,124,'Absent wrapper receipt uses conventional timeout code');
showOK=false;properties='';await Promise.all(Array.from({length:4},()=>statusJob(timed.id)));assert.equal((await statusJob(timed.id)).status,'timed_out');
assert.ok(!(await fs.readdir(root)).some(file=>/result\.json\./.test(file)));
console.log('Jobs: unconfirmed launch retained, no false success, exit-path validation, durable failure/timeout and concurrent reads PASS');
