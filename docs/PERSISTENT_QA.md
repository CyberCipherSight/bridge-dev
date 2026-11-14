# Persistent service and local dashboard QA

Dated verification: 2026-11-15 (local workstation). No dependency was added.
The starting source was `848f1ed`; the running portable transient release was
`64ca2b6`. The original checkout's six dirty files were preserved byte-for-byte;
implementation used a separate main checkout.

## Confirmed findings and fixes

- The transient gateway had `Restart=no`, no enabled unit and no resource limits.
  The generated user service adds bounded restart/backoff, graceful group cleanup,
  resource limits, persistent release pointers and recoverable update receipts.
- The overview fetched and displayed the MCP credential automatically. It now
  uses a separate explicit confirmed reveal, with memory-only credentials and
  no-store responses. The dashboard is plain DOM/CSS with nine sections.
- Detailed MCP health exposed workspace/runtime information without authentication.
  `/healthz` now returns only `{"ok":true}`; detailed health requires its bearer.
- Runtime tool/plugin/hook settings previously wrote under working/release paths.
  Validated schema-1 settings now use protected writable state and atomic backups.
  Environment editing never rewrites the credential file. Invalid future portable
  mode state fails closed instead of silently assuming STANDARD.
- Real user-manager rehearsal caught quoted single-path systemd directives
  (`WorkingDirectory`, `EnvironmentFile`). Generation and regression assertions
  now use the actual directive syntax.
- Individual namespace probes proved that the filesystem/kernel isolation
  directives map host root to UID 65534 in this unprivileged user manager. Ordinary
  diagnostics then fail trusted-executable checks. Compatible units omit those
  directives; the root-ownership check stays intact. See the exact list and
  security guarantees in [the runbook](PERSISTENT_SERVICE.md).

- A real retained-64ca2b6 rollback rehearsal caught an unsupported completion-audit
  API call and potential downgrade of the management CLI. Legacy rollback now
  records acceptance only while the ledger writer is stopped, verifies the final
  restart and retains the newer operator CLI. A pure CI ledger test and real
  old-runtime user-unit rehearsal cover this compatibility boundary.

## Verification

The local gates are build, unit suite, policy, portable, CLI, extensions,
integration, full suite and manifest inventory. Browser QA uses existing Brave
with CDP, not a new browser dependency. The native CI matrix remains Linux,
Windows and macOS plus Arch, Fedora and Debian containers; the pushed revision's
actual Actions results are the cloud verification gate, never inferred from Linux.

The real systemd rehearsal used uniquely named staging units, synthetic private
credentials, random ports and disposable workspace/audit state. It verified:

- Independent SDK tool/output schemas, STANDARD diagnostics, privileged and
  destructive denials, separate clients and authenticated admin APIs.
- Compatible hardening and actual UID/mount namespace behavior.
- SIGKILL restart with an intact audit prefix/inode; port-conflict refusal.
- Stdio mock provider and its child removed on graceful stop; clean stop stays down.
- Detached update success and failed-acceptance automatic rollback.
- Start-limit containment and subsequent recovery.
- Failed transient adoption restoring the prior transient runtime; successful
  adoption enabling the persistent unit only after acceptance.
- Read-only browser smoke of every section at desktop and phone widths inside
  the detached acceptance controller, including forced crash recovery.

The browser regression additionally covers real local source discovery, preview,
operator approval/application, hostile tool/source/error/Markdown/audit strings,
keyboard shortcuts, labelled controls, light/dark, page overflow, no stored secrets,
no default token reveal, no external requests and no console/CSP errors. Before
and after screenshots cover all old/new screens at desktop and phone widths.

The old managed root-controller approval gates, native command permissions and
Funnel configuration are not changed. Portable mode has no managed context
prerequisite unless configured; the separate managed-session suite verifies
context denial, grant/client isolation and invalidation. Do not misreport portable
read-only diagnostics as requiring a context grant.

Private evidence and exact exit codes/job IDs are retained in the operator's
`~/.local/state/bridge-dev-persistent/` record. Production cutover evidence belongs
in the detached job receipt and canonical workstation deployment documentation.
Actual ChatGPT account acceptance and survival of a real reboot remain operator
gates. No reboot or stable release tag is part of this verification.
