import { createRoot, type Root } from "react-dom/client";
import {
  createVisualizerController,
  type VisualizerController,
  type VisualizerControllerOptions,
} from "./controller.ts";
import { StateMachineVisualizer } from "./ui/StateMachineVisualizer.tsx";

export interface MountedVisualizer {
  controller: VisualizerController;
  unmount: () => void;
}

/**
 * Framework-agnostic imperative mount helper so any application (vanilla TS, Svelte, Vue, etc.)
 * can embed and drive the visualizer programmatically.
 */
export function mountVisualizer(
  container: HTMLElement,
  options: VisualizerControllerOptions = {},
): MountedVisualizer {
  const controller = createVisualizerController(options);
  const root: Root = createRoot(container);
  root.render(<StateMachineVisualizer controller={controller} />);

  return {
    controller,
    unmount: () => {
      root.unmount();
      controller.destroy();
    },
  };
}
