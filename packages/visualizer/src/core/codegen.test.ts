import { describe, expect, test } from "bun:test";
import {
  exportDocumentJson,
  exportMermaid,
  exportTypeScript,
  importMachineSource,
} from "./codegen.ts";
import { AUTH_FLOW_PRESET, MEDIA_PLAYER_PRESET } from "./presets.ts";

describe("codegen and source import", () => {
  test("round-trips a MachineDocument losslessly through document JSON including notes and colors", () => {
    const json = exportDocumentJson(AUTH_FLOW_PRESET);
    const parsed = importMachineSource(json);

    expect(parsed.id).toBe(AUTH_FLOW_PRESET.id);
    expect(parsed.notes).toHaveLength(AUTH_FLOW_PRESET.notes.length);
    expect(parsed.states.authenticating?.color).toBe("blue");
  });

  test("exports XState v5 TypeScript code and parses setup().createMachine() source back without eval", () => {
    const tsCode = exportTypeScript(AUTH_FLOW_PRESET);
    expect(tsCode).toContain('import { setup, fromPromise } from "xstate";');
    expect(tsCode).toContain("export const authFlowMachine = setup({");

    const imported = importMachineSource(tsCode);
    expect(imported.id).toBe("authFlow");
    expect(imported.initial).toBe("signedOut");
    expect(imported.states.authenticating?.invoke?.[0]?.src).toBe("authenticateUser");
    expect(imported.states.signedIn?.states?.idleWarning?.after?.["3000"]?.[0]?.target).toBe(
      "#authFlow.signedOut",
    );
  });

  test("parses hand-written XState v5 TypeScript containing comments, inline arrows, and single quotes", () => {
    const handWritten = `
      import { createMachine, assign } from 'xstate';
      // Custom comment
      export const counter = createMachine({
        id: 'counter',
        initial: 'ready',
        context: { count: 0 },
        states: {
          ready: {
            on: {
              INC: {
                target: 'ready',
                guard: ({ context }) => context.count < 10,
                actions: assign({ count: ({ context }) => context.count + 1 }),
              },
            },
          },
        },
      });
    `;

    const doc = importMachineSource(handWritten);
    expect(doc.id).toBe("counter");
    expect(doc.initial).toBe("ready");
    expect(doc.states.ready?.on?.INC?.[0]?.target).toBe("ready");
  });

  test("exports Mermaid stateDiagram-v2 including parallel region dividers and history states", () => {
    const mermaid = exportMermaid(MEDIA_PLAYER_PRESET);
    expect(mermaid).toContain("stateDiagram-v2");
    expect(mermaid).toContain("--");
    expect(mermaid).toContain("hist (H)");
  });
});
