// Read-only browser acceptance for an authenticated live or staged admin UI.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { mintAdminPairCode } from "../../dist/admin/local-session.js";
export async function acceptAdminBrowser({
  binary,
  adminUrl,
  adminToken,
  evidence,
}) {
  if (!path.isAbsolute(binary))
    throw Error("DEPLOY_BROWSER_ABSOLUTE_PATH_REQUIRED");
  const origin = new URL(adminUrl).origin;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname))
    throw Error("DEPLOY_BROWSER_LOOPBACK_REQUIRED");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-live-browser-")),
    profile = path.join(root, "profile"),
    external = [],
    errors = [],
    requests = [];
  let browser, ws;
  const deadline = Date.now() + 25000;
  async function until(fn) {
    while (Date.now() < deadline) {
      try {
        const value = await fn();
        if (value) return value;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error("DEPLOY_BROWSER_TIMEOUT");
  }
  try {
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
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
        "about:blank",
      ],
      {
        env: {
          PATH: process.env.PATH,
          HOME: root,
          XDG_CONFIG_HOME: path.join(root, "config"),
          XDG_CACHE_HOME: path.join(root, "cache"),
        },
        stdio: "ignore",
        detached: process.platform !== "win32",
      },
    );
    const debug = await until(async () =>
      Number(
        (
          await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")
        ).split("\n")[0],
      ),
    );
    const target = await (
      await fetch("http://127.0.0.1:" + debug + "/json/new?about:blank", {
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
        d.error
          ? p.reject(Error("DEPLOY_BROWSER_PROTOCOL_ERROR"))
          : p.resolve(d.result);
      }
      if (
        d.method === "Runtime.exceptionThrown" ||
        (d.method === "Runtime.consoleAPICalled" && d.params.type === "error")
      )
        errors.push(d.method);
      if (d.method === "Log.entryAdded" && d.params.entry.level === "error")
        errors.push(d.params.entry.source + ": " + d.params.entry.text);
      if (d.method === "Network.requestWillBeSent") {
        const url = d.params.request.url;
        requests.push(url);
        if (!url.startsWith(origin + "/") && !url.startsWith("data:"))
          external.push("external request");
      }
    });
    const command = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++next;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(Error("DEPLOY_BROWSER_COMMAND_TIMEOUT"));
        }, 5000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const r = await command("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails) throw Error("DEPLOY_BROWSER_RENDER_ERROR");
      return r.result.value;
    };
    await command("Log.enable");
    await command("Runtime.enable");
    await command("Network.enable");
    await command("Page.enable");
    // Use the same one-use local-operator pairing flow as a normal browser.
    // Opening /ui/ unauthenticated first would correctly produce HTTP 401,
    // which is a false failure in the console-error acceptance assertion.
    const pairing = mintAdminPairCode(adminToken);
    await command("Page.navigate", { url: origin + "/ui/#pair=" + pairing });
    await until(() =>
      evaluate(
        'document.readyState==="complete" && document.getElementById("screen")?.textContent.includes("Gateway")',
      ),
    );
    assert.equal(
      await evaluate('document.getElementById("notice").className'),
      "",
    );
    assert.equal(
      await evaluate('document.getElementById("admin-credential").value'),
      "",
      "Successful pairing must not expose the Admin bearer token in JS",
    );
    const sections = [
      "overview",
      "monitor",
      "extensions",
      "skills",
      "instructions",
      "packs",
      "approvals",
      "audit",
      "connection",
      "settings",
    ];
    if(await evaluate(`Boolean(document.querySelector('nav button[data-tab="marketplace"]'))`))sections.splice(1,0,"marketplace");
    if (await evaluate('Boolean(document.querySelector(\'nav button[data-tab="security"]\'))')) sections.push("security");
    if (evidence) await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
    for (const width of [1280, 390]) {
      await command("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      for (const name of sections) {
        await evaluate("navigate(" + JSON.stringify(name) + ")");
        assert.equal(
          await evaluate('document.getElementById("notice").className'),
          "",
          "Live section error: " + name,
        );
        assert.equal(
          await evaluate("document.documentElement.scrollWidth<=innerWidth"),
          true,
          "Live page overflow",
        );
        if (evidence) {
          const shot = await command("Page.captureScreenshot", {
            format: "png",
          });
          await fs.writeFile(
            path.join(evidence, name + "-" + width + ".png"),
            Buffer.from(shot.data, "base64"),
          );
        }
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    assert.ok(!requests.some((u) => u.endsWith("/api/access")));
    assert.equal(
      await evaluate("localStorage.length+sessionStorage.length"),
      0,
    );
    await evaluate('document.getElementById("disconnect").click()');
    return {
      ok: true,
      sections,
      widths: [1280, 390],
      external_requests: 0,
      console_errors: 0,
      credential_reveal_requests: 0,
      mutations: 0,
    };
  } finally {
    ws?.close();
    if (browser && browser.exitCode === null) {
      const exited = new Promise((r) => browser.once("exit", r));
      try {
        process.platform === "win32"
          ? browser.kill()
          : process.kill(-browser.pid, "SIGTERM");
      } catch {}
      await Promise.race([exited, new Promise((r) => setTimeout(r, 1000))]);
      if (browser.exitCode === null) {
        try {
          process.platform === "win32"
            ? browser.kill("SIGKILL")
            : process.kill(-browser.pid, "SIGKILL");
        } catch {}
        await exited;
      }
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}
