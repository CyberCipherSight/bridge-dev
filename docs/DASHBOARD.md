# Local operations interface

Open `http://127.0.0.1:3001/ui/` locally and enter the independent admin credential.
The admin listener is loopback-only and must not be exposed through Funnel.
Credentials, revealed MCP URLs and manual theme choice remain in page memory;
disconnect/reload clears them. No browser storage, web fonts or external assets
are used. Refresh is manual; there is no dashboard polling loop. Runtime activity
retains an opt-in live stream, paused while hidden and closed on leaving its view.

| Section | Functions |
| --- | --- |
| Overview | Runtime/commit, policy, Full Machine Access, listeners/exposure, sessions, uptime, service/restarts, audit integrity, rollback and pending approvals |
| Extensions | Source detection and component selection, requirements/permission preview, installed/registered/enabled/connected/exposed states, provider tools/permissions, lifecycle proposals, tests/logs, OAuth and disabled configuration imports |
| Skills | Source import, user/project precedence, validation, provenance, plain-text content and lifecycle proposals |
| Instructions | Instruction imports/content plus existing project instruction snapshot |
| Packs | Pack import, provenance, members and lifecycle proposals |
| Approvals | Model requests, exact operator proposals, explicit apply/reject confirmation; native signatures stay in the independent operator CLI |
| Audit | Explicit integrity verification, filter/pagination, redacted records and existing runtime activity/durable history |
| Connection | Endpoint and client refresh guidance; MCP credential revealed only after an explicit confirmed request to the authenticated no-store route |
| Settings | Read-only service state, validated/diff-previewed safe runtime settings, local tools, computer-use plugin, trusted hooks and raw status |

The old eight screens map to these nine sections. Import/OAuth/server editing
remain under Extensions; Project Context moved to Instructions; Raw Status moved
to Settings; Activity is accessible under Audit. Editing a raw provider definition
saves it disabled/unexposed so execution and tool permissions receive a separate
review. Existing API routes remain available. Native command requests cannot be
signed from MCP or this browser page. Service restarts/updates use the CLI.

Shortcuts: `g` then `o/e/s/a` selects Overview/Extensions/Skills/Approvals; `/`
focuses the section filter; `?` opens help; Escape closes dialogs. All controls
have accessible names, visible focus and normal tab navigation. Tables scroll in
their own containers on narrow screens; column headings sort. System colour
preference is the default; Theme cycles system/light/dark in memory only.

The interface uses system fonts, flat surfaces and text states. External strings
(provider names/errors/descriptions, URLs, Markdown and audit fields) are inserted
with `textContent` or form values. Markdown is plain text, never executable HTML.
Host/origin/CSRF protection and strict same-origin script CSP are retained; API
writes require admin authentication and never use GET. Provider tool inspection
reads the cache; the explicit confirmed POST connection test refreshes discovery.

`pnpm run test:browser` uses an existing Chromium browser selected by
`BRIDGEDEV_TEST_BROWSER` and CDP, without a new dependency. It tests the real
local discovery/approval flow, all sections at desktop/phone sizes, hostile text,
keyboard controls, memory-only secrets and zero external page requests/console
errors. Optional `BRIDGEDEV_BROWSER_EVIDENCE` retains screenshots. Accessible names,
focus/keyboard operation, overflow and palette contrast are checked; axe and a
screen-reader audit are not claimed. Historical and current screenshots are
private QA artifacts, not credential-bearing repository assets.
