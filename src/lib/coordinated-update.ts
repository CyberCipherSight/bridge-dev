/**
 * One-command managed update while preserving independent operator authority.
 *
 * The existing guarded updater MUST run in STANDARD. No job should be
 * accepted/declared complete from its queue receipt alone, and remote
 * non-interactive calls may never mint or silently re-activate a YOLO lease.
 * On any failure, leave the system STANDARD for inspection; never elevate
 * while a potentially unfinished acceptance job might still be running.
 */
export interface CoordinatedUpdateActions {
  // The runtime's signed mode inspector returns a string, which must be
  // narrowed and verified before any state transition.
  mode(): string;
  interactive: boolean;
  revokeYolo(): Promise<boolean>;
  deployAndWait(): Promise<boolean>;
  verifyRelease(): Promise<boolean>;
  restoreYoloWithLocalConfirmation(): Promise<boolean>;
  log(message: string): void;
}
export async function coordinatedVerifiedUpdate(
  actions: CoordinatedUpdateActions,
): Promise<{ updated: true; original_mode: "YOLO" | "STANDARD"; final_mode: "YOLO" | "STANDARD" }> {
  const initial = actions.mode();
  if (initial !== "YOLO" && initial !== "STANDARD")
    throw Error("UPDATE_MODE_UNVERIFIED: inspect the signed local lease and gateway before updating");
  if (initial === "YOLO") {
    if (!actions.interactive)
      throw Error("UPDATE_YOLO_LOCAL_TTY_REQUIRED: run bridge-dev update in your own interactive terminal");
    actions.log("YOLO is active. Temporarily switching to STANDARD for verified release acceptance.");
    if (!await actions.revokeYolo() || actions.mode() !== "STANDARD")
      throw Error("UPDATE_STANDARD_REVOCATION_UNVERIFIED: no release update was started");
  }
  try {
    const completed = await actions.deployAndWait();
    if (!completed || actions.mode() !== "STANDARD" || !await actions.verifyRelease())
      throw Error("UPDATE_ACCEPTANCE_UNVERIFIED: inspect the recorded job and rollback before retrying");
  } catch (error) {
    if (initial === "YOLO")
      actions.log("Update was unsuccessful or unfinished. Remaining in STANDARD; root access is not silently restored while the job may be pending.");
    throw error;
  }
  if (initial === "YOLO") {
    actions.log("Verified update succeeded. Reauthorizing prior YOLO requires the independent local operator confirmation.");
    if (!await actions.restoreYoloWithLocalConfirmation() || actions.mode() !== "YOLO")
      throw Error("UPDATE_SUCCEEDED_YOLO_NOT_RESTORED: new release is healthy in STANDARD; restore locally with bridge-dev mode yolo");
    actions.log("Verified latest release installed; YOLO restored by independent local confirmation.");
    return { updated: true, original_mode: initial, final_mode: "YOLO" };
  }
  return { updated: true, original_mode: initial, final_mode: "STANDARD" };
}
