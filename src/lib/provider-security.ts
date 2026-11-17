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
/**
 * Permit only bounded, structurally simple ECMAScript patterns. JavaScript's
 * backtracking regex engine has no execution timeout: never compile arbitrary
 * provider expressions merely because they parse. In particular a quantified
 * group with inner repetition or alternatives can be super-linear.
 *
 * A pattern not covered by this conservative grammar stays unavailable; we
 * never delete the pattern keyword or turn off Ajv input/output validation.
 */
function checkPattern(value:unknown):void{
  if(typeof value!=="string")throw Error("PROVIDER_SCHEMA_PATTERN_INVALID");
  if(value.length>170)throw Error("PROVIDER_SCHEMA_PATTERN_COMPLEX");
  if(!value.startsWith("^"))throw Error("PROVIDER_SCHEMA_PATTERN_UNSAFE");
  const groups:{repeated:boolean;alternatives:boolean;hasQuantifier:boolean}[]=[];
  let lastGroup:{repeated:boolean;alternatives:boolean;hasQuantifier:boolean}|undefined;
  let lastAtom=""; // group, character-class, literal
  let consecutiveVariable=0;
  let variableQuantifiers=0;
  let alternatives=0;
  let groupCount=0;
  for(let i=0;i<value.length;i++){
    const ch=value[i];
    if(ch==="\\"){
      const escape=value[++i];
      if(!escape||/[1-9kKpP]/.test(escape))throw Error("PROVIDER_SCHEMA_PATTERN_UNSAFE");
      if(escape==="x"||escape==="u"){
        const digits=escape==="x"?2:4;
        if(!new RegExp("^[a-fA-F0-9]{"+digits+"}$").test(value.slice(i+1,i+1+digits)))
          throw Error("PROVIDER_SCHEMA_PATTERN_INVALID");
        i+=digits;
      }
      lastAtom="literal";
      continue;
    }
    if(ch==="["){
      let found=false;
      for(i++;i<value.length;i++){
        if(value[i]==="\\"){i++;continue;}
        if(value[i]==="]"){found=true;break;}
      }
      if(!found)throw Error("PROVIDER_SCHEMA_PATTERN_INVALID");
      lastAtom="class";
      continue;
    }
    if(ch==="("){
      if(++groupCount>4||groups.length>=3)throw Error("PROVIDER_SCHEMA_PATTERN_UNSAFE");
      if(value[i+1]==="?"){
        if(value[i+2]!==":")throw Error("PROVIDER_SCHEMA_PATTERN_UNSAFE");
        i+=2;
      }
      groups.push({repeated:false,alternatives:false,hasQuantifier:false});
      lastAtom="";
      consecutiveVariable=0;
      continue;
    }
    if(ch===")"){
      lastGroup=groups.pop();
      if(!lastGroup)throw Error("PROVIDER_SCHEMA_PATTERN_INVALID");
      if(lastGroup.repeated&&groups.length)groups[groups.length-1].repeated=true;
      if(lastGroup.hasQuantifier&&groups.length)groups[groups.length-1].hasQuantifier=true;
      lastAtom="group";
      continue;
    }
    if(ch==="|"){
      if(++alternatives>2)throw Error("PROVIDER_SCHEMA_PATTERN_UNSAFE");
      if(groups.length)groups[groups.length-1].alternatives=true;
      consecutiveVariable=0;
      lastAtom="";
      continue;
    }
    if(ch==="*"||ch==="+"||ch==="?"||ch==="{"){
      if(!lastAtom)throw Error("PROVIDER_SCHEMA_PATTERN_UNSAFE");
      if(ch==="{"){
        const match=/^\{\d{1,4}(?:,\d{0,4})?\}/.exec(value.slice(i));
        if(!match)throw Error("PROVIDER_SCHEMA_PATTERN_UNSAFE");
        i+=match[0].length-1;
        if(lastAtom==="group" && lastGroup && (lastGroup.hasQuantifier||lastGroup.alternatives))
          throw Error("PROVIDER_SCHEMA_PATTERN_UNSAFE");
        // Finite fixed-width repeats are deterministic in supported patterns.
        if(!match[0].includes(",") && Number(match[0].slice(1,-1))<=256){
          if(groups.length)groups[groups.length-1].hasQuantifier=true;
          lastAtom="";
          consecutiveVariable=0;
          continue;
        }
        const bounds=match[0].slice(1,-1).split(",");
        if(bounds.length!==2||bounds[1]===""||Number(bounds[1])>256||Number(bounds[0])>Number(bounds[1]))
          throw Error("PROVIDER_SCHEMA_PATTERN_UNSAFE");
      }
      if(lastAtom==="group" && lastGroup && (lastGroup.hasQuantifier||lastGroup.alternatives))
        throw Error("PROVIDER_SCHEMA_PATTERN_UNSAFE");
      // More than one variable-width repetition can have polynomial or
      // exponential backtracking even without nested groups (e.g. a*a*a*).
      if(++variableQuantifiers>1)throw Error("PROVIDER_SCHEMA_PATTERN_UNSAFE");
      if(++consecutiveVariable>1)throw Error("PROVIDER_SCHEMA_PATTERN_UNSAFE");
      if(groups.length){
        groups[groups.length-1].repeated=true;
        groups[groups.length-1].hasQuantifier=true;
      }
      lastAtom="";
      continue;
    }
    if(ch!=="^"&&ch!=="$"){
      lastAtom="literal";
      consecutiveVariable=0;
    }
  }
  if(groups.length)throw Error("PROVIDER_SCHEMA_PATTERN_INVALID");
  try{new RegExp(value,"u");}
  catch{throw Error("PROVIDER_SCHEMA_PATTERN_INVALID");}
}
function checkSchema(schema:unknown,depth=0,location="#"):void{
  if(depth>16)throw new Error("PROVIDER_SCHEMA_DEPTH_LIMIT");
  if(!schema||typeof schema!=="object")return;
  for(const [key,value]of Object.entries(schema)){
    const at=location+"/"+key.replace(/~/g,"~0").replace(/\//g,"~1");
    if(["$ref","$dynamicRef","patternProperties","__proto__","constructor","prototype"].includes(key))
      throw new Error("PROVIDER_SCHEMA_UNSUPPORTED: "+key);
    if(key==="pattern"){
      try{checkPattern(value);}catch(error){throw Error((error as Error).message+" @"+at);}
      continue;
    }
    // Under properties the keys are *field names*, not JSON Schema keywords.
    // A field literally named "pattern" must not trigger regex rejection.
    if(key==="properties" && value && typeof value==="object" && !Array.isArray(value)){
      for(const [field,definition] of Object.entries(value)){
        if(["__proto__","constructor","prototype"].includes(field))
          throw Error("PROVIDER_SCHEMA_UNSUPPORTED: "+field);
        checkSchema(definition,depth+2,at+"/"+field.replace(/~/g,"~0").replace(/\//g,"~1"));
      }
      continue;
    }
    checkSchema(value,depth+1,at);
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
export function inspectProviderTools(tools:Tool[]):{tools:Tool[];rejected:{name:string;reason:string;path?:string}[]}{
 if(tools.length>256)throw Error("PROVIDER_TOOL_COUNT_LIMIT");
 const names=new Set<string>(),accepted:Tool[]=[],rejected:{name:string;reason:string;path?:string}[]=[];
 for(const tool of tools){
  if(typeof tool.name!=="string"||!tool.name.length||tool.name.length>256||names.has(tool.name))throw Error("PROVIDER_INVALID_TOOL_NAME");
  names.add(tool.name);
  try{
   if(Buffer.byteLength(JSON.stringify(tool))>65536)throw Error("PROVIDER_METADATA_SIZE_LIMIT");
   const normalized={...tool,inputSchema:resolveLocalSchema(tool.inputSchema),...(tool.outputSchema?{outputSchema:resolveLocalSchema(tool.outputSchema)}:{})};
   validateToolMetadata([normalized]);accepted.push(normalized);
  }catch(error){
   // Never echo schema contents, expressions or descriptions into diagnostics.
   const message=String((error as Error).message);
   const reason=message.match(/^PROVIDER_[A-Z_]+(?:: [a-zA-Z$ _-]+)?/)?.[0]||"PROVIDER_SCHEMA_INVALID";
   const schemaPath=message.match(/ @(#(?:\/[A-Za-z0-9_~.-]+)+)$/)?.[1];
   rejected.push({name:cleanProviderText(tool.name,256),reason,...(schemaPath?{path:schemaPath}:{})});
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
