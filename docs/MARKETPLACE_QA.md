# Marketplace QA checkpoint

Source baseline: `7415a52c6eed8931bec819e46a950ee5e7256100` on main.
Work used a separate checkout; five pre-existing UI/service edits in the original
checkout were preserved and compared by SHA-256. Production was inspected
independently: portable STANDARD, Full Machine Access false, zero MCP providers,
and one enabled REA guidance skill. Skill installation did not establish MCP
connectivity.

## Defects reproduced and repaired

| Defect | Evidence and repair |
| --- | --- |
| Missing REA upstream | Direct REA was available to Codex but BridgeDev's registry was empty. A separate reviewed, pinned MCP registration is required; the skill remains independent. |
| Incompatible discovery/schema | REA 6.9.0 advertised 255 tools and a 4,655,064-byte complete discovery payload. Its documented compact output profile fits the existing transport limit. Bounded local schema references work; unsafe/unsupported tools are refused individually. |
| Removed provider resurrection | Registry-only removal left a managed lock entry, allowing later installs to reintroduce the provider. Removal now uses the owning extension scope and removes the entry/content. |
| Initial manifest race | A real delayed stdio fixture was missing from the first HTTP `tools/list`. The session now waits for its bounded discovery promise on list requests, without moving authorization or delaying initialize/native calls. The negative control fails without that barrier; independent clients pass with it. |
| Lost test diagnostic | Failed provider tests were not retained in status. A non-secret diagnostic is retained and cleared by a successful test. |
| Broken Git commit pins | Cloning with a commit as `--branch` failed. Disposable bare fetch now resolves the requested commit, verifies exact hash pins, and supports literal scoped GitHub directories. Encoded traversal is rejected before URL normalization. |
| Assumed connection identity | Catalog names are not proof of provider identity. State uses pinned installed provenance or explicit operator binding, and plugin availability starts unknown. |
| CLI versus MCP ambiguity | Developer CLI catalog entries do not become MCP registrations. They show an explicit independent-setup blocker rather than guessing an MCP entrypoint. |

## Local verification

Build, `pnpm test`, `test:policy`, `test:portable`, `test:cli`, `test:extensions`,
`test:integration`, `test:all`, `test:browser`, `test:marketplace`, `test:sources`
and the native tool-count manifest check passed. The baseline full suite passed
before edits. A removal regression found during expanded testing was repaired;
no existing test was disabled or weakened.

Offline catalog/HTTP tests cover 106 entries, unknown plugin inventory, exact
capability fallback, all preference overrides, explicit provider binding,
duplicate suppression, inert proposals, authenticated approval, stale-manifest
denial, malformed preferences failing closed, local reference bounds, rejected
regex/remote references, provider removal and error status. Tests use temporary
HOME/XDG/state/workspaces, random ports and local mock providers; they fetch no
public repositories or packages.

Real browser QA covers ten sections, search, default unknown availability,
preference forms, keyboard/control names, light/dark themes and 1280/390 widths.
Existing hostile metadata/content/audit checks and no-external-request,
no-console-error and memory-only credential checks remain enabled.

Separate, explicit real-package acceptance used synthetic credentials and an
independent MCP HTTP SDK client with output-schema validation. REA 6.9.0 accepted
190 schemas, rejected 65, and exposed/invoked three read-only guidance tools.
The official filesystem server 2.3.0 discovered 15 tools, exposed/invoked one
read tool and denied an unapproved write. Both providers were disabled and their
process trees removed. The pinned REA npm archive was SHA-512 integrity-verified,
with bounded extraction and no hooks or optional engine installation.

Separate manual real-source acceptance imported the commit-pinned Anthropic
brand-guidelines GitHub directory, enabled and loaded it, then disabled and
removed it from disposable state. Its two files and exact source hash matched.
Metadata verification is distinct from executable installation and invocation.

## Operational limits

Catalog JSON is loaded lazily and cached; pages are bounded to 50 entries and the
UI requests 20. Browsing starts no provider and creates no resident service.
The catalog file is about 230 KiB. Existing process, schema, download, timeout,
idle and connection limits remain. No application dependencies were added.

65 REA schemas remain intentionally refused. Other accepted REA tools require
separate operator tool permissions and, where applicable, analysis engines.
Packages with unreviewed transitive dependencies require independent operator
installation. Production deployment is a separate exact-SHA CI/artifact/update
gate; ChatGPT account acceptance requires the operator's reconnect and test.
