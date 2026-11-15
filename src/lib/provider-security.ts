import {createHash} from "node:crypto";
import type {Tool} from "@modelcontextprotocol/sdk/types.js";
import {CallToolResultSchema} from "@modelcontextprotocol/sdk/types.js";
import {AjvJsonSchemaValidator} from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import {z} from "zod";
export function cleanProviderText(text:string,max=2000):string{return text.replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,"").slice(0,max);}
export function proxyToolName(provider:string,tool:string):string{
  const raw=provider+"__"+tool;
  const safe=raw.replace(/[^a-zA-Z0-9_-]/g,"_");
  if(safe.length<=64 && raw===safe)return safe;
  return safe.slice(0,51)+"_"+createHash("sha256").update(raw).digest("hex").slice(0,12);
}
function checkSchema(schema:unknown,depth=0):void{
  if(depth>16)throw new Error("PROVIDER_SCHEMA_DEPTH_LIMIT");
  if(schema && typeof schema==="object")for(const [key,value]of Object.entries(schema)){
    // Refuse remote references and regex execution from untrusted schemas.
    if(["$ref","$dynamicRef","pattern","patternProperties","__proto__","constructor","prototype"].includes(key))throw new Error("PROVIDER_SCHEMA_UNSUPPORTED: "+key);
    checkSchema(value,depth+1);
  }
}
/** Expand finite document-local refs only. No network, dynamic refs or recursive expansion. */
export function resolveLocalSchema(schema:any):any{
 let budget=8192;
 function visit(node:any,root:any,ancestors:Set<any>,depth:number):any{
  if(--budget<0||depth>24)throw Error("PROVIDER_SCHEMA_EXPANSION_LIMIT");
  if(!node||typeof node!=="object")return node;
  if(Array.isArray(node))return node.map(x=>visit(x,root,ancestors,depth+1));
  if(node.$id!==undefined)root=node;
  let resolved:any={};
  if(node.$ref!==undefined){
   if(typeof node.$ref!=="string"||!/^#\/(?:\$defs|definitions)\//.test(node.$ref))throw Error("PROVIDER_SCHEMA_UNSUPPORTED: external or non-definition reference");
   let target=root;
   for(const key of node.$ref.slice(2).split("/").map((s:string)=>s.replace(/~1/g,"/").replace(/~0/g,"~"))){
    if(["__proto__","prototype","constructor"].includes(key)||!target||!Object.hasOwn(target,key))throw Error("PROVIDER_SCHEMA_REFERENCE_MISSING");
    target=target[key];
   }
   if(ancestors.has(target))throw Error("PROVIDER_SCHEMA_RECURSIVE_REFERENCE");
   resolved=visit(target,root,new Set([...ancestors,target]),depth+1);
  }
  const own:any={};
  for(const [key,value]of Object.entries(node)){
   if(["$defs","definitions","$id","$ref"].includes(key))continue;
   if(["__proto__","constructor","prototype"].includes(key))throw Error("PROVIDER_SCHEMA_UNSUPPORTED: "+key);
   own[key]=visit(value,root,ancestors,depth+1);
  }
  return node.$ref!==undefined&&Object.keys(own).length?{allOf:[resolved,own]}:node.$ref!==undefined?resolved:own;
 }
 const expanded=visit(schema,schema,new Set(),0);
 if(Buffer.byteLength(JSON.stringify(expanded))>65536)throw Error("PROVIDER_SCHEMA_EXPANSION_LIMIT");
 return expanded;
}
export function inspectProviderTools(tools:Tool[]):{tools:Tool[];rejected:{name:string;reason:string}[]}{
 if(tools.length>256)throw Error("PROVIDER_TOOL_COUNT_LIMIT");
 const names=new Set<string>(),accepted:Tool[]=[],rejected:{name:string;reason:string}[]=[];
 for(const tool of tools){
  if(typeof tool.name!=="string"||!tool.name.length||tool.name.length>256||names.has(tool.name))throw Error("PROVIDER_INVALID_TOOL_NAME");
  names.add(tool.name);
  try{
   if(Buffer.byteLength(JSON.stringify(tool))>65536)throw Error("PROVIDER_METADATA_SIZE_LIMIT");
   const normalized={...tool,inputSchema:resolveLocalSchema(tool.inputSchema),...(tool.outputSchema?{outputSchema:resolveLocalSchema(tool.outputSchema)}:{})};
   validateToolMetadata([normalized]);accepted.push(normalized);
  }catch(error){
   // Never echo schema contents, expressions or descriptions into diagnostics.
   const reason=String((error as Error).message).match(/^PROVIDER_[A-Z_]+(?:: [a-zA-Z$ _-]+)?/)?.[0]||"PROVIDER_SCHEMA_INVALID";
   rejected.push({name:cleanProviderText(tool.name,256),reason});
  }
 }
 return {tools:accepted,rejected};
}
export function validateToolMetadata(tools:Tool[]):Tool[]{
  if(tools.length>256)throw new Error("PROVIDER_TOOL_COUNT_LIMIT");
  const names=new Set<string>();
  for(const tool of tools){
    if(typeof tool.name!=="string" || !tool.name.length || tool.name.length>256 || names.has(tool.name))throw new Error("PROVIDER_INVALID_TOOL_NAME");
    names.add(tool.name);
    if(Buffer.byteLength(JSON.stringify(tool))>65536)throw new Error("PROVIDER_METADATA_SIZE_LIMIT");
    checkSchema(tool.inputSchema);if(tool.outputSchema)checkSchema(tool.outputSchema);
    new AjvJsonSchemaValidator().getValidator(tool.inputSchema);
    if(tool.outputSchema)new AjvJsonSchemaValidator().getValidator(tool.outputSchema);
  }
  return tools;
}
/** Keep the original JSON Schema, without a lossy JSON Schema -> Zod shape conversion. */
export function providerOutputSchema(schema:NonNullable<Tool["outputSchema"]>):z.ZodObject {
  checkSchema(schema);
  const validate=new AjvJsonSchemaValidator().getValidator(schema);
  return z.looseObject({}).superRefine((value,ctx)=>{
    const result=validate(value);
    if(!result.valid)ctx.addIssue({code:"custom",message:"PROVIDER_INVALID_OUTPUT: "+result.errorMessage});
  }).meta({...schema});
}
export function validateToolArguments(tool:Tool,args:unknown):void{
  if(Buffer.byteLength(JSON.stringify(args))>1048576)throw new Error("PROVIDER_ARGUMENT_SIZE_LIMIT");
  const result=new AjvJsonSchemaValidator().getValidator(tool.inputSchema)(args);
  if(!result.valid)throw new Error("PROVIDER_INVALID_ARGUMENTS: "+result.errorMessage);
}
export function sanitizeProviderResult(result:unknown,origin:string,tool?:Tool):unknown{
  if(Buffer.byteLength(JSON.stringify(result))>4*1024*1024)throw new Error("PROVIDER_RESPONSE_SIZE_LIMIT");
  const parsed=CallToolResultSchema.parse(result);
  if(tool?.outputSchema && (!parsed.isError || parsed.structuredContent!==undefined)){
    if(parsed.structuredContent===undefined)throw new Error("PROVIDER_INVALID_OUTPUT: missing structuredContent");
    const checked=new AjvJsonSchemaValidator().getValidator(tool.outputSchema)(parsed.structuredContent);
    if(!checked.valid)throw new Error("PROVIDER_INVALID_OUTPUT: "+checked.errorMessage);
  }
  for(const item of parsed.content)if(item.type==="text")item.text=cleanProviderText(item.text,1048576);
  parsed.content.unshift({type:"text",text:"[Untrusted result from provider: "+origin+"]"});
  return parsed;
}
