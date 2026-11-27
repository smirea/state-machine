import { describe, expect, test } from "bun:test";
import { computeLayout } from "./layout.ts";
import { AUTH_FLOW_PRESET, MEDIA_PLAYER_PRESET } from "./presets.ts";
import { DEFAULT_VISUALIZER_CONFIG } from "./types.ts";

describe("ELK hierarchical layout", () => {
  test("positions internal compound-state edges inside their parent container bounds", async () => {
    const layout = await computeLayout(AUTH_FLOW_PRESET, DEFAULT_VISUALIZER_CONFIG);
    const signedIn = layout.nodeMap.signedIn;
    expect(signedIn).toBeDefined();

    const internalEdge = layout.edges.find((e) => e.transition.id === "tr_idle_warn");
    expect(internalEdge).toBeDefined();

    for (const pt of internalEdge!.points) {
      expect(pt.x).toBeGreaterThanOrEqual(signedIn.x);
      expect(pt.x).toBeLessThanOrEqual(signedIn.x + signedIn.width);
      expect(pt.y).toBeGreaterThanOrEqual(signedIn.y);
      expect(pt.y).toBeLessThanOrEqual(signedIn.y + signedIn.height);
    }
  });

  test("places the initial state before downstream states in model-order left-to-right layout", async () => {
    const layout = await computeLayout(AUTH_FLOW_PRESET, DEFAULT_VISUALIZER_CONFIG);
    expect(layout.nodeMap.signedOut.x).toBeLessThan(layout.nodeMap.authenticating.x);
    expect(layout.nodeMap.authenticating.x).toBeLessThan(layout.nodeMap.signedIn.x);
  });

  test("lays out parallel regions without overlapping sibling region bounds", async () => {
    const layout = await computeLayout(MEDIA_PLAYER_PRESET, DEFAULT_VISUALIZER_CONFIG);
    const playback = layout.nodeMap["ready.playback"];
    const audio = layout.nodeMap["ready.audio"];
    expect(playback).toBeDefined();
    expect(audio).toBeDefined();

    const overlapsX = playback.x < audio.x + audio.width && playback.x + playback.width > audio.x;
    const overlapsY = playback.y < audio.y + audio.height && playback.y + playback.height > audio.y;
    expect(overlapsX && overlapsY).toBe(false);
  });
});
