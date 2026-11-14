# Stabilization QA — 2026-11-14

This checkpoint separates source tests, real Linux user-process rehearsals and
privileged-host/account acceptance. It does not certify stable v1 or actual
ChatGPT account behavior.

## Defects and regressions

| ID | Reproduction and cause | Resolution and evidence |
| --- | --- | --- |
| QA-CMD-01 | STANDARD `git --version`, `node --version`, `id -u`, literal `echo` requested approval. The conservative shell analyzer required review for every command except exact pwd/id/whoami. | Exact diagnostic argument forms use verified absolute executables, no shell, no PATH lookup and a minimal environment. Explicit operator deny/approval rules still win. Real HTTP SDK regression: `test-qa-diagnostics.mjs`. |
| QA-PROC-01 | Background and timed shell execution killed only the parent. Login shells could execute profile commands outside the reviewed payload. | POSIX owned process groups terminate on stop, deadline, parent exit and gateway shutdown. Non-login shells skip startup files; injection-related environment variables are scrubbed. Regression covers signed shell review, child cleanup, nonzero exit, timeout and shutdown. Windows retains taskkill tree cleanup; equivalent malicious-process containment is not claimed. |
| QA-JOB-01 | User-job termination lost durable exit information; deadlines were clamped to 60 seconds; the manager environment could reach shell startup. | EXIT/TERM receipts, persisted final results, validated exit paths, clean payload environment, no login profiles, explicit cgroup cleanup and one-second minimum deadlines. Real Linux user-job rehearsal covers exit 0/1, deadline, cancellation, reconnect and gateway restart. |
| QA-FUNNEL-01 | Pending CLI changes called global `tailscale funnel reset` on stop and automatically exposed a gateway when Tailscale was present. | Stop/restart preserve all routes. Start requires explicit `--funnel` (or existing documented environment opt-in), waits for its own sockets, and refuses to replace existing routes. `pnpm run tunnel` starts the foreground gateway with that explicit opt-in and respects PORT. Status parses bounded JSON and matches the actual local target. Local mock tests never contact Tailscale. |
| QA-ADMIN-01 | Pending UI persisted admin credentials in localStorage and included the MCP credential in health output. | Private-terminal access links use a fragment, removed after loading; credentials stay in page memory. A separately authenticated no-store connection endpoint supplies the MCP URL. Health and normal CLI output omit secrets. Real Chromium browser regression verifies login, URL removal, no localStorage and extension management. |

The pre-change isolated build and full suite passed with all six original dirty
files copied intact. Those originals remain untouched. The CLI, package and UI
work is intentionally integrated with the security corrections above.

## Command policy

In STANDARD, exact supported diagnostics are `pwd`, `id`, `whoami`, `true`,
`false`, `id -u`, `id -g`, `git --version`, `node --version`/`node -v`, literal
`echo` arguments without options, and numeric `sleep` up to 120 seconds. Trusted
POSIX system executables must be root-owned and not group/world writable. `node --version`/`node -v` report process.version from the already-running
gateway without launching Node, including CI toolcache runtimes with writable
mode bits. Node background execution still requires signed review. Explicit
paths must resolve to a trusted system executable. Windows supports the inline
Node diagnostic; other unavailable system forms retain review.

Expansion, redirects, pipes, wrappers, interpreter evaluation and general
build/test commands retain exact signed operator review. A command-name regex
cannot authorize arbitrary project code. STRICT still requires its configured
command permission and signed mutation approval. Full System dispatch remains a
separate controller path; these diagnostics do not grant root.

Portable execution has the OS account's access, not an OS security sandbox.
Use a restricted account/container for untrusted code, especially on an account
with broad sudo permissions. Managed Linux adds its provisioned UID/sandbox.
Neither mode should be inferred from the CLI launcher's name.

## Processes and user jobs

`start_process` accepts optional `max_runtime_seconds` (1–86400). Use process
status/output and stop by its tracked ID. POSIX group cleanup targets only the
spawned group. A gateway shutdown ends these processes; they are not recoverable
jobs. Shell commands that need to outlive a call must use the process/job APIs.

`system_job` is Linux systemd user-bus dependent. It creates only on-demand units
with NoNewPrivileges, RestrictSUIDSGID and KillMode=control-group. It never enables
linger or permanent services. Payloads receive a minimal environment. Job state,
logs and terminal receipts persist under LOCAL_CODER_JOB_ROOT; reconnect using the
same ID rather than retrying start. Deadline is reported as `timed_out`; the exit
code records the actual observed termination (143 in the real TERM rehearsal,
124 only when no wrapper receipt exists). Unconfirmed submission retains its ID and files for inspection, never retries,
and cannot be inferred successful from an unloaded unit. A durable result preserves that state
after systemd unloads the unit. Cancel affects only its validated recorded unit.

Explicit real-host rehearsals use temporary HOME/config/state, random ports,
synthetic credentials, and only the current user's disposable systemd units:

```sh
node scripts/rehearse-qa-jobs.mjs --host-user-jobs --receipt /private/path/jobs.json
node scripts/rehearse-qa-service.mjs --host-user-service --receipt /private/path/service.json
```

They require an existing Linux user bus, never sudo or production configuration.
Cleanup stops/resets only their units and removes their temporary trees. Unit/job
IDs, commands, status, exit codes and log locations are in their private receipts.
The service rehearsal verifies authentication, crash restart, explicit restart,
NoNewPrivileges, UMask0077, owned-child cleanup and listener removal.

## Full System gate and limitations

The inspected live gateway is portable STANDARD, full_machine_access=false, with
no installed host controller. Sudo availability is independent of BridgeDev mode.
The real installer and operator lease command reject a non-TTY invocation before
mutating host state. No controller, sudoers entry, production key or lease was
installed or changed for this sprint.

Controller signature, scope, nonce, wrong-client, tamper, expiry, revocation,
queued/running containment, restart recovery and deployment rollback tests use
synthetic signing material and an unprivileged fixture backend. They are not
UID-0 or host-namespace acceptance. The positive MCP-to-root chain, actual
root-owned disposable file, real lease expiry/revocation and managed-controller
failure recovery remain blocked by independent root-terminal installation and
operator confirmation. Do not automate that confirmation through a tool PTY or
use the test-operator bypass as evidence. See [HOST_CONTROLLER.md](HOST_CONTROLLER.md).

## Context, registry and rewind

Managed context grants remain session-specific. Reconnect to a live session
retains its authorization; a new/recovered session requires context or an explicit
short-lived context_token bound to the authenticated subject, source digest,
issuing session and expiry. Context change, revocation, expiry and restart reject
stale tokens. The real HTTP session suite and capability suite test these cases.
Portable mode has no canonical machine-context prerequisite by default; a
successful portable pwd does not validate managed context enforcement.

Missing portable registry is a supported empty state. Current version 1 and the
validated legacy unversioned `servers` form are covered by migration tests.
Only `mcp migrate` persists migration, with dry-run, verified timestamped backup,
atomic replacement and idempotency. No production registry reset is needed.
See [MCP_INTEGRATIONS.md](MCP_INTEGRATIONS.md).

The portable installer intentionally sets CHECKPOINT_ENABLED=false. The library
fallback when unset is true. Leave the live choice unchanged. The isolated
checkpoint suite tests enabled creation/restore. Only supported file-edit tools
produce checkpoints; arbitrary shell writes are not promised recoverable.

## Verification records

Local build, individual suites, full suite and registration manifest must all pass
before publication. The real SDK output-schema regression covers 73 native
registrations plus mock routed providers; the default slim profile exposes 52.
Native Windows/macOS and distribution claims require the exact published CI SHA.
Android remains experimental and unverified. Real user jobs and service behavior
are Linux-only host rehearsals, separate from CI and Full System acceptance.

Private workstation receipts are under
`~/.local/state/bridge-dev-final-qa/20261114T155450Z/`. Retain logs/results and the
pre-change patch outside the repository; never commit credentials or private
state. See [DEPLOYMENT.md](DEPLOYMENT.md) for controlled updates and rollback.

Local verification: build, test, test:policy, test:cli, test:portable,
test:extensions, test:integration, test:all, registration-manifest check and
Chromium browser QA all exited 0. Frozen offline dependency installation passed;
no dependency was added. Real user-job receipts include normal completion 0,
nonzero completion 1, timeout 143 and cancellation 143, all cleaned. The disposable
52-tool service survived crash recovery and explicit restart under UMask0077 and
NoNewPrivileges=yes, then stopped with both ports closed. Full System's remaining
independent acceptance is tracked in [issue #4](https://github.com/kmanisk/bridge-dev/issues/4).
