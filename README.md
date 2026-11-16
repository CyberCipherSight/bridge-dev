# BridgeDev

**Connect ChatGPT Web and other AI agents to your computer's files, terminal, Git projects and MCP tools.**

BridgeDev is a self-hosted MCP gateway for filesystem access, commands, code editing, skills and external MCP integrations. You choose which workspaces and tools the agent can use.

[![Policy tests](https://github.com/kmanisk/bridge-dev/actions/workflows/policy-tests.yml/badge.svg)](https://github.com/kmanisk/bridge-dev/actions/workflows/policy-tests.yml)
[![Linux / Windows / macOS](https://github.com/kmanisk/bridge-dev/actions/workflows/portable-platforms.yml/badge.svg)](https://github.com/kmanisk/bridge-dev/actions/workflows/portable-platforms.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Install

**Requires:** Node.js **22+** with npm. No Git, pnpm, TypeScript, administrator privileges or background service needed for the standard portable install.

| Linux / macOS / Termux (shell) | Windows (PowerShell) |
| --- | --- |
| `curl -fsSL https://raw.githubusercontent.com/kmanisk/bridge-dev/main/install.sh \| sh` | `irm https://raw.githubusercontent.com/kmanisk/bridge-dev/main/install.ps1 \| iex` |

The installer downloads the current GitHub source, builds BridgeDev, creates a private configuration and two independent credentials, picks available localhost ports, and installs the `bridge-dev` launcher in your user directory. No system configuration or existing gateway is replaced. Updates retain your workspace, configuration and prior runtime.

**After installation:**

```sh
bridge-dev start              # Start the portable gateway
```

In a second **private terminal**:

```sh
bridge-dev access             # Show Admin UI and MCP connection details
bridge-dev doctor             # Check installation and connectivity
```

The foreground gateway stops with Ctrl+C. These commands require no root access. The installer shows the full launcher path if it is not yet on `PATH`.

<details>
<summary>Android / Termux and other environments</summary>

In Termux, install `nodejs-lts`, `curl` and `tar` using `pkg` if missing, then run the same shell installer. **Termux and Waydroid are experimental until device-tested**; standard Android shell/root permissions are not equivalent to the managed Linux controller.

Windows dual-boot installations and Windows VMs use the PowerShell command **inside that Windows environment**. They are separate installations and do not modify the Linux host or VM configuration.

</details>

[Installation details, paths and troubleshooting](docs/INSTALL.md)

## Features

- **Computer tools:** Read, search, create and edit workspace files; run commands; inspect and change Git projects.
- **One MCP endpoint:** Use BridgeDev with ChatGPT, Codex, Claude or another compatible MCP client.
- **Extensions and skills:** Discover and review MCP providers, `SKILL.md` content and instructions from GitHub, URLs or local sources.
- **Admin UI:** See enabled providers, tool access and reviewed proposals.
- **User-controlled access:** Normal Read & Write mode; optional managed Linux Full System (sudo) mode.

## Common commands

| Task | Command |
| --- | --- |
| Guided first-time setup | `bridge-dev setup` |
| Start / Stop / Restart | `bridge-dev start`, `bridge-dev stop`, `bridge-dev restart` |
| Check health and status | `bridge-dev doctor`, `bridge-dev status`, `bridge-dev mode status` |
| Show private connection details | `bridge-dev access` (local terminal only) |
| Manage authorized workspaces | `bridge-dev workspace list`, `bridge-dev workspace add <path>`, `bridge-dev workspace remove <path>` |
| Manage security mode | `bridge-dev mode standard`, `bridge-dev mode yolo`, `bridge-dev mode yolo --off` |
| Manage persistent Linux service | `bridge-dev service install`, `bridge-dev service status`, `bridge-dev service update <sha-or-tag>`, `bridge-dev service rollback` |
| See all supported commands | `bridge-dev help` |

The persistent service is **optional and Linux-only**. Full System requires a **separately reviewed, independently authorized Linux host controller**; the portable installer does not grant sudo.

After a successful local `bridge-dev mode yolo` confirmation, the CLI now offers a **second, default-No prompt** to enable BridgeDev at boot. Answer `y` to install/enable its existing systemd user unit (creating the normal `default.target.wants` symlink) and, when necessary, run `sudo loginctl enable-linger` for your user. It verifies both settings, never restarts a working gateway, and leaves Tailscale, tokens, and the signed YOLO lease alone. Answer `n` to keep the existing service configuration. If a fresh unit is installed with standard sandboxing, root-command support still requires separately reviewed controller-compatible service configuration; no sandbox is silently weakened. See [persistent service](docs/PERSISTENT_SERVICE.md).

## Maintenance, credential rotation and optional monitor shortcut

On managed Linux installations, run `bridge-dev update --check` to compare the
installed release with the current GitHub `main` SHA. `bridge-dev update` calls
the existing exact-SHA, CI-verified, rollback-protected systemd updater. It does
**not** run `git pull`, modify dirty source checkouts or silently rotate tokens.
`--no-wait` returns a durable job ID. A healthy STANDARD gateway is required:
revoke YOLO locally before updating and reactivate it deliberately afterwards.
For a portable installation without systemd, use its documented installer.

From an **interactive local terminal**, `bridge-dev token rotate admin` or
`bridge-dev token rotate mcp` creates a private timestamped mode-0600 backup
of the original `~/.config/bridge-dev/.env` and atomically replaces **only**
the requested token with new randomness. Values are not printed. Add
`--restart` to explicitly restart the managed user service; without it, the
running process keeps its old credential until restarted. Rotating Admin
invalidates browser sessions and requires `bridge-dev access` to pair again.
Rotating MCP requires reconnecting client URLs. Backups retain secrets; review
and remove them after successful verification.

`bridge-dev monitor` reuses an existing local Sway scratchpad/TUI when
available, or opens the localhost dashboard. It requires no always-running
monitor process. Optional `bridge-dev monitor shortcut --key Mod4+Mod1+d
--install-desktop` writes a user-owned XDG application launcher and prints a
Sway/i3 binding example. Configure any conflict-free keybinding in your own
window manager; BridgeDev does not edit or reload compositor files. Existing
scratchpad bindings remain intact. If a monitor is still using an old token,
exit and relaunch it to reread the protected configuration.

## Local Admin dashboard: one-click pairing

Use `bridge-dev access` in a **private interactive terminal** to obtain the
short-lived **One-click local Admin pairing** link. Open it within 60 seconds;
no Admin bearer token needs to be typed into the dashboard. The dashboard
stores only a signed HttpOnly cookie (valid for up to seven days); it survives
reloads and gateway restarts, and rotating `ADMIN_TOKEN` invalidates it.
A separate **Access & Security** page contains session controls and the
optional manual fallback. Unpaired users do not receive a bearer credential
from an unauthenticated localhost endpoint.

This is a locally trusted browser flow, **not** proof of Unix-user identity:
other code running as the operator may compromise the local session. Keep
the Admin listener loopback-only and [review the security model](docs/ADMIN_AUTH.md).

## Connect ChatGPT Web

1. Run `bridge-dev access` in a private terminal to get your MCP connection URL.
2. In ChatGPT, add a **custom MCP server** using that HTTPS URL. When using the legacy token-in-URL format, select **Authentication: None**; the path already contains the credential. Keep that URL private.
3. After connecting, verify `agent_status`, `run_command` with `pwd`, and `mcp_list`. A portable gateway may report `system_context` as **not configured**; that is not itself a connection failure.

**ChatGPT Web cannot connect directly to `localhost`.** Expose only the authenticated MCP endpoint through a separately configured HTTPS tunnel. Keep the Admin UI bound to loopback; never expose it through Funnel or publish its token.

When using the managed gateway, call `system_context` before commands. If the ChatGPT connector uses separate MCP sessions, forward the returned short-lived `context_token` to context-gated tools. This token does not grant sudo permissions. [Policy and session details](docs/POLICY_GATEWAY.md).

## Access modes and power-user elevation

**STANDARD is the default.** The portable installer does not grant administrator access. On Linux, an operator may separately install and review the [optional host-root controller](docs/HOST_CONTROLLER.md). It requires systemd, sudo, a local interactive terminal and independent operator authorization.

| Mode | Capabilities | How it is activated |
| --- | --- | --- |
| **STANDARD (Read & Write)** | Read and edit explicitly authorized workspace roots; normal user-level terminal/Git work; OS account permissions still apply | Default; `bridge-dev mode standard` |
| **YOLO (Full System)** | The approved MCP `run_command` path can execute commands as **host root** without per-command prompts. Highly privileged access to the Linux machine | `bridge-dev mode yolo` in the **operator's local terminal**, with confirmation |

**Important:** YOLO does **not** automatically make every native tool a root-filesystem editor: some native file tools retain their path restrictions. Use the authorized root command path for tasks outside those boundaries. It also does **not** give a remote MCP client permission to enable YOLO itself.

### Enable indefinite YOLO on a managed Linux host

1. Verify you are on the intended machine, have reviewed the [controller installation](docs/HOST_CONTROLLER.md), and have a trusted local terminal with sudo authorization. Installing BridgeDev normally is **not** enough.
2. Inspect the current state, then explicitly authorize Full System:

   ```sh
   bridge-dev status
   bridge-dev mode status
   bridge-dev mode yolo
   ```

3. At the local `Enable Full System (sudo)? [Y/n]` prompt, approve only if you intend to grant the connected MCP gateway root execution. **No `--duration` means an indefinite signed `until_off` authorization**; it remains in effect across gateway restarts and is intended to persist across host reboots until explicitly revoked.
4. Verify after activation:

   ```sh
   bridge-dev mode status
   bridge-dev doctor
   ```

   From your connected MCP client, check `agent_status` for `full_machine_access: true` / `security_mode: dangerous`, then optionally perform a **read-only** `run_command` with `id -u`. UID `0` confirms that command ran as root; it is not a general security-containment test.

### Disable YOLO / return to STANDARD

From the same trusted local terminal:

```sh
bridge-dev mode standard       # Revoke indefinite YOLO authorization
bridge-dev mode status         # Confirm STANDARD
# Equivalent explicit revocation:
bridge-dev mode yolo --off
```

The protected mode should report STANDARD and MCP `agent_status.full_machine_access` should be `false`. A failed or unconfirmed operator action exits nonzero; **do not interpret the attempted command as successful revocation without checking the resulting state**.

For operators using the lower-level interface, `bridge-dev operator yolo on` and `bridge-dev operator yolo off` are available on installations with the controller. Legacy aliases `mode read-write`, `mode sudo`, and `mode sudo --off` remain supported. If you deliberately want a timed authorization instead, `bridge-dev mode yolo --duration 60` selects 60 minutes (supported range: 1–120).

### Workspaces and common permission errors

For **ordinary multi-project development**, prefer explicit STANDARD-mode workspace authorization rather than elevating the entire gateway:

```sh
bridge-dev workspace list
bridge-dev workspace add /absolute/path/to/project
bridge-dev restart             # Apply workspace changes; may interrupt active sessions
bridge-dev workspace remove /absolute/path/to/project
```

`POLICYGATE_OUTSIDE_WRITABLE_ROOTS` in STANDARD indicates that a requested write is outside authorized workspace roots. This is expected protection, **not** proof that YOLO or the MCP connection is broken. A separately installed controller plus local authorization is required for genuine host-root command execution. `POLICYGATE_APPROVAL_REQUIRED` may require a separate operator review; do not bypass the policy by changing paths or tools.

### Operational safeguards

- **Indefinite YOLO is high risk**, especially with a publicly reachable MCP endpoint. Whoever controls the effective MCP credential may gain ongoing root execution while authorization remains active. Use trusted clients, protect the token-bearing URL, and disable YOLO when it is not required.
- Application-level path filters and the signed lease do **not** sandbox arbitrary host-root commands. Revoking authorization blocks new controller operations and its tracked jobs; it cannot undo host modifications or guarantee recovery of escaped root processes.
- The [persistent service updater](docs/PERSISTENT_SERVICE.md) runs STANDARD-only acceptance that checks root commands are denied. **Revoke YOLO and verify STANDARD before release updates or rollback.** Never bypass that check. If `SERVICE_ADMIN_CREDENTIAL_DRIFT` appears, running and persisted credentials disagree; reconcile them through the local operator workflow rather than blindly restarting and disconnecting MCP clients.
- The separately installed Linux controller is **not supported by default** on Windows, macOS, Termux or Waydroid. Installing with `sudo` does not turn the portable install into a managed host gateway.

For full installation prerequisites, signed authorization, root-job revocation and troubleshooting, read [Host controller](docs/HOST_CONTROLLER.md) and [Security](docs/POLICY_GATEWAY.md).

## Live activity and local monitor (optional Linux integration)

BridgeDev exposes authenticated Admin endpoints `/api/activity`, `/api/activity/history` and `/api/activity/stream` for recent tool calls, durations and errors. The Admin UI remains **localhost-only**; do not publish port 3001 via Funnel.

A local Sway/Foot deployment can optionally connect these endpoints to an **on-demand terminal scratchpad**. This is a workstation customization, **not part of the portable install**. For example, a locally configured **Super+Alt+D** launcher can open a TUI with:

- **Activity:** live MCP tool calls, summaries, status, duration and failures.
- **Jobs:** tracked user-level job IDs, status and log inspection.
- **Health:** running gateway, PID, release, mode, sessions and other diagnostics.

The local monitor shown in the workstation integration uses `Tab` / `1`–`3` for views; `j/k` to navigate; `Enter` for details; `/` to filter; `l` for a job log; `r` to refresh; and `q` to exit. `c` currently **clears the filter only**. A separate `C` shortcut to clear displayed activity/jobs has been requested but **is not yet shipped**; do not advertise it as a working feature.

**Display clearing must never delete the append-only audit ledger, job receipts, or log files.** A future clear-history control should hide previously displayed records only, allow new activity to appear, and keep durable audit/recovery evidence intact. The monitor displays only activity received by BridgeDev; it cannot reveal ChatGPT's internal reasoning or unrelated tools.

## Milestone and release readiness

[Milestone tracker #6](https://github.com/kmanisk/bridge-dev/issues/6) records the **workstation integration, CLI harmonization, multi-workspace support, and verified YOLO status**. The unified CLI commands (`bridge-dev setup`, `status`, `workspace`, `mode`, `access`) are reconciled with backward compatibility aliases (`mode sudo`, `mode read-write`, `project`, `serve`). See [milestone evidence and release gates](docs/MILESTONES.md).

## Platforms

| Platform | Status |
| --- | --- |
| Linux (including Arch/CachyOS, Debian, Fedora, Ubuntu) | Portable runtime and distribution CI tested |
| Windows | Portable runtime tested in native CI |
| macOS | Portable runtime tested in native CI |
| Android / Termux / Waydroid | Experimental; device acceptance pending |

## Documentation

[Install](docs/INSTALL.md) · [Local trial](docs/LOCAL_TRIAL.md) · [Platform support](docs/PLATFORM_SUPPORT.md) · [MCP integrations](docs/MCP_INTEGRATIONS.md) · [Skills and extensions](docs/EXTENSIONS.md) · [Managed deployment](docs/DEPLOYMENT.md) · [Security](docs/POLICY_GATEWAY.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)

## License

[MIT](LICENSE). Based on [chatgpt-local-coder](https://github.com/hoangcoderr/chatgpt-local-coder) by hoangcoderr; upstream attribution retained. The historical Go prototype is preserved in `archive/go-prototype`.

Tailscale is optional: `bridge-dev start --funnel` explicitly enables exposure; stop/restart preserve existing routes.

[Stabilization QA and privilege acceptance limits](docs/FINAL_QA.md).

Linux users can install an opt-in [persistent user service](docs/PERSISTENT_SERVICE.md) with `bridge-dev service install`. The [local operations interface](docs/DASHBOARD.md) remains separate from the public MCP endpoint.

### Integration marketplace

Browse 106 metadata-verified MCP packages, skills and developer tools in the local
Admin UI Marketplace. Prefer suitable connected ChatGPT plugins, declare your
per-service preferences, and review installation proposals before running code.
Catalog entries are separate from connected providers and callable tools.
[Marketplace and provider priority](docs/MARKETPLACE.md) ·
[REA connection and verified scope](docs/integrations/REA.md).
