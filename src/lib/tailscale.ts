import {execFileSync} from "node:child_process";

function status():Record<string,any>{
  return JSON.parse(execFileSync("tailscale",["funnel","status","--json"],{encoding:"utf8",timeout:2500,maxBuffer:262144,stdio:["ignore","pipe","ignore"]}));
}
function targetsPort(proxy:unknown,port:number):boolean{
  if(typeof proxy!=="string")return false;
  try{const u=new URL(proxy);return u.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(u.hostname)&&u.port===String(port)&&u.pathname==="/"&&!u.username&&!u.password;}catch{return false;}
}
export function tailscaleEndpoint(port:number):string|null{
  if(process.env.BRIDGEDEV_PUBLIC_URL){try{const u=new URL(process.env.BRIDGEDEV_PUBLIC_URL);if(u.protocol==="https:"&&!u.username&&!u.password)return u.href.replace(/\/$/,"");}catch{}return null;}
  try{const value=status();for(const[host,web]of Object.entries(value.Web||{}) as [string,any][]){if(value.AllowFunnel?.[host]===true&&targetsPort(web?.Handlers?.["/"]?.Proxy,port)&&/^[a-zA-Z0-9.-]+:443$/.test(host))return "https://"+host.replace(/:443$/,"");}}catch{}
  return null;
}
/** Explicit opt-in only. Never reset, replace or remove existing Funnel routes. */
export function enableTailscaleFunnel(port:number):void{
  if(!Number.isInteger(port)||port<1||port>65535)throw Error("Invalid MCP port");
  const value=status();
  if(Object.keys(value.Web||{}).length||Object.keys(value.TCP||{}).length){
    for(const[host,web]of Object.entries(value.Web||{}) as [string,any][]){if(value.AllowFunnel?.[host]===true&&targetsPort(web?.Handlers?.["/"]?.Proxy,port))return;}
    throw Error("Existing Tailscale configuration does not expose this gateway; configure a separate reviewed route. No routes changed.");
  }
  execFileSync("tailscale",["funnel","--bg",String(port)],{timeout:15000,stdio:"inherit"});
}
