import path from "node:path";
import {atomicJson} from "../lib/atomic-store.js";
import {portableStateDir,getRuntimeMode} from "../lib/runtime.js";
import {Router} from "express";
import {z} from "zod";
import {ExtensionStore} from "../lib/extension-store.js";
import type {McpUpstreamManager} from "../lib/mcp-upstream-manager.js";
import {getPolicyGate} from "../lib/policy-gateway.js";
import {redactAudit} from "../lib/hash-audit.js";
import {sha256} from "../lib/extension-sources.js";
import {marketplace,loadMarketplace} from "../lib/marketplace.js";
import {listLocalSkills} from "../lib/custom-resources.js";
import {readIntegrationPreferences,saveIntegrationPreference,integrationPreference,resolveIntegration} from "../lib/integration-preferences.js";
export function extensionRouter(manager:McpUpstreamManager):Router{
 const router=Router(),store=new ExtensionStore(undefined,undefined,manager);
 const scope=z.enum(["user","project"]).default("project");
 const run=(handler:(req:any)=>Promise<unknown>)=>async(req:any,res:any)=>{try{res.json({ok:true,data:redactAudit(await handler(req))});}catch(error){res.status(400).json({ok:false,error:String(redactAudit(String(error)))});}};
 router.get("/api/marketplace",run(req=>marketplace(manager,req.query)));
 router.get("/api/custom/resources",run(()=>listLocalSkills()));
 router.get("/api/marketplace/preferences",run(()=>readIntegrationPreferences()));
 router.post("/api/marketplace/preferences",run(async req=>{
  const value=integrationPreference.parse(req.body);
  if(value.provider_id&&!manager.getServerConfig(value.provider_id))throw Error("PROVIDER_NOT_FOUND");
  await getPolicyGate().audit.append({phase:"operator_integration_preference",...value});
  const result=await saveIntegrationPreference(value);await manager.reloadConfig();return result;
 }));
 router.post("/api/marketplace/propose",run(async req=>{
  const {id,scope:targetScope}=z.object({id:z.string().max(81),scope}).strict().parse(req.body);
  const entry=(await loadMarketplace()).entries.find(e=>e.id===id);
  if(!entry)throw Error("CATALOG_ENTRY_NOT_FOUND");
  if(entry.type==="tool")throw Error("DEVELOPER_TOOL_REQUIRES_INDEPENDENT_SETUP: a CLI is not automatically an MCP server; review upstream installation and supported entrypoints");
  const preference=(await readIntegrationPreferences()).services.find(s=>s.service===(entry.native_alternative?.service||entry.id));
  if(!resolveIntegration(preference,entry.capabilities[0]).offer_local)throw Error("INTEGRATION_PREFERENCE_DENIED: choose a BridgeDev preference explicitly before proposing a duplicate");
  if(entry.installation.mechanism==="native")throw Error("BUNDLED_TOOL_ALREADY_AVAILABLE");
  return store.propose(entry.installation.source,undefined,targetScope);
 }));
 router.post("/api/extensions/provider-definition",run(async req=>{
  const body=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),name:z.string().min(1).max(128),transport:z.enum(["stdio","http"]),command:z.string().max(4096).optional(),args:z.array(z.string().max(4096)).max(64).optional(),env:z.record(z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/),z.string().max(4096)).refine(v=>Object.keys(v).length<=32).optional(),cwd:z.string().max(4096).optional(),url:z.string().url().max(2048).optional(),bearer_token_env_var:z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(),auth:z.object({type:z.enum(["none","oauth","auto"])}).strict().optional(),allow_private_network:z.boolean().optional(),scope}).strict().parse(req.body);
  const {scope:targetScope,...definition}=body;
  return store.proposeDefinition({...definition,enabled:false,expose:"none"},targetScope);
 }));
 router.post("/api/mode",run(async req=>{
  if(getRuntimeMode()!=="portable")throw new Error("Managed modes require the independent signed operator CLI");
  const {mode}=z.object({mode:z.enum(["strict","standard"])}).strict().parse(req.body);
  await getPolicyGate().audit.append({phase:"operator_portable_mode",mode});await atomicJson(path.join(portableStateDir(),"mode.json"),{version:1,mode});await manager.shutdown();await manager.refreshAllProxies();return {mode};
 }));
 router.get("/api/extensions/validate",run(async()=>({results:await store.validate()})));
 router.get("/api/extensions",run(async()=>({entries:await store.list(),requests:await store.requests(),providers:manager.listStatusesCached(),configuration:manager.configuration,registry_error:manager.initializationError})));
 router.post("/api/extensions/discover",run(async req=>{const body=z.object({source:z.string().min(1).max(2048),selection:z.array(z.string()).max(64).optional(),scope}).strict().parse(req.body);return store.propose(body.source,body.selection,body.scope);}));
 router.get("/api/extensions/proposal/:id",run(req=>store.proposal(req.params.id)));
 router.post("/api/extensions/review",run(req=>store.reviewRequest(z.object({id:z.string().regex(/^[a-f0-9]{64}$/)}).parse(req.body).id)));
 router.post("/api/extensions/action",run(req=>{const body=z.object({action:z.enum(["remove","update","enable","disable"]),key:z.string().min(1).max(128),scope}).strict().parse(req.body);return store.proposeAction(body.action,body.key,body.scope);}));
 router.post("/api/extensions/provider-remove",run(req=>store.proposeProviderRemoval(z.object({name:z.string().min(1).max(128)}).strict().parse(req.body).name)));
 router.post("/api/extensions/provider-review",run(req=>{
  const body=z.object({name:z.string(),enabled:z.boolean(),tools:z.array(z.string().max(256)).max(256).optional(),permission:z.enum(["R","W","X"]).optional(),allow_private_network:z.boolean().optional()}).strict().parse(req.body);
  const current=manager.getServerConfig(body.name);if(!current)throw new Error("PROVIDER_NOT_FOUND");
  const changes:Partial<typeof current>={enabled:body.enabled};
  if(body.tools!==undefined){changes.expose="allowlist";changes.tools=body.tools;changes.tool_permissions=Object.fromEntries(body.tools.map(name=>[name,body.permission||current.tool_permissions?.[name]||"X"]));}
  if(body.allow_private_network!==undefined)changes.allow_private_network=body.allow_private_network;
  return store.proposeProvider(body.name,changes);
 }));
 router.post("/api/extensions/provider-test",run(async req=>{const {name}=z.object({name:z.string()}).strict().parse(req.body),config=manager.getServerConfig(name);if(!config)throw new Error("PROVIDER_NOT_FOUND");await getPolicyGate().audit.append({phase:"operator_provider_test",provider:name,fingerprint:sha256(JSON.stringify(config))});return manager.testProvider(name);}));
 router.get("/api/extensions/provider-logs",run(async req=>manager.providerLogs(String(req.query.name||""))));
 router.get("/api/extensions/provider-tools",run(async req=>({origin:"untrusted provider",tools:manager.inspectCachedTools(String(req.query.name||"")),rejected:manager.inspectRejectedTools(String(req.query.name||""))})));
 router.post("/api/extensions/apply",run(async req=>{
  const {id}=z.object({id:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);
  const proposal=await store.proposal(id);
  await getPolicyGate().audit.append({phase:"operator_extension_approval",id,action:proposal.action,source:proposal.discovery?.source,resolved:proposal.discovery?.resolved,digest:proposal.discovery?.digest});
  try{const result=await store.apply(id);await manager.refreshAllProxies();
   await getPolicyGate().audit.append({phase:"operator_extension_result",id,status:"ok"});return result;
  }catch(error){await getPolicyGate().audit.append({phase:"operator_extension_result",id,status:"error",error:String(error)});throw error;}
 }));
 return router;
}
