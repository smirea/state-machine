import { describe, expect, test } from "bun:test";
import { addState, deleteState, renameState } from "./operations.ts";
import { AUTH_FLOW_PRESET } from "./presets.ts";

describe("machine graph operations", () => {
  test("adding a child state promotes an atomic parent to compound and sets its initial child", () => {
    const { document, statePath } = addState(AUTH_FLOW_PRESET, {
      parentPath: "lockedOut",
      name: "cooling",
    });

    expect(statePath).toBe("lockedOut.cooling");
    expect(document.states.lockedOut?.type).toBe("compound");
    expect(document.states.lockedOut?.initial).toBe("cooling");
    expect(document.states.lockedOut?.states?.cooling).toBeDefined();
  });

  test("renaming a state updates parent initial pointers and every transition target pointing to it", () => {
    const { document, newPath } = renameState(AUTH_FLOW_PRESET, "signedOut", "loggedOut");

    expect(newPath).toBe("loggedOut");
    expect(document.initial).toBe("loggedOut");
    expect(document.states.signedOut).toBeUndefined();
    expect(document.states.loggedOut).toBeDefined();
    // Relative sibling transition from authenticating.CANCEL -> loggedOut
    expect(document.states.authenticating?.on?.CANCEL?.[0]?.target).toBe("loggedOut");
    // Hash-qualified target from signedIn.idleWarning.after.3000 -> #authFlow.loggedOut
    expect(
      document.states.signedIn?.states?.idleWarning?.after?.["3000"]?.[0]?.target,
    ).toBe("#authFlow.loggedOut");
  });

  test("deleting the last child state reverts its compound parent back to atomic and clears dangling targets", () => {
    const afterDeleteActive = deleteState(AUTH_FLOW_PRESET, "signedIn.active");
    expect(afterDeleteActive.states.signedIn?.initial).toBe("idleWarning");
    expect(
      afterDeleteActive.states.signedIn?.states?.idleWarning?.on?.STAY_SIGNED_IN?.[0]?.target,
    ).toBeUndefined();

    const afterDeleteBoth = deleteState(afterDeleteActive, "signedIn.idleWarning");
    expect(afterDeleteBoth.states.signedIn?.type).toBe("atomic");
    expect(afterDeleteBoth.states.signedIn?.states).toBeUndefined();
    expect(afterDeleteBoth.states.signedIn?.initial).toBeUndefined();
  });
});
