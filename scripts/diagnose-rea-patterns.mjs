import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {inspectProviderTools} from "../dist/lib/provider-security.js";

const entry=process.argv[2];
if(!entry)throw Error("Provide reviewed REA path");
const temp=await fs.mkdtemp(path.join(os.tmpdir(),"rea-schema-audit-"));
const env={PATH:"/usr/bin:/bin",HOME:temp,XDG_CONFIG_HOME:path.join(temp,"cfg"),
 XDG_DATA_HOME:path.join(temp,"data"),XDG_STATE_HOME:path.join(temp,"state"),
 XDG_CACHE_HOME:path.join(temp,"cache"),REA_MCP_OUTPUT_SCHEMA_PROFILE:"compact"};
const transport=new StdioClientTransport({command:process.execPath,args:[entry,"mcp"],env,stderr:"pipe"});
const client=new Client({name:"rea-schema-audit",version:"1.0.0"},{capabilities:{}});
try{
 await client.connect(transport);
 const tools=(await client.listTools()).tools;
 const before=inspectProviderTools(tools);
 const patterns=[];
 function walk(value,part,name,location){
   if(!value||typeof value!=="object")return;
   for(const [key,entry] of Object.entries(value)){
     const schemaPath=location+"/"+key;
     if(key==="pattern" && typeof entry==="string"){
       let unicode="valid",plain="valid";
       try{new RegExp(entry,"u");}catch(e){unicode=String(e.message).slice(0,160);}
       try{new RegExp(entry);}catch(e){plain=String(e.message).slice(0,160);}
       patterns.push({name,part,path:schemaPath,pattern:entry,unicode,plain});
     }else walk(entry,part,name,schemaPath);
   }
 }
 for(const tool of tools){walk(tool.inputSchema,"input",tool.name,"");walk(tool.outputSchema,"output",tool.name,"");}
 const distinct=[...new Set(patterns.map(row=>row.pattern))];
 const rows=distinct.map(pattern=>({pattern,count:patterns.filter(row=>row.pattern===pattern).length,unicode:patterns.find(row=>row.pattern===pattern).unicode,plain:patterns.find(row=>row.pattern===pattern).plain}));
 const special=new Set(before.rejected.map(x=>x.name));
 const fromSchemas=new Set(patterns.map(x=>x.name));
 const metadataPatternPaths=[];
 function listPatternKeys(node,name,location){
   if(!node||typeof node!=="object")return;
   for(const [key,value] of Object.entries(node)){
     if(key==="pattern")metadataPatternPaths.push({name,path:location+"/"+key,kind:typeof value});
     listPatternKeys(value,name,location+"/"+key);
   }
 }
 for(const tool of tools)if(special.has(tool.name)&&!fromSchemas.has(tool.name))listPatternKeys(tool,tool.name,"");
 console.log(JSON.stringify({advertised:tools.length,metadataPatternPaths,rejectedByReason:Object.entries(Object.groupBy(before.rejected,x=>x.reason)).map(([reason,items])=>({reason,count:items.length,names:items.map(i=>i.name)})),toolsWithPattern:new Set(patterns.map(p=>p.name)).size,totalPatterns:patterns.length,input:patterns.filter(x=>x.part==="input").length,output:patterns.filter(x=>x.part==="output").length,distinct:rows.length,patterns:rows,tools:patterns.map(({name,part,path,pattern})=>({name,part,path,pattern}))},null,2));
}finally{await client.close().catch(()=>{});await transport.close().catch(()=>{});await fs.rm(temp,{recursive:true,force:true});}
