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

The installed 6.9.0 server advertised **255** tools, rather than the older skill's
207. With its compact output profile, BridgeDev accepted **190** schemas and
refused **65** under existing regex, schema-depth and metadata limits. Bounded,
finite local definition references now work; remote/dynamic references,
recursive expansion and untrusted regex remain refused. Unsupported tools are
reported in the provider detail; they are never described as callable.

An independent HTTP MCP SDK client discovered and invoked these three explicitly
allowlisted read-only tools, with SDK output-schema validation enabled:

- `rea__search_guidance` (returned an installed-guidance match)
- `rea__read_guidance_section` (loaded the returned locator)
- `rea__guided_workflows` (`action: list`)

Other accepted schemas are not execution approval. Native analysis requiring
additional engines remains unverified. ChatGPT account-side discovery/invocation
requires the operator's reconnect and account acceptance.

**Full compatible tool exposure:** `bridge-dev mcp enable rea` now prepares an
operator-review proposal for all 190 currently schema-valid REA 6.9.0 tools.
It pins the exact names, preserves previously reviewed R/W/X classes, and assigns
X (approval required) to newly selected names. Once independently approved,
the selection persists across restarts. A provider version with new tools needs
a fresh review. All 65 rejected REA tools contained untrusted regex `pattern`
constraints; the gateway does not disable validation to expose them.

An optional real REA test without installation or production changes is:

```sh
node scripts/test-rea-full-provider.mjs /absolute/reviewed/rea-agents/scripts/rea.mjs
```

It independently verified 190 proxies plus 52 native tools, a successful
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
