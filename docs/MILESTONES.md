# Milestone: local Full System acceptance → usable BridgeDev v1

[GitHub tracking issue #6](https://github.com/kmanisk/bridge-dev/issues/6) · Recorded 2026-11-15.

This document records a **workstation integration checkpoint**, not a cross-platform or stable-v1 release. GitHub `main` was `2206c6eea022a829c40aabd93975a6adc3ef9419` at recording time; the separately installed workstation release resolved to `70f6b63ce6beda60069bfeb0b9cbcea93ee4021a`. Do not present those as the same artifact without source and CI reconciliation.

## Verified from the connected local MCP

- `agent_status`: `security_mode=dangerous`, `full_machine_access=true`; machine roots include `/` and `/home/onyx`.
- `run_command("id -u")`: exit 0 and stdout `0`, reported as a successful host-root job.
- The inspected user service had `NoNewPrivileges=no`, `RestrictSUIDSGID=no`, `RestrictNamespaces=no` and a loopback gateway; this reduces filesystem/process isolation.
- No production files or settings were changed by the independent verification.

## Reported by the workstation operator; not independently verified here

- Installed signed Linux controller, `until_off` lease persisting across reboot until manual revocation, and local dashboard unlock improvements.
- Live service rollback and comprehensive pre-reboot validation. A cold reboot with this controller state was not independently observed.
- Local `mode standard` and `mode yolo` aliases; public `main` continues to document `mode read-write` and `mode sudo`.

## Release gates

- [ ] Publish, test and trace the actual local controller/CLI runtime against exact-SHA green CI before calling it a released feature.
- [ ] Unify simple, discoverable CLI setup/status/access/mode/service/help commands while retaining backwards-compatible aliases.
- [ ] Add beginner-friendly first-run setup, multi-root selection, reliable errors and actionable diagnostics without unreviewed root access.
- [ ] Remove sensitive URLs from the browser address bar and keep Admin credentials memory-only (no web storage). Validate the actual shipped dashboard, not only documentation.
- [ ] Review privileged broker and sandbox design; acknowledge the inability to contain or revoke arbitrary escaped root processes.
- [ ] Check default STANDARD mode, independent local activation, positive root execution, signed lease revocation, audit integrity, and restart/reboot behavior.
- [ ] Run authenticated ChatGPT/client acceptance, at least one real provider flow, browser a11y and platform/security CI.
- [ ] Preserve rollback releases, the audit ledger, signing material, independent MCP/Admin credentials and existing Funnel exposure.

Also track [managed MCP-to-root release gate #4](https://github.com/kmanisk/bridge-dev/issues/4) and [portable native-command approval gate #5](https://github.com/kmanisk/bridge-dev/issues/5) independently; do not close either from a self-reported smoke test.

For current supported commands consult [README](../README.md), [Install](INSTALL.md), [Host controller](HOST_CONTROLLER.md) and `bridge-dev help`. Documentation publication never installs or activates a privileged controller.
