// Optional real-provider acceptance: installed REA required, no package fetching.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {fixturePorts} from "./test-ports.mjs";
import {inspectProviderTools,proxyToolName} from "../dist/lib/provider-security.js";

const entry=path.resolve(process.argv[2]||"");
if (!process.argv[2] || !(await fs.stat(entry).catch(()=>null))?.isFile())
  throw Error("Specify the absolute, reviewed REA 6.9.0 launcher. No package is installed.");
const temp=await fs.mkdtemp(path.join(os.tmpdir(),"bridge-rea-full-"));
const [port,adminPort]=await fixturePorts(2);
const env={PATH:path.dirname(process.execPath)+":/usr/bin:/bin",HOME:temp,
  XDG_CONFIG_HOME:path.join(temp,"config"),XDG_DATA_HOME:path.join(temp,"data"),
  XDG_STATE_HOME:path.join(temp,"state"),XDG_CACHE_HOME:path.join(temp,"cache"),
  REA_MCP_OUTPUT_SCHEMA_PROFILE:"compact"};
let upstream, gateway, client, fixtureToken;
let gatewayLogs="";
async function connectProvider() {
  upstream=new Client({name:"full-rea-inventory",version:"1.0.0"},{capabilities:{}});
  const transport=new StdioClientTransport({command:process.execPath,args:[entry,"mcp"],env,stderr:"pipe"});
  await upstream.connect(transport);
  return (await upstream.listTools()).tools;
}
async function startGateway() {
  gateway=spawn(process.execPath,["dist/index.js"],{
    cwd:process.cwd(),env:{...process.env,...env,
      BRIDGEDEV_RUNTIME_MODE:"portable",POLICYGATE_POLICY_FILE:"",
      WORKSPACE_PATH:path.join(temp,"workspace"),
      BRIDGEDEV_STATE_DIR:path.join(temp,"state","bridge-dev"),
      MCP_UPSTREAM_CONFIG:path.join(temp,"upstream.json"),
      MCP_TOKEN:(fixtureToken=randomBytes(32).toString("hex")),
      ADMIN_TOKEN:randomBytes(32).toString("hex"),
      PORT:String(port),ADMIN_PORT:String(adminPort),
      CHATGPT_TOOL_PROFILE:"slim"},
    stdio:["ignore","pipe","pipe"]
  });
  for(const pipe of [gateway.stdout,gateway.stderr])
    pipe.on("data",bytes=>{gatewayLogs=(gatewayLogs+bytes.toString()).slice(-8192);});
  for(let n=0;n<120;n++){
    if(gateway.exitCode!==null)throw Error("Gateway exited: "+gatewayLogs);
    try{if((await fetch("http://127.0.0.1:"+port+"/healthz")).ok)break;}catch{}
    if(n===119)throw Error("Gateway did not become healthy: "+gatewayLogs);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
}
try {
  const advertised=await connectProvider();
  const inspected=inspectProviderTools(advertised);
  assert.ok(inspected.tools.length>=100,"REA version unexpectedly changed or inventory incomplete");
  const names=inspected.tools.map(t=>t.name);
  if(process.argv.includes('--diagnose-patterns')){
    const failedNames=new Set(inspected.rejected.map(t=>t.name));
    const patterns=new Map();
    const walk=(value)=>{
      if(!value || typeof value!=='object')return;
      for(const [key,item] of Object.entries(value)){
        if(key==='pattern' && typeof item==='string'){
          patterns.set(item,(patterns.get(item)||0)+1);
        }else walk(item);
      }
    };
    for(const tool of advertised)if(failedNames.has(tool.name))walk(tool);
    console.log('Rejected schema patterns:',JSON.stringify([...patterns].map(([pattern,count])=>({pattern,count})).slice(0,40),null,2));
  }
  await upstream.close();upstream=null;
  await fs.mkdir(path.join(temp,"workspace"),{recursive:true});
  const permissions=Object.fromEntries(names.map(name=>
    [name,["search_guidance","read_guidance_section","guided_workflows"].includes(name)?"R":"X"]));
  await fs.writeFile(path.join(temp,"upstream.json"),JSON.stringify({version:1,servers:[{
    id:"rea",name:"Isolated reviewed REA",transport:"stdio",enabled:true,reviewed:true,
    command:process.execPath,args:[entry,"mcp"],env,expose:"allowlist",tools:names,
    tool_permissions:permissions,idle_timeout_sec:60
  }]}));
  await startGateway();
  // Use a real, independent MCP client with a synthetic fixture credential.
  const authToken=fixtureToken;
  client=new Client({name:"REA full-tool acceptance",version:"1.0.0"},{capabilities:{}});
  await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:"+port+"/mcp"),
    {requestInit:{headers:{Authorization:"Bearer "+authToken}}}));
  let list;
  for(let n=0;n<50;n++){
    list=(await client.listTools()).tools;
    const shown=new Set(list.map(x=>x.name));
    if(names.every(name=>shown.has(proxyToolName("rea",name))))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const shown=new Set(list.map(x=>x.name));
  const missing=names.filter(name=>!shown.has(proxyToolName("rea",name)));
  assert.deepEqual(missing,[],"Every schema-valid REA tool must be proxied");
  const guide=await client.callTool({name:"rea__guided_workflows",arguments:{action:"list"}});
  assert.ok(!guide.isError,"Approved guidance invocation failed");
  const restricted=names.find(name=>!["search_guidance","read_guidance_section","guided_workflows"].includes(name));
  assert.ok(restricted);
  const denied=await client.callTool({name:proxyToolName("rea",restricted),arguments:{}});
  assert.equal(denied.isError,true,"Unapproved X tool must remain approval-gated");
  console.log(JSON.stringify({result:"PASS",advertised:advertised.length,compatible:names.length,
    rejected:inspected.rejected.length,proxied:names.length,
    gatewayTools:list.length,guideInvoked:true,unapprovedXDenied:true,
    rejectedReasons:Object.fromEntries([...new Set(inspected.rejected.map(x=>x.reason))].map(reason=>
      [reason,inspected.rejected.filter(x=>x.reason===reason).length]))},null,2));
}finally{
  await client?.close().catch(()=>{});
  await upstream?.close().catch(()=>{});
  if(gateway){
    if(gateway.exitCode===null){
      gateway.kill("SIGTERM");
      await Promise.race([new Promise(resolve=>gateway.once("exit",resolve)),
        new Promise(resolve=>setTimeout(resolve,2000))]);
      if(gateway.exitCode===null)gateway.kill("SIGKILL");
    }
  }
  await fs.rm(temp,{recursive:true,force:true});
}
