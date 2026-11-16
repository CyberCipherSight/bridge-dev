import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function executable(file:string):boolean {try{fs.accessSync(file,fs.constants.X_OK);return true;}catch{return false;}}
export function swayShortcut(key:string):string {
  if(!/^[A-Za-z0-9_-]+(?:\+[A-Za-z0-9_-]+)+$/.test(key)||key.length>90)
    throw Error("MONITOR_SHORTCUT_INVALID_KEY");
  return "bindsym --no-repeat "+key+" exec --no-startup-id ~/.local/bin/bridge-dev monitor";
}
export async function monitorCli(args:string[]):Promise<void> {
  const home=os.homedir();
  if(args[0]==="doctor" && args.length===1){
    // Distinguish an offline gateway from a stale Admin token after rotation.
    // Only the local authenticated listener is inspected; no token is printed.
    const env=path.join(process.env.XDG_CONFIG_HOME||path.join(home,".config"),"bridge-dev",".env");
    const raw=await fsp.readFile(env,"utf8").catch(()=> "");
    const tokenLine=raw.split(/\r?\n/).filter(x=>x.startsWith("ADMIN_TOKEN="));
    const token=tokenLine.length===1 ? tokenLine[0].slice(12).replace(/^['"]|['"]$/g,"") : "";
    const portLine=raw.split(/\r?\n/).find(x=>x.startsWith("ADMIN_PORT="));
    const rawPort=(portLine?.slice(11)||process.env.ADMIN_PORT||"3001").trim().replace(/^['"]|['"]$/g, "");
    if(!/^\d{1,5}$/.test(rawPort)||Number(rawPort)>65535||Number(rawPort)<1)
      throw Error("MONITOR_INVALID_ADMIN_PORT");
    if(!token)throw Error("MONITOR_ADMIN_TOKEN_NOT_CONFIGURED");
    try{
      const response=await fetch("http://127.0.0.1:"+rawPort+"/health",{
        method:"GET",headers:{Authorization:"Bearer "+token},
        signal:AbortSignal.timeout(1800),cache:"no-store",
      });
      if(response.status===401||response.status===403){
        console.log("Admin listener reachable but credentials rejected ("+response.status+").");
        console.log("The monitor may be using a token rotated after the service started. Restart only BridgeDev after reviewing credential drift, then reopen the monitor.");
        return;
      }
      if(!response.ok){console.log("Admin listener HTTP "+response.status);return;}
      const health=await response.json() as Record<string,unknown>;
      console.log(JSON.stringify({
        reachable:true,pid:health.pid??null,security_mode:health.policy_mode??"unknown",
        full_machine_access:health.full_machine_access===true,
        active_sessions:health.active_sessions??null,commit:health.commit??null,
      },null,2));
    }catch(err){
      console.log("Admin listener unreachable (network/port/timeout), not an authorization verdict: "+(err instanceof Error?err.name:"unknown"));
    }
    return;
  }
  if(args[0]==="shortcut"){
    const ki=args.indexOf("--key");
    if(ki>=0&&!args[ki+1])throw Error("MONITOR_SHORTCUT_KEY_MISSING");
    if(args.some((arg,i)=>i>0&&!["--key","--install-desktop",args[ki+1]].includes(arg)))
      throw Error("Usage: bridge-dev monitor shortcut [--key Mod4+Mod1+d] [--install-desktop]");
    const line=swayShortcut(ki>=0?args[ki+1]:"Mod4+Mod1+d");
    if(args.includes("--install-desktop")){
      const dir=path.join(process.env.XDG_DATA_HOME||path.join(home,".local/share"),"applications");
      const file=path.join(dir,"bridge-dev-monitor.desktop");
      const cli=path.join(home,".local/bin","bridge-dev");
      const cmd='"'+cli.replaceAll("\\","\\\\").replaceAll('"','\\"').replaceAll("%","%%")+'" monitor';
      const content="[Desktop Entry]\nType=Application\nName=BridgeDev Monitor\nComment=On-demand local BridgeDev dashboard\nExec="+cmd+"\nTerminal=false\nCategories=Development;System;\n";
      await fsp.mkdir(dir,{recursive:true,mode:0o700});
      const old=await fsp.readFile(file,"utf8").catch(e=>{if(e.code==="ENOENT")return null;throw e;});
      if(old&&old!==content)throw Error("MONITOR_SHORTCUT_UNOWNED: refusing to overwrite launcher");
      if(!old)await fsp.writeFile(file,content,{flag:"wx",mode:0o644});
      console.log("XDG desktop entry installed: "+file);
    }
    console.log("Optional Sway/i3 binding (check your current key conflicts, add to managed config yourself):");
    console.log("  "+line);
    console.log("No compositor configuration or service changed.");
    return;
  }
  if(args.length)throw Error("Usage: bridge-dev monitor [doctor | shortcut [--key Mod4+Mod1+d] [--install-desktop]]");
  const toggle=path.join(home,".local/bin","scratch-toggle");
  const tui=path.join(home,".local/bin","bridge-dev-monitor");
  if(process.env.SWAYSOCK&&executable(toggle)&&executable(tui)){
    const r=spawnSync(toggle,["dc"],{stdio:"inherit",timeout:12000});
    if(r.error||r.status!==0)throw Error("MONITOR_SCRATCHPAD_FAILED");
    return;
  }
  if(process.stdin.isTTY&&executable(tui)){
    const r=spawnSync(tui,[],{stdio:"inherit"});
    if(r.error||r.status!==0)throw Error("MONITOR_TUI_FAILED");
    return;
  }
  const raw=(process.env.ADMIN_PORT||"3001").trim().replace(/^['"]|['"]$/g, ""),port=Number(raw);
  if(!/^\d{1,5}$/.test(raw)||port<1||port>65535)throw Error("MONITOR_ADMIN_PORT_INVALID");
  const url="http://127.0.0.1:"+port+"/ui/";
  const cmd=process.platform==="darwin"?"open":process.platform==="win32"?"cmd":"xdg-open";
  const argsOut=process.platform==="win32"?["/c","start","",url]:[url];
  const child=spawn(cmd,argsOut,{stdio:"ignore",detached:true});
  child.once("error",()=>{});
  child.unref();
  console.log("Local dashboard: "+url);
}
