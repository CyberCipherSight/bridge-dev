# Integration marketplace

The authenticated local dashboard has a **Marketplace** section. Search the
bundled snapshot, filter by category, maintainer, type, platform and state, and
page through 20 entries at a time. Browsing performs no external requests,
package installation or provider startup. `extensions_search` offers the same
metadata to MCP clients. Existing installed entries remain available through
`extensions_list`, `skills_list` and the Extensions/Skills sections.

## Verification levels

`profiles/marketplace.v1.json` is a versioned, validated snapshot containing 106
entries: 93 MCP packages, 10 skills and three CLI tools. It records primary source,
maintainer, declared license, pinned version/commit, prerequisites, permissions,
installation route, verification date and source-metadata digest. Repository existence, archive status and last-push dates were separately checked
against the GitHub API; seven packages with unavailable or placeholder repositories
were excluded. Metadata was
retrieved from npm, PyPI, the official GitHub server release, and Anthropic's
commit-pinned skills repository. A package publisher's repository/license claim
is provenance, not a security endorsement. Undeclared licenses, platforms,
credentials and runtime prerequisites explicitly require upstream review.

A metadata check does **not** establish a successful installation, compatible
platform, connection or callable tool inventory. Unmeasured MCP tool counts are
`null`; skill callable-tool counts are zero. Connection state comes from the
local provider manager, never from an advertised catalog count. Additional native
analysis engines and service credentials are not installed with a listing.

```sh
node scripts/verify-marketplace.mjs          # offline schema and catalog totals
node scripts/verify-marketplace.mjs --online # explicit metadata/version drift check
pnpm run test:marketplace                   # offline fixtures and real HTTP client
```

The online check never installs code. Its URL validation, bounded HTTPS download
and SSRF restrictions use the existing source fetcher. It reports version drift
instead of silently updating pins. Skills/source metadata require review against
the pinned source when refreshing this snapshot.

## Prefer existing ChatGPT connections

Order: suitable connected official ChatGPT plugin, suitable connected third-party
plugin, BridgeDev's local capabilities, reviewed BridgeDev MCP fallback, then a
new installation explicitly chosen by the operator. An explicit user preference
wins. BridgeDev cannot inspect ChatGPT account inventory and does not control
ChatGPT's internal routing. An available product is not a connected account.

The **Client integration preferences** form also covers GitHub, Drive, Gmail,
Calendar, Notion, Figma, Slack, Linear and Jira without inventing duplicate MCP
listings. Each entry's **Preferred Provider** form saves an operator-owned, version-1
`integration-preferences.json` under the BridgeDev state directory. Connection
availability defaults to **unknown**. Declare connection type and only the exact
capability names independently verified in that client, such as
`repositories.read`; this does not establish `repositories.write`. Prefer manual
selection when the client does not expose reliable capability information.

| Preference | Behavior |
| --- | --- |
| Auto / Prefer ChatGPT | Recommend a declared connected plugin for an exact supported capability; otherwise offer BridgeDev fallback |
| Prefer BridgeDev | Recommend the reviewed local provider; normal policy still applies |
| ChatGPT only | Offer no duplicate; refuse the explicitly bound local provider |
| BridgeDev only | Recommend local provider; normal policy still applies |
| Disabled | Offer neither; refuse the explicitly bound local provider |

Bind a registered provider explicitly before applying a local execution opt-out.
No provider names or connection states are inferred. Auto never silently disables
an existing provider or copies credentials. Preference edits are authenticated,
audited, atomic, locked and backed up; unknown future schemas fail closed. On
explicit opt-out, connections close, tools disappear and stale calls are denied.
MCP clients can inspect preferences but cannot edit or approve them.

## Reviewed setup without editing JSON

1. Inspect the catalog detail, requirements, license and permissions.
2. **Preview installation proposal** uses the existing source adapter and inert
   proposal/approval workflow. Review exact components, commit and digest.
3. Packages with transitive dependencies still require independent operator
   installation with hooks disabled. The existing installer intentionally refuses
   unreviewed dependency trees; it does not run `npx` or `uvx` silently.
4. **Configure installed executable or endpoint** provides typed fields for an
   already installed program, one argument per line, working directory, explicit
   non-secret environment values, HTTP URL, OAuth mode and an existing bearer
   environment reference. No shell interpolation. Registration starts disabled
   with no exposed tools. Never put credentials in arguments or source URLs.
5. Review and apply that disabled proposal in **Approvals**. In Extensions, test
   the connection, inspect tools and separately review exact enablement and tool
   permissions. Use Test Connection again to rediscover tools. Unsupported
   schemas are reported separately and never exposed.
6. Disable/remove/update through existing reviewed lifecycle actions. Changed
   executable/source/permissions require fresh review. [Source limits](SOURCES.md)
   remain in force. Native/bundled tools require no marketplace installation.

STRICT continues to refuse stdio providers without a reviewed OS sandbox. STANDARD
continues to require independent approval for X-class calls. A skill remains
untrusted guidance: loading it neither starts its MCP server nor grants execution.

Providers close on disable, removal and shutdown, with existing idle timeout and
process-tree cleanup. No polling or extra daemon is added. Clients that cache tool
lists may require a connector refresh/reconnect and a new chat.

See [REA connection and actual test scope](integrations/REA.md).

## Lifecycle regression fixes

Registry removal now resolves managed providers through their owning extension
scope, removing the managed lock entry and owned package content as well as the
provider registration. This prevents a later install from resurrecting a removed
provider. Failed connection tests retain a non-secret diagnostic in provider
status; a successful test clears it. Both paths are covered by the independent
HTTP lifecycle regression.
