import { describe, expect, test } from "bun:test";
import { createActor, createMachine } from "xstate";
import { AUTH_FLOW_PRESET, MEDIA_PLAYER_PRESET } from "./presets.ts";
import { MachineSimulator } from "./simulator.ts";
import {
  fromXStateMachine,
  resolveTargetPath,
  toXStateConfig,
} from "./xstate-adapter.ts";

describe("xstate-adapter", () => {
  test("converts an XState v5 machine to a MachineDocument and back without losing states or transitions", () => {
    const original = createMachine({
      id: "door",
      initial: "closed",
      context: { locked: false },
      states: {
        closed: {
          tags: ["secure"],
          on: {
            OPEN: { target: "open", guard: "isUnlocked" },
          },
        },
        open: {
          after: {
            2000: "closed",
          },
        },
      },
    });

    const doc = fromXStateMachine(original);
    expect(doc.id).toBe("door");
    expect(doc.initial).toBe("closed");
    expect(doc.states.closed?.tags).toEqual(["secure"]);
    expect(doc.states.closed?.on?.OPEN?.[0]?.guard).toBe("isUnlocked");
    expect(doc.states.open?.after?.["2000"]?.[0]?.target).toBe("closed");

    const exported = toXStateConfig(doc);
    expect(exported.id).toBe("door");
    expect(exported.initial).toBe("closed");
    expect(Object.keys(exported.states as Record<string, unknown>)).toEqual(["closed", "open"]);
  });

  test("resolves sibling, child, and hash-qualified absolute state targets", () => {
    expect(resolveTargetPath(AUTH_FLOW_PRESET, "signedIn.active", "idleWarning")).toBe(
      "signedIn.idleWarning",
    );
    expect(
      resolveTargetPath(AUTH_FLOW_PRESET, "signedIn.idleWarning", "#authFlow.signedOut"),
    ).toBe("signedOut");
    expect(resolveTargetPath(AUTH_FLOW_PRESET, "signedIn", ".active")).toBe("signedIn.active");
    expect(
      resolveTargetPath(MEDIA_PLAYER_PRESET, "empty", "#mediaPlayer.ready.playback.hist"),
    ).toBe("ready.playback.hist");
  });
});

describe("MachineSimulator", () => {
  test("drives XState v5 events, guard overrides, invoke outcomes, delays, and step-back", () => {
    const sim = new MachineSimulator(AUTH_FLOW_PRESET);
    sim.start();
    expect(sim.getState().activeStatePaths).toEqual(["signedOut"]);

    // Blocking hasValidCredentials prevents transitioning to authenticating
    sim.setGuardOverride("hasValidCredentials", false);
    sim.send({ type: "SUBMIT" });
    expect(sim.getState().activeStatePaths).toEqual(["signedOut"]);
    expect(sim.getState().log.at(-1)?.actionsFired).toContain("setValidationError");

    // Re-enabling hasValidCredentials transitions into authenticating with an active invoke
    sim.setGuardOverride("hasValidCredentials", true);
    sim.send({ type: "SUBMIT" });
    expect(sim.getState().activeStatePaths).toEqual(["authenticating"]);
    expect(sim.getState().activeInvokes.map((i) => i.invoke.id)).toEqual(["verifyCredentials"]);

    // Resolving the invoke enters compound state signedIn.active
    sim.triggerInvokeDone("verifyCredentials");
    expect(sim.getState().activeStatePaths).toEqual(["signedIn", "signedIn.active"]);

    // Triggering the 5000ms delay moves to signedIn.idleWarning
    sim.triggerDelay("signedIn.active", "5000");
    expect(sim.getState().activeStatePaths).toEqual(["signedIn", "signedIn.idleWarning"]);

    // Stepping back restores signedIn.active
    sim.stepBack();
    expect(sim.getState().activeStatePaths).toEqual(["signedIn", "signedIn.active"]);

    sim.stop();
  });

  test("reflects live state updates when attached to an external XState v5 actor", () => {
    const machine = createMachine({
      id: "toggle",
      initial: "off",
      states: {
        off: { on: { FLIP: "on" } },
        on: { on: { FLIP: "off" } },
      },
    });
    const doc = fromXStateMachine(machine);
    const actor = createActor(machine).start();
    const sim = new MachineSimulator(doc);

    sim.attachActor(actor);
    expect(sim.getState().externalActorAttached).toBe(true);
    expect(sim.getState().activeStatePaths).toEqual(["off"]);

    actor.send({ type: "FLIP" });
    expect(sim.getState().activeStatePaths).toEqual(["on"]);

    sim.detachActor();
    actor.stop();
  });
});
