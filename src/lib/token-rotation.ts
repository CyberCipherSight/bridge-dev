import fs, { constants } from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";

export type CredentialKind = "admin" | "mcp";
const keyOf = (kind: CredentialKind) => kind === "admin" ? "ADMIN_TOKEN" : "MCP_TOKEN";
export function credentialFilePath(): string {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "bridge-dev", ".env");
}
async function requireSafeFile(filename: string): Promise<void> {
  const st = await fsp.lstat(filename);
  if (!st.isFile() || st.nlink !== 1 || (process.getuid && st.uid !== process.getuid()) || (st.mode & 0o777) !== 0o600)
    throw Error("TOKEN_FILE_UNSAFE: expected regular, single-link user-owned .env mode 0600");
  const parent = await fsp.stat(path.dirname(filename));
  if (!parent.isDirectory() || (parent.mode & 0o022) !== 0)
    throw Error("TOKEN_PARENT_UNSAFE: directory group/world writable");
}
async function readSafeFile(filename: string): Promise<string> {
  await requireSafeFile(filename);
  const h = await fsp.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const s=await h.stat();
    if (!s.isFile() || s.nlink!==1 || (s.mode&0o777)!==0o600 || (process.getuid && s.uid!==process.getuid()))
      throw Error("TOKEN_FILE_CHANGED");
    return await h.readFile("utf8");
  } finally { await h.close(); }
}
export async function inspectCredentialFile(filename=credentialFilePath()): Promise<{file:string;configured:boolean;mode:string}> {
  const contents=await readSafeFile(filename);
  const lines=contents.split(/\r?\n/);
  return {file:filename,configured:["ADMIN_TOKEN","MCP_TOKEN"].every(k=>lines.filter(l=>l.startsWith(k+"=")).length===1),mode:"0600"};
}
export async function rotateCredentialFile(filename:string,kind:CredentialKind,
  generate:()=>string=()=>randomBytes(32).toString("hex")):Promise<{kind:CredentialKind;file:string;backup:string}> {
  const contents=await readSafeFile(filename);
  const lines=contents.match(/[^\n]*\n|[^\n]+$/g)||[];
  for(const k of ["ADMIN_TOKEN","MCP_TOKEN"])
    if(lines.filter(l=>l.startsWith(k+"=")).length!==1)throw Error("TOKEN_ENV_DUPLICATE_OR_MISSING_"+k);
  const token=generate();
  if(!/^[a-f0-9]{64}$/.test(token))throw Error("TOKEN_NEW_VALUE_INVALID");
  const key=keyOf(kind),idx=lines.findIndex(l=>l.startsWith(key+"="));
  const line=lines[idx],suffix=line.endsWith("\r\n")?"\r\n":line.endsWith("\n")?"\n":"";
  if(line.replace(/\r?\n$/,"").slice(key.length+1)===token)throw Error("TOKEN_UNCHANGED");
  lines[idx]=key+"="+token+suffix;
  const backup=filename+".backup-"+new Date().toISOString().replace(/[:.]/g,"-")+"-"+randomBytes(4).toString("hex");
  const temp=filename+".new-"+randomBytes(8).toString("hex");
  const b=await fsp.open(backup,"wx",0o600);
  try{await b.writeFile(contents,"utf8");await b.sync();}finally{await b.close();}
  try{
    const w=await fsp.open(temp,"wx",0o600);
    try{await w.writeFile(lines.join(""),"utf8");await w.sync();}finally{await w.close();}
    const now=await readSafeFile(filename);
    if(now!==contents)throw Error("TOKEN_ENV_CONCURRENT_MODIFICATION");
    await fsp.rename(temp,filename);
    const dir=await fsp.open(path.dirname(filename),"r");
    try{await dir.sync();}finally{await dir.close();}
  }finally{await fsp.unlink(temp).catch(e=>{if(e?.code!=="ENOENT")throw e;});}
  return {kind,file:filename,backup};
}
