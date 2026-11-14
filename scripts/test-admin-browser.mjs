import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fixturePorts } from "./test-ports.mjs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
const binary = process.env.BRIDGEDEV_TEST_BROWSER;
if (!binary || !path.isAbsolute(binary))
  throw Error(
    "Set BRIDGEDEV_TEST_BROWSER to an existing Chromium-compatible executable",
  );
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-browser-"));
const [port, adminPort] = await fixturePorts(2),
  token = randomBytes(32).toString("hex"),
  admin = randomBytes(32).toString("hex"),
  work = path.join(root, "work"),
  source = path.join(root, "guide.md");
await fs.mkdir(work);
const hostile =
  '<img src="https://hostile.invalid/leak" onerror="globalThis.pwned=true"><script>globalThis.pwned=true</script>';
await fs.writeFile(source, "# Browser fixture instructions\n" + hostile);
const env = {
  ...process.env,
  POLICYGATE_POLICY_FILE: "",
  BRIDGEDEV_RUNTIME_MODE: "portable",
  BRIDGEDEV_STATE_DIR: path.join(root, "state"),
  WORKSPACE_PATH: work,
  MCP_UPSTREAM_CONFIG: path.join(root, "providers.json"),
  PORT: String(port),
  ADMIN_PORT: String(adminPort),
  MCP_TOKEN: token,
  ADMIN_TOKEN: admin,
};
let gateway,
  browser,
  ws,
  logs = "";
const external = [],
  errors = [],
  requests = [];
async function waitFor(action) {
  for (let i = 0; i < 100; i++) {
    try {
      const result = await action();
      if (result) return result;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Browser fixture timeout: " + logs.slice(-1000));
}
try {
  gateway = spawn(process.execPath, ["dist/index.js"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  gateway.stderr.on("data", (b) => (logs = (logs + b).slice(-12000)));
  gateway.stdout.on("data", (b) => (logs = (logs + b).slice(-12000)));
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`);
    return r.ok;
  });
  const profile = path.join(root, "browser");
  browser = spawn(
    binary,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-breakpad",
      "--no-first-run",
      "--password-store=basic",
      "--disable-default-apps",
      "--disable-extensions",
      "--remote-debugging-port=0",
      "--user-data-dir=" + profile,
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      "--window-size=1280,900",
      "about:blank",
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: root,
        XDG_CONFIG_HOME: path.join(root, "browser-config"),
        XDG_CACHE_HOME: path.join(root, "browser-cache"),
        TMPDIR: os.tmpdir(),
      },
      stdio: ["ignore", "ignore", "pipe"],
      detached: process.platform !== "win32",
    },
  );
  browser.stderr.on("data", (b) => (logs = (logs + b).slice(-12000)));
  const debugPort = await waitFor(async () =>
    Number(
      (
        await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")
      ).split("\n")[0],
    ),
  );
  const target = await (
    await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
      method: "PUT",
    })
  ).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let next = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const d = JSON.parse(event.data);
    if (d.id && pending.has(d.id)) {
      const p = pending.get(d.id);
      pending.delete(d.id);
      d.error ? p.reject(Error(JSON.stringify(d.error))) : p.resolve(d.result);
    }
    if (d.method === "Runtime.exceptionThrown")
      errors.push(d.params.exceptionDetails.text);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error")
      errors.push("console error");
    if (d.method === "Log.entryAdded" && d.params.entry.level === "error")
      errors.push(d.params.entry.source + ": " + d.params.entry.text);
    if (d.method === "Network.requestWillBeSent") {
      const url = d.params.request.url;
      requests.push(url);
      if (
        !url.startsWith(`http://127.0.0.1:${adminPort}/`) &&
        !url.startsWith("data:")
      )
        external.push(url);
    }
  });
  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await command("Log.enable");
  await command("Runtime.enable");
  await command("Network.enable");
  await command("Page.enable");
  await command("Page.navigate", {
    url: `http://127.0.0.1:${adminPort}/ui/#token=${admin}`,
  });
  await waitFor(() =>
    evaluate(
      'document.readyState==="complete" && typeof refreshAll==="function" && document.getElementById("screen").textContent.includes("Gateway")',
    ),
  );
  assert.equal(await evaluate("location.hash"), "");
  assert.equal(await evaluate("location.search"), "");
  assert.equal(await evaluate("localStorage.length+sessionStorage.length"), 0);
  assert.ok(
    !requests.some((u) => u.endsWith("/api/access")),
    "MCP token must not be loaded by default",
  );
  assert.equal(
    await evaluate('document.getElementById("admin-credential").value'),
    admin,
  );
  // Discovery, preview, operator queue and explicit confirmation use the real API.
  await evaluate('navigate("instructions")');
  await evaluate(
    `document.getElementById('extension-source').value=${JSON.stringify(source)};document.getElementById('add-flow').requestSubmit()`,
  );
  await waitFor(() =>
    evaluate(
      'document.getElementById("extension-preview").textContent.includes("Request operator approval")',
    ),
  );
  assert.match(
    await evaluate('document.getElementById("extension-preview").textContent'),
    /instructions:guide/,
  );
  await evaluate('navigate("approvals")');
  await evaluate(
    '[...document.querySelectorAll("button")].find(b=>b.textContent==="Review exact proposal").click()',
  );
  await command("Page.handleJavaScriptDialog", { accept: true }).catch(
    () => {},
  );
  // Confirmation remains a real browser modal; handle it asynchronously.
  const apply = evaluate(
    'document.getElementById("extension-approve").click()',
  );
  await new Promise((r) => setTimeout(r, 100));
  await command("Page.handleJavaScriptDialog", { accept: true });
  await apply;
  await waitFor(() =>
    evaluate(
      'document.getElementById("notice").textContent.includes("Applied")',
    ),
  );
  await evaluate('navigate("instructions")');
  assert.match(await evaluate("screen.textContent"), /guide/);
  await evaluate(
    '[...screen.querySelectorAll("button")].find(b=>b.textContent==="Inspect").click()',
  );
  assert.match(
    await evaluate('document.getElementById("detail-body").textContent'),
    /onerror/,
  );
  assert.equal(await evaluate("Boolean(globalThis.pwned)"), false);
  assert.equal(
    await evaluate(
      'document.querySelectorAll("#detail img,#detail script").length',
    ),
    0,
  );
  await evaluate('document.getElementById("detail").close()');
  await evaluate('navigate("audit")');
  await evaluate("activityDialog()");
  await evaluate('document.getElementById("activity-live").click()');
  await waitFor(() =>
    requests.some((url) => url.endsWith("/api/activity/stream")),
  );
  await evaluate('document.getElementById("detail").close()');
  await waitFor(() => evaluate("activityAbort===null"));
  // Inject hostile provider metadata, source URLs and audit fields at the fetch boundary.
  // This exercises the actual DOM renderer without installing an executable.
  await evaluate(
    `globalThis.originalFetch=fetch;globalThis.hostile=${JSON.stringify(hostile)};globalThis.fetch=async(...args)=>{const url=String(args[0]);if(url==='/api/extensions/provider-review'){globalThis.lastProviderReview=JSON.parse(args[1].body);return new Response(JSON.stringify({ok:true,data:{id:'a'.repeat(64),action:'enable'}}));}const response=await originalFetch(...args);if(url==='/api/extensions'){const data=await response.json();data.data.providers=[{id:'hostile',name:hostile,transport:'http',enabled:false,health:'error',last_error:hostile,proxied_tools:['hostile__echo']}];data.data.entries.forEach(e=>{e.source=hostile;e.resolved=hostile;});return new Response(JSON.stringify(data));}if(url==='/api/upstream')return new Response(JSON.stringify({ok:true,config:{servers:[{id:'hostile',enabled:false,tools:['echo'],tool_permissions:{echo:'R'},allow_private_network:true}]}}));if(url.startsWith('/api/extensions/provider-tools'))return new Response(JSON.stringify({ok:true,data:{tools:[{name:'echo',description:'Reviewed fixture'},{name:hostile,description:hostile}]}}));if(url.startsWith('/api/audit')){const data=await response.json();data.entries.unshift({time:hostile,actor:hostile,phase:hostile,outcome:hostile});return new Response(JSON.stringify(data));}return response;}`,
  );
  await evaluate('navigate("extensions")');
  await evaluate(
    '[...screen.querySelectorAll("button")].find(b=>b.textContent==="Inspect").click()',
  );
  await waitFor(() => evaluate('document.getElementById("detail").open'));
  assert.equal(
    await evaluate(
      'document.querySelectorAll("#detail img,#detail script").length',
    ),
    0,
  );
  await evaluate('document.getElementById("detail").close()');
  await evaluate('navigate("extensions")');
  await evaluate(
    '[...screen.querySelectorAll("button")].find(b=>b.textContent==="Inspect").click()',
  );
  await waitFor(() => evaluate('document.getElementById("detail").open'));
  assert.equal(
    await evaluate(
      `document.querySelector('#detail input[value="echo"]').checked`,
    ),
    true,
    "Raw allowlist tool must remain selected despite namespaced exposure",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('#detail select[aria-label="Granted tool permission"]').value`,
    ),
    "",
  );
  await evaluate(
    '[...document.querySelectorAll("#detail button")].find(b=>b.textContent==="Preview enable").click()',
  );
  await waitFor(() =>
    evaluate(
      'document.getElementById("detail-title").textContent==="Lifecycle proposal"',
    ),
  );
  assert.deepEqual(await evaluate("Object.keys(lastProviderReview).sort()"), [
    "enabled",
    "name",
  ]);
  await evaluate('document.getElementById("detail").close()');
  const names = [
    "overview",
    "extensions",
    "skills",
    "instructions",
    "packs",
    "approvals",
    "audit",
    "connection",
    "settings",
  ];
  const evidence = process.env.BRIDGEDEV_BROWSER_EVIDENCE;
  if (evidence) await fs.mkdir(evidence, { recursive: true });
  for (const width of [1280, 390]) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width === 390,
    });
    for (const name of names) {
      await evaluate("navigate(" + JSON.stringify(name) + ")");
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
        "Page overflow: " + name + " " + width,
      );
      if (evidence) {
        const shot = await command("Page.captureScreenshot", { format: "png" });
        await fs.writeFile(
          path.join(evidence, name + "-" + width + ".png"),
          Buffer.from(shot.data, "base64"),
        );
      }
    }
  }
  await evaluate('document.getElementById("theme").click()');
  assert.equal(
    await evaluate("document.documentElement.dataset.theme"),
    "light",
  );
  await evaluate('document.getElementById("theme").click()');
  assert.equal(
    await evaluate("document.documentElement.dataset.theme"),
    "dark",
  );
  await command("Page.bringToFront");
  await evaluate(
    'document.activeElement.blur();globalThis.keyTrace=[];document.addEventListener("keydown",e=>keyTrace.push([e.key,e.target.tagName,document.activeElement.id]))',
  );
  for (const key of ["g", "o"]) {
    await command("Input.dispatchKeyEvent", { type: "rawKeyDown", key });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key });
  }
  await waitFor(() =>
    evaluate('document.getElementById("title").textContent==="Overview"'),
  );
  await command("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "/",
    code: "Slash",
    windowsVirtualKeyCode: 191,
  });
  await command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "/",
    code: "Slash",
    windowsVirtualKeyCode: 191,
  });
  assert.equal(
    await evaluate("document.activeElement.id"),
    "filter",
    JSON.stringify(await evaluate("keyTrace")),
  );
  assert.equal(
    await evaluate(
      '[...document.querySelectorAll("button,input,select,textarea")].filter(e=>e.offsetParent!==null).every(e=>e.textContent.trim()||e.labels?.length||e.getAttribute("aria-label")||e.getAttribute("aria-labelledby"))',
    ),
    true,
    "Controls need accessible names",
  );
  assert.equal(await evaluate("Boolean(globalThis.pwned)"), false);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  assert.ok(!requests.some((u) => u.endsWith("/api/access")));
  await evaluate('document.getElementById("disconnect").click()');
  assert.equal(
    await evaluate('document.getElementById("admin-credential").value'),
    "",
  );
  assert.equal(await evaluate("localStorage.length+sessionStorage.length"), 0);
  ws.close();
  ws = undefined;
  const oldBrowserExit = new Promise((resolve) =>
    browser.once("exit", resolve),
  );
  process.platform === "win32"
    ? browser.kill()
    : process.kill(-browser.pid, "SIGTERM");
  await oldBrowserExit;
  browser = undefined;
  const { acceptAdminBrowser } =
    await import("./deploy-acceptance/browser.mjs");
  const smoke = await acceptAdminBrowser({
    binary,
    adminUrl: `http://127.0.0.1:${adminPort}`,
    adminToken: admin,
  });
  assert.ok(smoke.ok && smoke.sections.length === 9);
  console.log(
    "Admin browser PASS: nine sections, desktop/phone, real add/approval, hostile metadata/content/audit, no external requests or console errors, memory-only credentials/theme, keyboard and accessible control names",
  );
} finally {
  ws?.close();
  if (gateway && gateway.exitCode === null) {
    const exited = new Promise((resolve) => gateway.once("exit", resolve));
    await fetch(`http://127.0.0.1:${adminPort}/api/lifecycle/stop`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + admin,
        "Content-Type": "application/json",
        Connection: "close",
      },
      body: "{}",
    }).catch(() => gateway.kill());
    await exited;
  }
  if (browser && browser.exitCode === null) {
    try {
      process.platform === "win32"
        ? browser.kill()
        : process.kill(-browser.pid, "SIGTERM");
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
    try {
      if (browser.exitCode === null)
        process.platform === "win32"
          ? browser.kill("SIGKILL")
          : process.kill(-browser.pid, "SIGKILL");
    } catch {}
  }
  await fs.rm(root, { recursive: true, force: true });
}
