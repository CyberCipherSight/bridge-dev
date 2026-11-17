# Reverse Engineer Anything

Official source: [morluto/rea](https://github.com/morluto/rea). Reviewed package:
`rea-agents@6.9.0`, MIT, requiring Node `^22.23.4 || ^24.22.1 || >=26.12.1`.
The supported public launcher is `rea mcp`. Keep the independently installed
package in a version-pinned location; do not use an unpinned package runner.

The installed `reverse-engineer-anything/SKILL.md` is guidance only. Installing or
loading it does not register the executable server. An existing direct REA plugin
in Codex or ChatGPT is another connection, not evidence of a BridgeDev upstream.
Prefer that connection unless BridgeDev routing is explicitly requested.

## Configure

In Marketplace, inspect Reverse Engineer Anything, then **Configure installed
executable or endpoint**. Use stdio, ID `rea`, the absolute Node executable,
arguments `/absolute/version-pinned/rea-agents/scripts/rea.mjs` and `mcp` on
separate lines. Set the documented non-secret environment setting:

```text
REA_MCP_OUTPUT_SCHEMA_PROFILE=compact
```

REA's default complete discovery frame exceeds BridgeDev's 4 MiB stdio limit.
Its documented compact output profile bounds advertised schemas while REA still
validates complete results internally. Do not turn output schemas off, raise the
transport limit or disable gateway schema checks to conceal incompatibility.
Use a separate explicitly granted data/home directory if the provider needs one;
it inherits no gateway tokens or arbitrary gateway environment.

Review the disabled registration, Test Connection, inspect accepted and rejected
tools, then review enablement and per-tool permissions. No Ghidra, Hopper, JADX,
Frida, Android tools or other optional engines are installed automatically.

## Verified isolated acceptance

The installed 6.9.0 server advertises **255 tools** (not the older skill's 207).
The previous gateway's blanket regex refusal accepted 190 and rejected 65:
60 tools contained a JSON Schema regex `pattern` keyword and five had a plain
input property **named** `pattern`, mistakenly treated as a keyword.

The repaired validator now admits **249 tools**. It compiles only anchored,
bounded, conservative ECMAScript-Unicode expressions with no lookarounds,
backreferences, ambiguous repeated groups or more than one variable-width
quantifier. Original input and output `pattern`, type, required, enum and bounds
remain enforced by Ajv. All 19 distinct REA expressions compiled in both
JavaScript Unicode and non-Unicode mode; no Python regex translation was needed.
Bounded finite local references remain supported; remote/dynamic references,
recursive expansion and unsafe regex expressions remain refused.

The final six rejections are intentional:

| Cause | Count | Tool names |
| --- | ---: | --- |
| Regex exceeds conservative complexity bound | 2 | `trace_dylib_resolution`, `capture_process_scenario` |
| Nested variable-width repetition | 4 | `inspect_adb_package`, `uninstall_adb_package`, `start_adb_app`, `stop_adb_app` |

This is a **63-tool net improvement** in validated inventory (190 → 249).
No regex constraints were deleted and no relaxation was automatically approved.
Those six can only be added after a separate, reviewable safety design; a valid
JavaScript regex is not by itself evidence of linear-time evaluation.

An independent HTTP MCP SDK client discovered and invoked these three explicitly
allowlisted read-only tools, with SDK output-schema validation enabled:

- `rea__search_guidance` (returned an installed-guidance match)
- `rea__read_guidance_section` (loaded the returned locator)
- `rea__guided_workflows` (`action: list`)

Other accepted schemas are not execution approval. Native analysis requiring
additional engines remains unverified. ChatGPT account-side discovery/invocation
requires the operator's reconnect and account acceptance.

**Full compatible tool exposure:** `bridge-dev mcp enable rea` prepares an
operator-review proposal for all 249 currently schema-valid REA 6.9.0 tools,
once the new release is installed and the provider has been retested.
It pins the exact names, preserves previously reviewed R/W/X classes, and assigns
X (approval required) to newly selected names. Once independently approved,
the selection persists across restarts. A provider version with new tools needs
a fresh review. Earlier 190-tool proposals do **not** automatically acquire the
newly compatible tools; replace the proposal with a reviewed fresh snapshot.

An optional real REA test without installation or production changes is:

```sh
node scripts/test-rea-full-provider.mjs /absolute/reviewed/rea-agents/scripts/rea.mjs
```

The updated isolated acceptance verifies 249 proxies plus 52 native tools,
a successful
guidance call, and denial of an unapproved executable-class tool. It does not
establish that all optional binary-analysis engines are installed or that the
ChatGPT account has refreshed and accepted the full new inventory.

The same isolated gateway also discovered 15 tools from the official filesystem
server 2.3.0, invoked its single approved `read_text_file`, and denied its
unapproved write tool. Both providers were disabled and their processes cleaned
up. These results do not establish production deployment or live ChatGPT use.

Reproduce without fetching packages during the test:

```sh
node scripts/test-reviewed-providers.mjs \
  /absolute/reviewed/rea-agents/scripts/rea.mjs \
  /absolute/reviewed/server-filesystem/dist/index.js
```

The harness uses random ports, disposable credentials, HOME/XDG/state/workspace
and operator-reviewed local executables. Package acquisition is a separate,
explicit operator action; tests never fetch packages or analysis engines.

## Managed YOLO and the reviewed REA selection

With the independently signed YOLO lease active, BridgeDev now honors R/W/X
classifications from enabled, operator-reviewed MCP providers. The original
proposal pins 190 names; a newly reviewed proposal can pin up to 249 after this
release. The prior three guidance methods retain R; other tools default to X.
The signed mode permits use of that approved tool
selection without reauthorizing each tool name, but does **not** elevate REA's
OS process to root or install missing analysis engines.

After the operator runs `bridge-dev update`, approve the exact REA provider
proposal in the local Dashboard → Approvals (or with the operator-authorized
CLI). Refresh/reconnect the ChatGPT BridgeDev connection to obtain the expanded
tool list. Live client-side invocation and any binary-analysis backend remain
separate acceptance steps. Moving back to STANDARD intentionally restores the
independent managed policy rather than trusting unprivileged provider metadata.
