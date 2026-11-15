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
| Start gateway | `bridge-dev start` |
| Check health and current mode | `bridge-dev doctor`, `bridge-dev mode status` |
| Show private connection details | `bridge-dev access` (local terminal only) |
| Manage a persistent Linux user service | `bridge-dev service install`, `bridge-dev service status`, `bridge-dev service logs` |
| Update or roll back a verified Linux service release | `bridge-dev service update <sha-or-tag>`, `bridge-dev service rollback` |
| Enter / leave managed Linux Full System | `bridge-dev mode sudo`, `bridge-dev mode sudo --off` |
| See all supported commands | `bridge-dev help` |

The persistent service is **optional and Linux-only**. Full System requires a **separately reviewed, independently authorized Linux host controller**; the portable installer does not grant sudo.

## Connect ChatGPT Web

1. Run `bridge-dev access` in a private terminal to get your MCP connection URL.
2. In ChatGPT, add a **custom MCP server** using that HTTPS URL. When using the legacy token-in-URL format, select **Authentication: None**; the path already contains the credential. Keep that URL private.
3. After connecting, verify `agent_status`, `run_command` with `pwd`, and `mcp_list`. A portable gateway may report `system_context` as **not configured**; that is not itself a connection failure.

**ChatGPT Web cannot connect directly to `localhost`.** Expose only the authenticated MCP endpoint through a separately configured HTTPS tunnel. Keep the Admin UI bound to loopback; never expose it through Funnel or publish its token.

When using the managed gateway, call `system_context` before commands. If the ChatGPT connector uses separate MCP sessions, forward the returned short-lived `context_token` to context-gated tools. This token does not grant sudo permissions. [Policy and session details](docs/POLICY_GATEWAY.md).

## Access modes

| Mode | Use |
| --- | --- |
| **Read & Write** | Scoped workspace files, Git and regular commands; standard portable and managed development |
| **Full System (sudo)** | Managed **Linux only**: unrestricted host-root access after independent terminal confirmation; stays active until switched off |

For an already provisioned managed Linux installation:

```sh
bridge-dev mode read-write
bridge-dev mode sudo
bridge-dev mode sudo --off
```

For a **single local shell helper** with explicit verification and recovery
instructions, use [scripts/bridge-dev-recover.sh](scripts/bridge-dev-recover.sh):
`sh bridge-dev-recover.sh check`, `on 60`, or `off`.
It does not deploy code or replace the independent operator.

Full System asks for **independent local operator confirmation**. Without `--duration`, the documented managed controller issues an `until_off` authorization; `--duration 60` selects an optional timed session. Treat unrestricted root as high risk: application path checks cannot contain arbitrary host-root code, and revocation cannot undo earlier changes. **Portable installation does not enable sudo.** Verify `agent_status.full_machine_access` rather than trusting a CLI message alone. [Linux controller setup](docs/HOST_CONTROLLER.md).

## Milestone and release readiness

[Milestone tracker #6](https://github.com/kmanisk/bridge-dev/issues/6) records the **2026-11-15 workstation MCP-to-root verification** and the next usability/security gates. Its verified local runtime is **not yet reconciled with published `main`**; the short `mode standard` / `mode yolo` aliases reported on that workstation must not be assumed available in every published installation. See [milestone evidence and remaining work](docs/MILESTONES.md). This is **not** a stable-v1 release announcement.

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
