import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {PolicyGate} from "../dist/lib/policy-gateway.js";
import {classifyTool} from "../dist/lib/tool-classification.js";

const original=process.env.BRIDGEDEV_RUNTIME_MODE;
const originalPolicyPath=process.env.POLICYGATE_POLICY_FILE;
const root=await fs.mkdtemp(path.join(os.tmpdir(),"bridge-managed-yolo-mcp-"));
try {
  process.env.BRIDGEDEV_RUNTIME_MODE="managed";
  const policy=JSON.parse(await fs.readFile("profiles/policy.example.json","utf8"));
  policy.audit_log=path.join(root,"audit.jsonl");
  policy.proxy_tools={rea__operator_pinned:"X"};
  const filename=path.join(root,"policy.json");
  await fs.writeFile(filename,JSON.stringify(policy));
  process.env.POLICYGATE_POLICY_FILE=filename;
  const gate=new PolicyGate(filename);
  gate.setProviderPermissions({
    rea__read_guidance_section:"R",
    rea__analyze_function:"X",
    rea__operator_pinned:"R",
  });
  const standard=gate.getProxyPermissions("standard");
  assert.deepEqual(standard,{rea__operator_pinned:"X"});
  assert.deepEqual(gate.getProxyPermissions("strict"),standard);
  const yolo=gate.getProxyPermissions("dangerous");
  assert.deepEqual(yolo,{
    rea__read_guidance_section:"R",
    rea__analyze_function:"X",
    rea__operator_pinned:"X",
  },"Independently pinned policy must always override provider metadata");
  assert.deepEqual(classifyTool("rea__read_guidance_section",{},yolo),{
    kind:"R",proxy:true,requiresProxyApproval:false,
  });
  assert.deepEqual(classifyTool("rea__read_guidance_section",{},standard),{
    kind:"X",proxy:true,requiresProxyApproval:true,
  });
  assert.deepEqual(classifyTool("rea__unknown",{},yolo),{
    kind:"X",proxy:true,requiresProxyApproval:true,
  });
  gate.setProviderPermissions({}); // Provider disabled, removed or permission sync reset
  assert.deepEqual(gate.getProxyPermissions("dangerous"),standard);
  gate.setProviderPermissions({rea__analyze_function:"X"});
  assert.deepEqual(gate.getProxyPermissions("standard"),standard,
    "Signed-mode downgrade must immediately remove dynamic classes");

  // Real provider registry synchronization: a managed provider needs an
  // independently reviewed active definition and explicit tool selection.
  const {McpUpstreamManager}=await import("../dist/lib/mcp-upstream-manager.js");
  const {getPolicyGate}=await import("../dist/lib/policy-gateway.js");
  const providerPath=path.join(root,"upstream.json");
  await fs.writeFile(providerPath,JSON.stringify({version:1,servers:[]}));
  const manager=new McpUpstreamManager(providerPath);
  await manager.init();
  try{
    const upstream={id:"fixture",name:"Reviewed fixture",enabled:true,reviewed:true,
      transport:"stdio",command:process.execPath,args:["--version"],
      expose:"allowlist",tools:["read","run"],
      tool_permissions:{read:"R",run:"X"}};
    const active=()=>getPolicyGate().getProxyPermissions("dangerous");
    await manager.updateConfig({version:1,servers:[upstream]});
    assert.equal(active().fixture__read,"R");
    assert.equal(active().fixture__run,"X");
    assert.equal(getPolicyGate().getProxyPermissions("standard").fixture__read,undefined);
    await manager.updateConfig({version:1,servers:[{...upstream,reviewed:false}]});
    assert.equal(active().fixture__read,undefined,"Unreviewed MCP must not inherit YOLO classes");
    await manager.updateConfig({version:1,servers:[{...upstream,disabled_tools:["read"]}]});
    assert.equal(active().fixture__read,undefined,"Disabled tool must not be classified");
    assert.equal(active().fixture__run,"X");
    await manager.updateConfig({version:1,servers:[{...upstream,enabled:false}]});
    assert.equal(active().fixture__run,undefined,"Disabling provider revokes its classes immediately");
  }finally{await manager.shutdown();}
  console.log("Managed MCP classes: signed-mode merge, operator override, strict/standard isolation, disabled/unreviewed provider deny, revocation PASS");
}finally{
  if(original===undefined)delete process.env.BRIDGEDEV_RUNTIME_MODE;
  else process.env.BRIDGEDEV_RUNTIME_MODE=original;
  if(originalPolicyPath===undefined)delete process.env.POLICYGATE_POLICY_FILE;
  else process.env.POLICYGATE_POLICY_FILE=originalPolicyPath;
  await fs.rm(root,{recursive:true,force:true});
}
