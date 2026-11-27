import { X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type { AnyStateMachine } from "xstate";
import {
  createVisualizerController,
  type VisualizerController,
  type VisualizerControllerOptions,
} from "../controller.ts";
import type {
  MachineDocument,
  SimulationState,
  VisualizerConfig,
  VisualizerSelection,
} from "../core/types.ts";
import { exportSvgElement } from "../storage/files.ts";
import { Canvas } from "./Canvas.tsx";
import { LeftSidebar } from "./LeftSidebar.tsx";
import { RightSidebar } from "./RightSidebar.tsx";
import { Toolbar } from "./Toolbar.tsx";
import "./styles.css";

export interface StateMachineVisualizerProps extends VisualizerControllerOptions {
  controller?: VisualizerController;
  className?: string;
  style?: CSSProperties;
  onMachineChange?: (doc: MachineDocument) => void;
  onConfigChange?: (config: VisualizerConfig) => void;
  onSelectionChange?: (selection: VisualizerSelection) => void;
  onSimulationChange?: (sim: SimulationState) => void;
}

function isNarrowViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= 900;
}

export function StateMachineVisualizer({
  controller: externalController,
  machine,
  config,
  storage,
  seedPresetsIfEmpty,
  runtimeOptions,
  className,
  style,
  onMachineChange,
  onConfigChange,
  onSelectionChange,
  onSimulationChange,
}: StateMachineVisualizerProps) {
  const [internalController] = useState<VisualizerController | null>(() =>
    externalController
      ? null
      : createVisualizerController({
          machine,
          config,
          storage,
          seedPresetsIfEmpty,
          runtimeOptions,
        }),
  );

  const controller = externalController ?? internalController!;
  const snapshot = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [leftOpen, setLeftOpen] = useState(() =>
    isNarrowViewport() ? false : snapshot.config.showLeftPanel,
  );
  const [rightOpen, setRightOpen] = useState(() =>
    isNarrowViewport() ? false : snapshot.config.showRightPanel,
  );

  // Sync panel visibility when config changes programmatically
  useEffect(() => {
    if (!isNarrowViewport()) {
      setLeftOpen(snapshot.config.showLeftPanel);
    }
  }, [snapshot.config.showLeftPanel]);

  useEffect(() => {
    if (!isNarrowViewport()) {
      setRightOpen(snapshot.config.showRightPanel);
    }
  }, [snapshot.config.showRightPanel]);

  useEffect(() => {
    return () => {
      internalController?.destroy();
    };
  }, [internalController]);

  // Wire callback props
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    if (onMachineChange) unsubs.push(controller.on("machineChange", onMachineChange));
    if (onConfigChange) unsubs.push(controller.on("configChange", onConfigChange));
    if (onSelectionChange) unsubs.push(controller.on("selectionChange", onSelectionChange));
    if (onSimulationChange) unsubs.push(controller.on("simulationChange", onSimulationChange));
    return () => {
      for (const u of unsubs) u();
    };
  }, [controller, onMachineChange, onConfigChange, onSelectionChange, onSimulationChange]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!snapshot.config.enableKeyboardShortcuts) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (snapshot.config.enableBrowserStorage) {
          void controller.saveToStorage();
        }
        return;
      }

      if (inEditable) return;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) controller.redo();
        else controller.undo();
        return;
      }

      if (e.key === "v" || e.key === "V") {
        controller.setConfig({ canvasTool: "select" });
      } else if (e.key === "h" || e.key === "H") {
        controller.setConfig({ canvasTool: "pan" });
      } else if (e.key === "f" || e.key === "F") {
        controller.fitView();
      } else if ((e.key === "Backspace" || e.key === "Delete") && !snapshot.config.readOnly) {
        const sel = controller.getSnapshot().selection;
        if (sel.kind === "state") controller.deleteState(sel.path);
        else if (sel.kind === "transition") {
          controller.deleteTransition({
            sourcePath: sel.sourcePath,
            kind: sel.transitionKind,
            eventKey: sel.eventKey,
            invokeId: sel.invokeId,
            transitionId: sel.transitionId,
          });
        } else if (sel.kind === "note") controller.deleteNote(sel.noteId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [controller, snapshot.config.enableKeyboardShortcuts, snapshot.config.enableBrowserStorage, snapshot.config.readOnly]);

  const effectiveTheme =
    snapshot.config.theme === "system"
      ? typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : snapshot.config.theme;

  const mobileDrawerOpen = (leftOpen || rightOpen) && isNarrowViewport();

  return (
    <div
      className={`smv-root ${className ?? ""}`}
      data-theme={effectiveTheme}
      style={style}
    >
      {snapshot.config.showToolbar && (
        <Toolbar
          controller={controller}
          snapshot={snapshot}
          leftOpen={leftOpen}
          rightOpen={rightOpen}
          onToggleLeft={() => {
            setLeftOpen((v) => {
              const next = !v;
              if (next && isNarrowViewport()) setRightOpen(false);
              return next;
            });
          }}
          onToggleRight={() => {
            setRightOpen((v) => {
              const next = !v;
              if (next && isNarrowViewport()) setLeftOpen(false);
              return next;
            });
          }}
          onExportSvg={() => {
            if (svgRef.current) {
              exportSvgElement(svgRef.current, `${snapshot.machine.id}.svg`);
            }
          }}
        />
      )}

      {snapshot.lastError && (
        <div className="smv-error-banner" role="alert">
          <span>{snapshot.lastError}</span>
          <button
            type="button"
            className="smv-btn smv-btn-icon smv-btn-sm"
            onClick={() => controller.clearError()}
            aria-label="Dismiss error"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="smv-body">
        {mobileDrawerOpen && (
          <div
            className="smv-drawer-backdrop"
            onClick={() => {
              setLeftOpen(false);
              setRightOpen(false);
            }}
          />
        )}

        {leftOpen && (
          <LeftSidebar
            controller={controller}
            snapshot={snapshot}
            onCloseMobile={() => {
              if (isNarrowViewport()) setLeftOpen(false);
            }}
          />
        )}

        <Canvas controller={controller} snapshot={snapshot} svgRef={svgRef} />

        {rightOpen && <RightSidebar controller={controller} snapshot={snapshot} />}
      </div>
    </div>
  );
}

export type { AnyStateMachine };
