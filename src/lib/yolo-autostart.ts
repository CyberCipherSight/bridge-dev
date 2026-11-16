/**
 * Optional, operator-confirmed systemd user service persistence after local YOLO
 * activation. Never issues/revokes a lease, restarts a gateway, or exposes Funnel.
 * Actions are injected so CLI regression tests never touch the host.
 */
export interface BootServiceStatus {
  installed: boolean;
  enabled?: boolean;
  linger?: boolean;
  active?: boolean;
  unit?: string;
}

export interface BootServiceActions {
  status(): Promise<BootServiceStatus>;
  confirm(): Promise<boolean>;
  install(): Promise<unknown>;
  enable(): Promise<unknown>;
  enableLinger(): Promise<unknown>;
  log(message: string): void;
}

export async function offerPersistentBootService(
  actions: BootServiceActions,
): Promise<"already-enabled" | "declined" | "enabled"> {
  const before = await actions.status();
  if (before.installed && before.enabled && before.linger) {
    actions.log("BridgeDev service and login linger are already enabled for reboot.");
    return "already-enabled";
  }

  // The signed host-root lease must already have been activated and verified
  // independently. Declining this SECOND opt-in never changes that lease.
  if (!(await actions.confirm())) {
    actions.log("Boot autostart unchanged; Full System authorization is separate.");
    return "declined";
  }

  // Re-read after confirmation: an unrelated operator may have adjusted the unit.
  const now = await actions.status();
  if (!now.installed) {
    // The existing reviewed installer creates the release pointer and user unit,
    // performs daemon-reload and systemctl --user enable, without starting it.
    await actions.install();
  } else if (!now.enabled) {
    // systemctl --user enable creates the WantedBy=default.target symlink.
    await actions.enable();
  }

  const enabled = await actions.status();
  if (!enabled.installed || !enabled.enabled)
    throw Error("YOLO_BOOT_SERVICE_NOT_ENABLED: inspect systemctl --user status");

  if (!enabled.linger) await actions.enableLinger();
  const verified = await actions.status();
  if (!verified.installed || !verified.enabled || !verified.linger)
    throw Error("YOLO_BOOT_PERSISTENCE_UNVERIFIED: inspect unit enablement and loginctl linger");

  actions.log("BridgeDev user service and login linger enabled for boot. No service restarted.");
  if (!verified.active)
    actions.log("The unit is not running now; start it only after confirming ports are free.");
  return "enabled";
}
