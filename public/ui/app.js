"use strict";
// All untrusted values enter the document through textContent or form values.
// Credentials and theme are deliberately never stored in browser storage.
const $ = (id) => document.getElementById(id),
  screen = $("screen");
const sections = [
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
let section = "overview",
  health = {},
  extensions = {},
  auditOffset = 0,
  sorts = new Map(),
  pendingGo = 0;
function el(tag, text, attrs = {}) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = String(text);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else n.setAttribute(k, String(v));
  }
  return n;
}
function showError(error) {
  $("notice").textContent = error.message || String(error);
  $("notice").className = "error";
}
function notice(text) {
  $("notice").textContent = text;
  $("notice").className = "";
}
async function api(url, body, method) {
  const r = await fetch(url, {
    method: method || (body === undefined ? "GET" : "POST"),
    cache: "no-store",
    headers: {
      Authorization: "Bearer " + $("admin-credential").value,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || `HTTP ${r.status}`);
  return data.ok && Object.prototype.hasOwnProperty.call(data, "data")
    ? data.data
    : data;
}
function action(text, fn, attrs = {}) {
  const b = el("button", text, { type: "button", ...attrs });
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await fn();
    } catch (e) {
      showError(e);
    } finally {
      b.disabled = false;
    }
  });
  return b;
}
function pre(value) {
  return el(
    "pre",
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );
}
function heading(title, parent = screen) {
  parent.append(el("h2", title));
}
function details(title, ...nodes) {
  $("detail-title").textContent = title;
  $("detail-body").replaceChildren(...nodes);
  if (!$("detail").open) $("detail").showModal();
}
function pairs(values, parent = screen) {
  const dl = el("dl");
  for (const [k, v] of Object.entries(values)) {
    dl.append(
      el("dt", k),
      el(
        "dd",
        typeof v === "object" && v !== null
          ? JSON.stringify(v)
          : (v ?? "unavailable"),
      ),
    );
  }
  parent.append(dl);
}
function table(headers, rows, name = "table", parent = screen) {
  if (!rows.length) {
    parent.append(el("p", "No entries.", { class: "empty" }));
    return;
  }
  const wrapper = el("div", undefined, {
      class: "scroll",
      tabindex: "0",
      "aria-label": name,
    }),
    t = el("table"),
    head = el("thead"),
    hr = el("tr"),
    body = el("tbody");
  let sorted = [...rows];
  const ordering = sorts.get(name);
  if (ordering)
    sorted.sort(
      (a, b) =>
        String(
          a[ordering.col]?.textContent ?? a[ordering.col] ?? "",
        ).localeCompare(
          String(b[ordering.col]?.textContent ?? b[ordering.col] ?? ""),
          undefined,
          { numeric: true },
        ) * ordering.direction,
    );
  headers.forEach((h, i) => {
    const th = el("th", undefined, { scope: "col" });
    th.append(
      action(h, () => {
        const old = sorts.get(name);
        sorts.set(name, {
          col: i,
          direction: old?.col === i ? -old.direction : 1,
        });
        wrapper.remove();
        table(headers, rows, name, parent);
      }),
    );
    hr.append(th);
  });
  head.append(hr);
  for (const row of sorted) {
    const tr = el("tr");
    for (const value of row) {
      const td = el("td");
      value instanceof Node
        ? td.append(value)
        : (td.textContent = String(value ?? "—"));
      tr.append(td);
    }
    tr.dataset.filter = tr.textContent.toLowerCase();
    tr.hidden = !tr.dataset.filter.includes($("filter").value.toLowerCase());
    body.append(tr);
  }
  t.append(head, body);
  wrapper.append(t);
  parent.append(wrapper);
}
function controls(...buttons) {
  const n = el("div", undefined, { class: "actions" });
  n.append(...buttons);
  return n;
}
function state(value) {
  return value ? "yes" : "no";
}
async function refreshAll() {
  if (!$("admin-credential").value) {
    notice("Enter the independent admin credential.");
    return;
  }
  try {
    health = await api("/health");
    extensions = await api("/api/extensions");
    await render();
    notice("Loaded. Refresh is manual.");
  } catch (e) {
    showError(e);
  }
}
async function navigate(name) {
  stopActivity();
  section = name;
  $("title").textContent = name[0].toUpperCase() + name.slice(1);
  $("filter").value = "";
  document.querySelectorAll("nav button").forEach((b) => {
    if (b.dataset.tab === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  await refreshAll();
}
function addFlow(kind) {
  const form = el("form", undefined, { class: "add", id: "add-flow" }),
    row = el("div", undefined, { class: "actions" }),
    label = el("label", "Source", { for: "extension-source" }),
    input = el("input", undefined, {
      id: "extension-source",
      placeholder: "HTTPS URL, package or local path",
      required: "",
    }),
    scope = el("select", undefined, { "aria-label": "Install scope" });
  for (const s of ["project", "user"])
    scope.append(el("option", s, { value: s }));
  const b = el("button", "Detect", { id: "extension-discover" }),
    out = el("div", undefined, { id: "extension-preview" });
  row.append(label, input, scope, b);
  form.append(row, out);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    b.disabled = true;
    try {
      const r = await api("/api/extensions/discover", {
        source: input.value,
        scope: scope.value,
      });
      out.replaceChildren();
      await discovered(r, out, input.value, scope.value, kind);
    } catch (error) {
      out.replaceChildren(pre(error.message));
    } finally {
      b.disabled = false;
    }
  });
  screen.append(form);
}
async function discovered(data, parent, source, scope, kind) {
  if (data.id) {
    parent.append(
      pre({
        action: data.action,
        scope: data.scope,
        selection: data.selection,
        source: data.discovery?.source,
        resolved: data.discovery?.resolved,
        digest: data.discovery?.digest,
        permissions: data.discovery?.components?.map((c) => ({
          component: c.id,
          requirements: c.requirements,
          permissions: c.permissions,
          provider: c.provider,
        })),
        diff: data,
      }),
    );
    parent.append(
      action("Request operator approval", async () => {
        await navigate("approvals");
        notice("Exact proposal saved. Review and confirm in Approvals.");
      }),
    );
    return;
  }
  const inputs = [];
  parent.append(
    el("p", "Select components. Detection never executes repository commands."),
  );
  for (const c of data.components || []) {
    const check = el("input", undefined, {
      type: "checkbox",
      value: c.kind + ":" + c.id,
    });
    check.checked = !kind || c.kind === kind;
    const label = el("label", undefined, { class: "field" });
    label.append(check, el("span", c.kind + ":" + c.id));
    parent.append(
      label,
      pre({
        requirements: c.requirements,
        permissions: c.permissions,
        description: c.description,
      }),
    );
    inputs.push(check);
  }
  parent.append(
    action("Preview selection", async () => {
      const r = await api("/api/extensions/discover", {
        source,
        scope,
        selection: inputs.filter((i) => i.checked).map((i) => i.value),
      });
      parent.replaceChildren();
      await discovered(r, parent, source, scope, kind);
    }),
  );
}
async function render() {
  screen.replaceChildren();
  if (section === "overview") return overview();
  if (section === "extensions") return providers();
  if (["skills", "instructions", "packs"].includes(section)) return contents();
  if (section === "approvals") return approvals();
  if (section === "audit") return audit();
  if (section === "connection") return connection();
  if (section === "settings") return settings();
}
async function overview() {
  const [service, audit, queue] = await Promise.all([
    api("/api/service/status"),
    api("/api/audit?limit=1"),
    api("/api/extensions/proposals"),
  ]);
  pairs({
    Gateway: "● " + health.status,
    Version: health.version,
    Commit: health.commit || "unmarked source build",
    Runtime: health.runtime_mode,
    Policy: health.policy_mode,
    "Full Machine Access": state(health.full_machine_access),
    "Uptime (seconds)": health.uptime_seconds,
    Service: service.unit
      ? service.unit + " / " + service.state
      : "foreground or transient",
    "Service restarts": service.restarts ?? "unavailable",
    "MCP listener": "127.0.0.1:" + health.mcp_port,
    "Admin listener": location.host + " (local only)",
    "Public exposure": health.public_url || "none detected",
    "MCP connections": health.active_sessions,
    Audit: audit.integrity.entries + " entries / verified",
    "Rollback release": service.previous || "none recorded",
    Workspace: health.default_cwd,
  });
  heading("Pending approvals");
  screen.append(
    el(
      "p",
      `${queue.proposals.length} reviewed proposals; ${queue.requests.length} model requests.`,
    ),
    action("Open approvals", () => navigate("approvals")),
  );
  heading("Updates");
  screen.append(
    el(
      "p",
      "Updates are checked explicitly through each component’s Update preview. Service releases: bridge-dev service update <sha-or-tag>. No background registry requests.",
    ),
  );
}
async function providers() {
  addFlow("mcp");
  heading("MCP providers");
  const installed = new Set(
    (extensions.entries || [])
      .filter((e) => e.component.kind === "mcp")
      .map((e) => e.component.id),
  );
  table(
    [
      "Name",
      "Source",
      "Version / commit",
      "Installed",
      "Registered",
      "Enabled",
      "Connected",
      "Exposed",
      "Details",
    ],
    (extensions.providers || []).map((p) => {
      const entry = extensions.entries?.find((e) => e.component.id === p.id);
      return [
        p.name || p.id,
        entry?.source || p.url || p.transport,
        entry?.resolved || "registered endpoint",
        state(installed.has(p.id)),
        "yes",
        state(p.enabled),
        state(p.health === "connected"),
        p.proxied_tools?.length || 0,
        action("Inspect", () => providerDetails(p)),
      ];
    }),
    "MCP providers",
  );
  heading("Configuration import");
  screen.append(
    el(
      "p",
      "Cursor, Claude Code, OpenCode and compatible JSON files. Imported executables stay disabled until reviewed.",
    ),
  );
  const source = el("select", undefined, { "aria-label": "Import format" });
  for (const type of ["cursor", "claude", "opencode", "file"])
    source.append(el("option", type, { value: type }));
  const file = el("input", undefined, {
    placeholder: "Optional configuration path",
    "aria-label": "Import path",
  });
  screen.append(
    controls(
      source,
      file,
      action("Inspect available sources", async () =>
        details(
          "Detected configuration files",
          pre(await api("/api/import/sources")),
        ),
      ),
      action("Import disabled providers", async () => {
        if (
          !confirm(
            "Import these provider definitions as disabled? Existing provider permissions remain unchanged.",
          )
        )
          return;
        const r = await api("/api/import/" + source.value, {
          ...(file.value ? { path: file.value } : {}),
          enable: false,
          merge: true,
        });
        details("Import result", pre(r));
        await refreshAll();
      }),
    ),
  );
  screen.append(
    action("Advanced provider definition", () =>
      jsonEditor(
        "Provider definition",
        "/api/upstream",
        "server",
        "POST",
        {
          id: "",
          name: "",
          transport: "stdio",
          command: "",
          args: [],
          enabled: false,
          expose: "none",
        },
        true,
      ),
    ),
  );
}
async function providerDetails(p) {
  const tools = await api(
      "/api/extensions/provider-tools?name=" + encodeURIComponent(p.id),
    ),
    content = el("div");
  pairs(
    {
      Provider: p.id,
      Transport: p.transport,
      Health: p.health,
      "Last error": p.last_error || "none",
      Origin: "Untrusted provider metadata",
    },
    content,
  );
  content.append(pre(p));
  const allow = [];
  heading("Tool permissions", content);
  for (const tool of tools.tools || []) {
    const label = el("label", undefined, { class: "field" }),
      check = el("input", undefined, { type: "checkbox", value: tool.name });
    check.checked = (p.exposed_tools || p.proxied_tools || []).includes(
      tool.name,
    );
    label.append(
      check,
      el("span", tool.name + " — " + (tool.description || "")),
    );
    content.append(label);
    allow.push(check);
  }
  const permission = el("select", undefined, {
    "aria-label": "Granted tool permission",
  });
  for (const v of ["R", "W", "X"])
    permission.append(el("option", v, { value: v }));
  permission.value = "X";
  content.append(
    controls(
      permission,
      action("Preview allowlist", async () => {
        const proposal = await api("/api/extensions/provider-review", {
          name: p.id,
          enabled: Boolean(p.enabled),
          tools: allow.filter((x) => x.checked).map((x) => x.value),
          permission: permission.value,
        });
        details(
          "Permission proposal",
          pre(proposal),
          action("Open approvals", () => {
            $("detail").close();
            return navigate("approvals");
          }),
        );
      }),
      action(p.enabled ? "Preview disable" : "Preview enable", async () => {
        const proposal = await api("/api/extensions/provider-review", {
          name: p.id,
          enabled: !p.enabled,
          tools: allow.filter((x) => x.checked).map((x) => x.value),
          permission: permission.value,
        });
        details(
          "Lifecycle proposal",
          pre(proposal),
          action("Open approvals", () => {
            $("detail").close();
            return navigate("approvals");
          }),
        );
      }),
      action("Test connection", async () => {
        if (
          !confirm(
            "Connect to this reviewed provider? This can start its configured executable.",
          )
        )
          return;
        details(
          "Provider test",
          pre(await api("/api/extensions/provider-test", { name: p.id })),
        );
      }),
      action("Logs", async () =>
        details(
          "Provider logs",
          pre(
            await api(
              "/api/extensions/provider-logs?name=" + encodeURIComponent(p.id),
            ),
          ),
        ),
      ),
      action("Edit definition", async () => {
        const cfg = await api("/api/upstream");
        const server = cfg.config.servers.find((s) => s.id === p.id);
        await jsonEditor(
          "Provider definition",
          "/api/upstream",
          "server",
          "POST",
          server,
          true,
        );
      }),
    ),
  );
  if (p.transport === "http")
    content.append(
      controls(
        action("OAuth status", async () =>
          details(
            "OAuth status",
            pre(
              await api(
                "/api/upstream/" + encodeURIComponent(p.id) + "/oauth/status",
              ),
            ),
          ),
        ),
        action("Start OAuth", async () => {
          if (!confirm("Start this provider’s OAuth flow?")) return;
          const r = await api(
            "/api/upstream/" + encodeURIComponent(p.id) + "/oauth/start",
            { reset: true },
          );
          const url = r.status?.authorization_url;
          if (url && /^https?:/.test(url)) {
            const a = el("a", "Open provider authorization", {
              href: url,
              target: "_blank",
              rel: "noopener noreferrer",
            });
            details("OAuth authorization", a);
          } else details("OAuth status", pre(r));
        }),
        action("Disconnect OAuth", async () => {
          if (confirm("Disconnect provider authorization?"))
            details(
              "OAuth disconnected",
              pre(
                await api(
                  "/api/upstream/" +
                    encodeURIComponent(p.id) +
                    "/oauth/disconnect",
                  {},
                ),
              ),
            );
        }),
      ),
    );
  const entry = extensions.entries?.find((e) => e.key === "mcp:" + p.id);
  if (entry) content.append(controls(...entryActions(entry)));
  else
    content.append(
      action("Remove registered provider", async () => {
        const proposal = await api("/api/extensions/provider-remove", {
          name: p.id,
        });
        details(
          "Removal proposal",
          pre(proposal),
          action("Open approvals", () => {
            $("detail").close();
            return navigate("approvals");
          }),
        );
      }),
    );
  details("Provider: " + p.id, content);
}
function entryActions(e) {
  return ["update", e.enabled ? "disable" : "enable", "remove"].map((name) =>
    action("Preview " + name, async () => {
      const p = await api("/api/extensions/action", {
        action: name,
        key: e.key,
        scope: e.scope,
      });
      details(
        "Extension proposal",
        pre(p),
        action("Open approvals", () => {
          $("detail").close();
          return navigate("approvals");
        }),
      );
    }),
  );
}
async function contents() {
  const kind = { skills: "skill", instructions: "instructions", packs: "pack" }[
    section
  ];
  addFlow(kind);
  const entries = (extensions.entries || []).filter(
    (e) => e.component.kind === kind,
  );
  const validations =
    kind === "skill" ? await api("/api/extensions/validate") : null;
  table(
    [
      "Name",
      "Source",
      "Version / commit",
      "Scope",
      "Enabled",
      "Validation",
      "Details",
    ],
    entries.map((e) => [
      e.component.id,
      e.source,
      e.resolved,
      e.scope + (e.overrides_user ? " (overrides user)" : ""),
      state(e.enabled),
      validations?.results?.find((v) => v.key === e.key)?.valid === false
        ? "invalid"
        : kind === "skill"
          ? "valid"
          : "reviewed content",
      action("Inspect", async () => {
        const content = el("div");
        content.append(
          el(
            "p",
            "Untrusted guidance. Content is displayed as plain text; it cannot grant permissions.",
          ),
        );
        pairs(
          {
            Source: e.source,
            Resolved: e.resolved,
            Digest: e.digest,
            Scope: e.scope,
          },
          content,
        );
        for (const [name, text] of Object.entries(e.component.files || {})) {
          heading(name, content);
          content.append(pre(text));
        }
        content.append(controls(...entryActions(e)));
        details(e.key, content);
      }),
    ]),
    section,
  );
  if (section === "instructions") {
    heading("Project context");
    screen.append(
      action("Load instruction snapshot", async () => {
        const r = await api("/api/instructions/preview");
        details("Project context", pre(r.summary), pre(r.preview));
      }),
    );
  }
}
async function approvals() {
  const r = await api("/api/extensions/proposals");
  screen.append(el("p", r.native_approvals));
  heading("Model requests");
  table(
    ["Created", "Action", "Source / key", "Review"],
    r.requests.map((q) => [
      new Date(q.created_at).toISOString(),
      q.action,
      q.source || q.key,
      action("Inspect and prepare", async () => {
        const p = await api("/api/extensions/review", { id: q.id });
        details(
          "Request review",
          pre(p),
          action("Refresh approvals", () => {
            $("detail").close();
            return refreshAll();
          }),
        );
      }),
    ]),
    "Model requests",
  );
  heading("Operator proposals");
  table(
    ["Created", "Action", "Scope", "Source / key", "Decision"],
    r.proposals.map((p) => [
      new Date(p.created_at).toISOString(),
      p.action,
      p.scope,
      p.discovery?.source || p.key,
      action("Review exact proposal", () => {
        const content = el("div");
        content.append(
          pre(p),
          controls(
            action(
              "Approve and apply",
              async () => {
                if (
                  !confirm(
                    "Apply this exact proposal? Executable providers require separately reviewed enablement and tool permissions.",
                  )
                )
                  return;
                await api("/api/extensions/apply", { id: p.id });
                $("detail").close();
                await refreshAll();
                notice("Applied reviewed proposal.");
              },
              { id: "extension-approve" },
            ),
            action("Reject", async () => {
              if (!confirm("Reject this proposal?")) return;
              await api("/api/extensions/reject", { id: p.id });
              $("detail").close();
              await refreshAll();
            }),
          ),
        );
        details("Operator approval", content);
      }),
    ]),
    "Operator proposals",
  );
}
async function audit() {
  const r = await api(
    "/api/audit?offset=" +
      auditOffset +
      "&filter=" +
      encodeURIComponent($("filter").value),
  );
  pairs({
    Integrity: r.integrity.ok ? "verified" : "FAILED",
    Entries: r.integrity.entries,
    Showing: `${r.offset + 1}–${Math.min(r.offset + r.limit, r.total)} of ${r.total}`,
  });
  screen.append(
    controls(
      action("Previous", async () => {
        auditOffset = Math.max(0, auditOffset - 50);
        await render();
      }),
      action("Next", async () => {
        auditOffset = Math.min(Math.max(0, r.total - 1), auditOffset + 50);
        await render();
      }),
      action("Filter ledger", () => {
        auditOffset = 0;
        return render();
      }),
    ),
  );
  table(
    ["Time", "Actor / session", "Action", "Outcome", "Details"],
    r.entries.map((e) => [
      e.time,
      e.actor || e.session || "gateway",
      e.phase || e.tool || "event",
      e.outcome || e.status || e.decision || "recorded",
      action("Inspect redacted record", () => details("Audit record", pre(e))),
    ]),
    "Audit records",
  );
  heading("Runtime activity");
  screen.append(action("Load activity and history", activityDialog));
}
let activityAbort = null,
  activityWanted = false,
  activityResume = null;
function stopActivity() {
  activityWanted = false;
  activityAbort?.abort();
  activityAbort = null;
  activityResume = null;
}
async function activityDialog() {
  const content = el("div"),
    kind = el("select", undefined, { "aria-label": "Activity kind" }),
    status = el("select", undefined, { "aria-label": "Activity status" }),
    search = el("input", undefined, {
      "aria-label": "Activity search",
      placeholder: "Tool or text",
    }),
    view = el("div");
  for (const value of ["all", "tool", "mcp", "session", "system"])
    kind.append(el("option", value, { value }));
  for (const value of ["all", "ok", "error", "blocked"])
    status.append(el("option", value, { value }));
  let rows = [];
  const render = () => {
    view.replaceChildren();
    table(
      ["Time", "Kind", "Tool / action", "Status", "Summary"],
      rows
        .filter(
          (r) =>
            (kind.value === "all" || r.kind === kind.value) &&
            (status.value === "all" || r.status === status.value) &&
            JSON.stringify(r)
              .toLowerCase()
              .includes(search.value.toLowerCase()),
        )
        .map((r) => [
          r.time,
          r.kind,
          r.tool || r.action,
          r.status,
          r.summary || r.target || "",
        ]),
      "Runtime activity",
      view,
    );
  };
  const live = action(
    "Live: off",
    () => {
      if (activityWanted) {
        stopActivity();
        live.textContent = "Live: off";
        return;
      }
      activityWanted = true;
      live.textContent = "Live: on";
      activityResume = start;
      start();
    },
    { id: "activity-live" },
  );
  const start = () => {
    if (document.visibilityState === "hidden" || !activityWanted) return;
    activityAbort?.abort();
    const controller = new AbortController();
    activityAbort = controller;
    void (async () => {
      try {
        const response = await fetch("/api/activity/stream", {
          headers: { Authorization: "Bearer " + $("admin-credential").value },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw Error("Activity stream refused");
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let pending = "";
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          pending += decoder.decode(chunk.value, { stream: true });
          if (pending.length > 131072) throw Error("Activity event size limit");
          let end;
          while ((end = pending.indexOf("\n\n")) >= 0) {
            const frame = pending.slice(0, end);
            pending = pending.slice(end + 2);
            if (frame.startsWith("data: ")) {
              rows = [JSON.parse(frame.slice(6)), ...rows].slice(0, 100);
              render();
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) showError(error);
      }
    })();
  };
  for (const field of [kind, status, search])
    field.addEventListener("input", render);
  content.append(
    controls(
      kind,
      status,
      search,
      action("Refresh activity", async () => {
        rows = (await api("/api/activity?limit=100")).entries;
        render();
      }),
      live,
      action("Load durable history", async () => {
        rows = (await api("/api/activity/history?limit=100")).entries;
        render();
      }),
      action("Clear this view", () => {
        rows = [];
        render();
      }),
    ),
    el(
      "p",
      "Live is opt-in and pauses while hidden. Clearing this view does not change the ledger.",
    ),
    view,
  );
  details("Runtime activity", content);
  rows = (await api("/api/activity?limit=100")).entries;
  render();
}
async function connection() {
  pairs({
    "MCP endpoint":
      (health.public_url || "http://127.0.0.1:" + health.mcp_port) + "/mcp",
    "Admin UI": location.origin + "/ui/",
    Authentication: "Independent MCP bearer credential or explicit URL token",
    Exposure:
      "Funnel configuration is unchanged by service commands. A stopped gateway yields public upstream errors.",
  });
  screen.append(
    el(
      "p",
      "ChatGPT: reconnect the connector, then start a new chat. Codex and Claude: configure the MCP endpoint with a bearer credential in their protected configuration. Clients may cache tool lists; reconnect to refresh.",
    ),
  );
  const input = el("input", undefined, {
    id: "connection-url",
    readonly: "",
    "aria-label": "Connection URL (credential hidden)",
  });
  input.value =
    (health.public_url || "http://127.0.0.1:" + health.mcp_port) + "/mcp";
  screen.append(
    input,
    controls(
      action("Reveal URL credential", async () => {
        if (
          !confirm(
            "Reveal the MCP credential in this page’s memory? Keep this screen private.",
          )
        )
          return;
        const r = await api("/api/access");
        input.value =
          (health.public_url || "http://127.0.0.1:" + health.mcp_port) +
          "/mcp/" +
          r.mcp_token;
        input.setAttribute(
          "aria-label",
          "Connection URL with revealed credential",
        );
      }),
      action("Hide credential", () => {
        input.value =
          (health.public_url || "http://127.0.0.1:" + health.mcp_port) + "/mcp";
      }),
      action("Copy displayed URL", () =>
        navigator.clipboard.writeText(input.value),
      ),
    ),
  );
  heading("Acceptance in a new chat");
  screen.append(
    pre(
      '1. Check the tool list.\n2. system_context({docs:["agents","current_state"]})\n3. run_command({command:"pwd"})\n4. mcp_list({})\n5. skills_validate({})',
    ),
  );
}
async function jsonEditor(
  title,
  url,
  key,
  method = "PUT",
  initial,
  forceDisabled = false,
) {
  const r = initial === undefined ? await api(url) : null;
  let value = initial ?? r[key];
  if (key === "values")
    value = Object.fromEntries(
      Object.entries(value || {}).filter(([key]) =>
        [
          "CHATGPT_TOOL_PROFILE",
          "SHELL_TIMEOUT",
          "CHECKPOINT_ENABLED",
        ].includes(key),
      ),
    );
  const text = el("textarea", undefined, {
    "aria-label": title + " JSON",
    spellcheck: "false",
  });
  text.value = JSON.stringify(value, null, 2);
  const preview = el("div"),
    content = el("div");
  content.append(
    el(
      "p",
      "Validate and review the exact diff before applying. Protected authentication, policy and signing settings require an offline operator change.",
    ),
    text,
    action("Preview changes", () => {
      const next = JSON.parse(text.value);
      if (!next || typeof next !== "object" || Array.isArray(next))
        throw Error("Expected a JSON object.");
      if (forceDisabled) {
        next.enabled = false;
        next.expose = "none";
        if (JSON.stringify(next).includes("[REDACTED]"))
          throw Error(
            "Redacted credentials cannot be resubmitted. Use the protected operator configuration.",
          );
      }
      preview.replaceChildren(
        pre({ before: value, after: next }),
        action("Confirm and apply", async () => {
          if (!confirm("Apply these exact reviewed settings?")) return;
          const result = await api(url, { [key]: next }, method);
          details("Settings result", pre(result));
        }),
      );
    }),
    preview,
  );
  details(title, content);
}
async function settings() {
  const service = await api("/api/service/status");
  heading("Service (read only)");
  pairs({
    Unit: service.unit || "not installed",
    State: service.state || "unmanaged",
    Commit: service.current || health.commit,
    Restarts: service.restarts ?? "unavailable",
    Linger: service.linger_status || "unavailable",
    Rollback: service.previous || "none",
  });
  screen.append(
    pre(
      "bridge-dev service status\nbridge-dev service restart\nbridge-dev service update <sha-or-tag>\nbridge-dev service rollback",
    ),
  );
  heading("Configuration");
  screen.append(
    controls(
      action("Safe environment settings", () =>
        jsonEditor("Environment settings", "/api/config/env", "values"),
      ),
      action("Local tool visibility", () =>
        jsonEditor("Local tools", "/api/local-tools", "overrides"),
      ),
      action("Computer use plugin", async () => {
        const r = await api("/api/plugins");
        if (!r.available.computer_use) {
          details("Computer use", el("p", "Unsupported on this platform."));
          return;
        }
        return jsonEditor("Computer use plugin", "/api/plugins", "config");
      }),
      action("Trusted Codex hooks", async () => {
        const r = await api("/api/codex-hooks"),
          container = el("div"),
          checks = [];
        for (const hook of r.hooks) {
          const label = el("label", undefined, { class: "field" }),
            check = el("input", undefined, {
              type: "checkbox",
              value: hook.id,
            });
          check.checked = hook.enabled;
          check.disabled = !hook.supported;
          label.append(
            check,
            el("span", hook.plugin + " / " + hook.event + " / " + hook.command),
          );
          container.append(label);
          checks.push(check);
        }
        container.append(
          action("Preview hook selection", () => {
            const enabled = checks.filter((c) => c.checked).map((c) => c.value);
            details(
              "Hook preview",
              pre({ enabled }),
              action("Confirm hook selection", async () => {
                if (confirm("Enable this exact trusted hook selection?"))
                  details(
                    "Hooks saved",
                    pre(await api("/api/codex-hooks", { enabled }, "PUT")),
                  );
              }),
            );
          }),
        );
        details("Trusted hooks", container);
      }),
    ),
  );
  heading("Raw status");
  screen.append(pre(health));
}
$("login").addEventListener("submit", (e) => {
  e.preventDefault();
  void refreshAll();
});
$("refresh").addEventListener("click", () => void refreshAll());
$("disconnect").addEventListener("click", () => {
  stopActivity();
  $("admin-credential").value = "";
  health = {};
  extensions = {};
  screen.replaceChildren();
  $("detail").close();
  $("detail-body").replaceChildren();
  notice("Disconnected. Credentials cleared from this page.");
});
document
  .querySelectorAll("nav button")
  .forEach((b) =>
    b.addEventListener("click", () => void navigate(b.dataset.tab)),
  );
$("filter").addEventListener("input", () =>
  screen
    .querySelectorAll("tr[data-filter]")
    .forEach(
      (r) =>
        (r.hidden = !r.dataset.filter.includes(
          $("filter").value.toLowerCase(),
        )),
    ),
);
$("help").addEventListener("click", () => $("help-dialog").showModal());
$("theme").addEventListener("click", () => {
  const themes = ["system", "light", "dark"],
    next =
      themes[
        (themes.indexOf(document.documentElement.dataset.theme || "system") +
          1) %
          3
      ];
  if (next === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  $("theme").textContent = "Theme: " + next;
});
document.addEventListener("keydown", (e) => {
  if (
    e.ctrlKey ||
    e.altKey ||
    e.metaKey ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
  )
    return;
  if (e.key === "g") {
    pendingGo = Date.now();
    return;
  }
  if (
    Date.now() - pendingGo < 1000 &&
    { o: "overview", e: "extensions", s: "skills", a: "approvals" }[e.key]
  ) {
    pendingGo = 0;
    e.preventDefault();
    void navigate(
      { o: "overview", e: "extensions", s: "skills", a: "approvals" }[e.key],
    );
    return;
  }
  if (e.key === "/") {
    e.preventDefault();
    $("filter").focus();
  }
  if (e.key === "?") $("help-dialog").showModal();
});
// Legacy fragment handoff remains supported; immediately remove it from history.
if (location.hash || location.search) {
  const params = new URLSearchParams(location.hash.slice(1)),
    credential = params.get("token") || params.get("admin_token");
  history.replaceState(null, "", location.pathname);
  if (credential) $("admin-credential").value = credential;
}
if ($("admin-credential").value) void refreshAll();

$("detail").addEventListener("close", stopActivity);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    activityAbort?.abort();
    activityAbort = null;
  } else if (activityWanted && $("detail").open && section === "audit")
    activityResume?.();
});
