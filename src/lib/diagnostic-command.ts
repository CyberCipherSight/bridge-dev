import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
export interface DiagnosticCommand {executable:string;args:string[];identity:string;runtimeVersion?:string;}
const cache=new Map<string,Omit<DiagnosticCommand,"args">>();
function identity(p:string):string{const s=fs.statSync(p);if(!s.isFile()||s.mode&0o022)throw Error("DIAGNOSTIC_EXECUTABLE_UNTRUSTED");return [s.dev,s.ino,s.size,s.mtimeMs,s.uid,s.mode].join(":");}
function trusted(name:string):Omit<DiagnosticCommand,"args">|undefined{
 if(cache.has(name))return cache.get(name);
 const candidates=process.platform==="win32"?[]:["/usr/bin/"+name,"/bin/"+name];
 for(const candidate of candidates){try{
  const executable=fs.realpathSync.native(candidate),s=fs.statSync(executable);
  if(s.uid!==0||s.mode&0o022)continue;
  const value={executable,identity:identity(executable)};cache.set(name,value);return value;
 }catch{}}
 return undefined;
}
// Deliberately a small argv grammar, not shell analysis. Unsupported syntax
// stays on the existing signed-review path. No expansion ever reaches exec.
export function diagnosticCommand(command:string):DiagnosticCommand|undefined{
 if(/[\n\r\x00$`|&;<>*?{}]/.test(command))return;
 const words:string[]=[];let word="",quote="",started=false;
 for(const c of command.trim()){
  if(c==="\\")return;
  if(quote){if(c===quote)quote="";else word+=c;started=true;continue;}
  if(c==="'"||c==='"'){quote=c;started=true;continue;}
  if(/\s/.test(c)){if(started){words.push(word);word="";started=false;}}else{word+=c;started=true;}
 }
 if(quote)return;if(started)words.push(word);if(!words.length||words.length>64)return;
 const name=path.basename(words[0]),args=words.slice(1);
 const allowed=(["pwd","id","whoami","true","false"].includes(name)&&args.length===0)||
  (name==="id"&&args.length===1&&["-u","-g"].includes(args[0]))||
  (["git","node"].includes(name)&&args.length===1&&["--version","-v"].includes(args[0])&&(name!=="git"||args[0]==="--version"))||
  (name==="echo"&&args.every(x=>!x.startsWith("-")))||
  (name==="sleep"&&args.length===1&&/^\d+(?:\.\d+)?$/.test(args[0])&&Number(args[0])>0&&Number(args[0])<=120);
 if(!allowed)return;
 // The runtime's version is already known. Never re-execute a writable Node
 // distribution (for example a CI toolcache) just to discover that value.
 if(name==="node"&&words[0]===name)return {executable:process.execPath,args,identity:"runtime-version",runtimeVersion:process.version};
 const binary=trusted(name);if(!binary)return;
 if(words[0]!==name){try{if(!path.isAbsolute(words[0])||fs.realpathSync.native(words[0])!==binary.executable)return;}catch{return;}}
 verifyDiagnostic({...binary,args});return {...binary,args};
}
export function verifyDiagnostic(plan:DiagnosticCommand):void{
 if(plan.runtimeVersion){if(plan.runtimeVersion!==process.version||plan.executable!==process.execPath)throw Error("DIAGNOSTIC_RUNTIME_CHANGED");return;}
 if(identity(plan.executable)!==plan.identity)throw Error("DIAGNOSTIC_EXECUTABLE_CHANGED: restart and review the runtime; no shell fallback");
}
export function diagnosticEnvironment():NodeJS.ProcessEnv{return {PATH:process.platform==="win32"?process.env.SystemRoot+"\\System32":"/usr/bin:/bin",...(process.platform==="win32"?{SystemRoot:process.env.SystemRoot}:{}),LANG:"C.UTF-8",GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:process.platform==="win32"?"NUL":"/dev/null",GIT_OPTIONAL_LOCKS:"0",GIT_TERMINAL_PROMPT:"0"};}
export function executeDiagnostic(plan:DiagnosticCommand,cwd:string,timeoutMs:number):Promise<{stdout:string;stderr:string;exit_code:number;timed_out:boolean;cwd:string}>{
 verifyDiagnostic(plan);if(plan.runtimeVersion)return Promise.resolve({stdout:plan.runtimeVersion,stderr:"",exit_code:0,timed_out:false,cwd});return new Promise((resolve,reject)=>{
  const child=spawn(plan.executable,plan.args,{cwd,env:diagnosticEnvironment(),shell:false,windowsHide:true});let stdout="",stderr="",timed_out=false;
  const timer=setTimeout(()=>{timed_out=true;child.kill("SIGKILL");},timeoutMs);
  child.stdout.on("data",b=>stdout=(stdout+b).slice(-1048576));child.stderr.on("data",b=>stderr=(stderr+b).slice(-1048576));child.once("error",e=>{clearTimeout(timer);reject(e);});child.once("close",code=>{clearTimeout(timer);resolve({stdout,stderr,exit_code:code??(timed_out?124:1),timed_out,cwd});});
 });
}
