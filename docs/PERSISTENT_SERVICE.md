# Persistent portable Linux service

The portable gateway can run as a systemd **user** service. It remains an
unprivileged STANDARD gateway; this does not provision the independent managed
Full System controller. Tailscale stays optional and service commands never
modify Funnel. If the gateway stops, an existing Funnel route returns upstream
errors until the same loopback listener is healthy again.

## Install and inspect

Build a clean checkout first, or run from an installed, marked release. Keep the
existing user-owned mode-0600 environment file with independent MCP/admin tokens.
Installation references that file; it never embeds or copies its credentials.

```sh
bridge-dev service install --config "$HOME/.config/bridge-dev/.env"
bridge-dev service start
bridge-dev service status --json
bridge-dev doctor
bridge-dev service logs --lines 80
```

Install is idempotent, writes only a BridgeDev-owned unit, reloads the user manager
and enables the service. `--no-enable` leaves boot activation disabled; `--start`
also starts it. Existing custom units are not overwritten. Uninstall stops and
disables the unit but preserves releases, state, credentials and linger.
`start`, `stop`, `restart`, `enable` and `disable` are also service subcommands.
Top-level `start`, `stop` and `restart` use the installed user service; `serve`
continues to run a foreground gateway and refuses occupied ports.

Boot without login additionally requires linger. Status reports it; the CLI
reports the exact operator command if missing:

```sh
sudo loginctl enable-linger "$USER"
```

No reboot is performed by installation. Verify manually after reboot: check
`systemctl --user is-enabled bridge-dev.service`,
`systemctl --user status bridge-dev.service --no-pager`,
`loginctl show-user "$USER" -p Linger`, `bridge-dev doctor` and the authenticated
MCP acceptance calls below. Check that ports 3000 and 3001 belong to one PID.

## Layout and updates

Default installation root: `~/.local/share/bridge-dev` (XDG/explicit installation
root overrides are supported). Releases are `releases/<40-character-sha>`;
`current` is an atomically replaced relative symlink. Private schema-1 controller
configuration and receipts live in `service/`. Previous releases are retained.

```sh
bridge-dev service update <sha-or-tag>
bridge-dev service status --job <uuid> --json
bridge-dev service logs --job <uuid>
bridge-dev service rollback
```

Updates require `gh` authenticated in the **operator account**. The updater checks
successful push/main runs of all three repository workflows on the exact SHA,
downloads that SHA's CI-built `bridge-dev-node-<sha>` artifact, verifies GitHub's
SHA-256 ZIP digest and the embedded per-file manifest, rejects unsafe archive
paths/symlinks/extra files, and stages without package hooks or source fallback.
Artifact retention is 30 days; an expired artifact is a precise blocker. The
initial local bootstrap release is explicitly marked operator-seeded, not CI
verified. A dirty unmarked checkout cannot become a bootstrap release.

A single exclusive update lock and persistent job UUID prevent blind duplicate
updates. The on-demand `systemd-run --user` controller is independent of gateway
connections. It has a 180-second deadline and an `ExecStopPost` rollback guard.
Before stopping the gateway it checks free disk, hashes, an isolated-port SDK
probe and credential-file identity. It stops only its configured gateway,
appends a service audit event while that writer is stopped, switches `current`,
starts and accepts the new runtime. Live events use the gateway's authenticated
operator route, avoiding a second audit writer.

Failed preflight leaves the running gateway untouched. Failure after stopping or
switching restores the previous pointer/configuration, resets the start-limit
state, restarts the previous release and verifies health. The ledger is never
restored or replaced. Inspect the recorded job before retrying an unknown result.
`rollback` repeats harmlessly once the previous release has been selected.

The one-time `service adopt <sha> --transient bridge-dev-portable-SHA.service
--previous-app <path>` transaction restores the original transient runtime on
failure. Run it only after staging the verified target and recording the
transient unit's original properties. Keep its original app until success.

## Hardening and limits

The unit uses an absolute Node entrypoint, no shell or login wrapper, `Type=exec`,
`Restart=on-failure`, 3-second backoff, four starts per 60 seconds, 30-second graceful
stop and `KillMode=control-group`. Default limits are MemoryHigh=768M,
MemoryMax=1024M and TasksMax=256, configurable at installation.

Compatible rootless defaults retain `NoNewPrivileges=yes`, `UMask=0077`,
`RestrictSUIDSGID=yes`, `LockPersonality=yes`, `RestrictNamespaces=yes` and
`SystemCallArchitectures=native`. Node options and library injection environment
variables are unset. Journald rate-limits this unit to 200 messages per 30 seconds.
V8 JIT requires executable memory; `MemoryDenyWriteExecute` is intentionally absent.

On the tested CachyOS systemd user manager, `PrivateTmp`, `ProtectHome`,
`ProtectSystem`, `ProtectKernelTunables`, `ProtectKernelModules` and
`ProtectControlGroups` each implicitly introduce a user namespace that maps host
UID 0 to 65534. This breaks BridgeDev's independent root-owned executable check.
They and `PrivateUsers` are therefore omitted by the compatible `basic` default.
The ownership check is retained. This service relies on existing OS account
permissions plus BridgeDev workspace/policy checks; it is not a filesystem sandbox.
The optional `full` unit renderer needs separate platform compatibility acceptance
before use and is not the verified workstation configuration.

The app bounds HTTP JSON to 2 MiB, gateway/admin concurrent connections to 64/32,
request/header deadlines to 30/15 seconds, live provider connections to 16,
background jobs to 32 active/256 retained records, activity history to at most
2,000 entries and queued audit writes to 1,024. Shutdown stops providers and owned
process groups, closes sessions/listeners and drains fsynced audit writes. Audit
verification streams in bounded chunks without rewriting or rotating the ledger.

## Health, state and acceptance

`GET /healthz` is unauthenticated and returns only `{"ok":true}`. Detailed MCP
`/health` now requires the MCP bearer credential; admin `/health` requires its
independent admin credential. Sensitive APIs use no-store. Do not put credentials
in terminal command arguments or unit files.

Service config, release manifests, extension locks and runtime settings are
versioned. Known unversioned local tool/plugin/hook and shell state is validated
in memory. Future or malformed versions fail closed. Explicit settings writes
are atomic and backed up; they go to protected state, never into release code or
the credential file. Browser environment editing accepts only the tool profile,
shell timeout and checkpoint enablement; applying them requires an operator CLI
restart. Authentication, paths, policy and signing state remain offline-only.

The reviewed rehearsal is `scripts/deploy-acceptance/user-service.mjs` with
`--execute-staging --evidence <private-directory>`. It logs its exact unit/path
inventory before changes and uses synthetic credentials, random ports and its own
ledger. It tests SDK/schema acceptance, crash restart, port conflicts, provider
child cleanup, clean stop, detached update, failed-cutover rollback and start-limit
recovery. Unit/artifact/locking tests run in ordinary CI without a user manager.

After deployment, independently authenticate an SDK client, discover tools, load
system context, run `pwd`, verify privileged/destructive denials and another
client's isolation, and call all read tools with output-schema validation. The
portable runtime has no managed context prerequisite by default; do not invent a
before-context denial that is not configured. Context enforcement is verified in
the separate managed-session regression suite. Actual ChatGPT acceptance belongs
to the account operator: reconnect, open a new chat, inspect tools, then call
`system_context`, `run_command` with `pwd`, `mcp_list` and `skills_validate`.
