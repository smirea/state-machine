import {
  ArrowRight,
  Clock,
  Cpu,
  Hand,
  LayoutGrid,
  Lock,
  Maximize2,
  Minus,
  MousePointer2,
  Play,
  Plus,
  StickyNote,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { VisualizerController, VisualizerControllerSnapshot } from "../controller.ts";
import { buildSvgPath } from "../core/layout.ts";
import {
  ACCENT_COLORS,
  type AccentColor,
  type CanvasNote,
  type LayoutNodeRect,
} from "../core/types.ts";

interface CanvasProps {
  controller: VisualizerController;
  snapshot: VisualizerControllerSnapshot;
  svgRef?: RefObject<SVGSVGElement | null>;
}

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

interface DragState {
  kind: "pan" | "node" | "note" | "connect";
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  targetId?: string;
  currentWorldX?: number;
  currentWorldY?: number;
  hoverNodePath?: string | null;
}

function renderInlineMarkdown(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={idx}>{part.slice(1, -1)}</code>;
    }
    return <span key={idx}>{part}</span>;
  });
}

function renderSimpleMarkdown(text: string): string[] {
  return text.split("\n");
}

function resolveColorStyle(
  color: AccentColor | undefined,
  theme: "dark" | "light",
  showColors: boolean,
  faded: boolean,
): { borderColor?: string; background?: string } {
  if (!showColors || !color || color === "default") return {};
  const entry = ACCENT_COLORS[color];
  if (!entry) return {};
  if (faded) return {};
  return {
    borderColor: entry.border,
    background: theme === "dark" ? entry.bgDark : entry.bgLight,
  };
}

export function Canvas({ controller, snapshot, svgRef }: CanvasProps) {
  const { machine, config, selection, layout, simulation } = snapshot;
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<ViewportTransform>({ x: 36, y: 36, scale: 1 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [liveNodePos, setLiveNodePos] = useState<{ path: string; x: number; y: number } | null>(
    null,
  );
  const [liveNotePos, setLiveNotePos] = useState<{ id: string; x: number; y: number } | null>(null);
  const lastFittedMachineId = useRef<string | null>(null);

  const effectiveTheme: "dark" | "light" = config.theme === "light" ? "light" : "dark";
  const isSimulate = config.mode === "simulate";
  const activeStateSet = useMemo(
    () => new Set(simulation.activeStatePaths),
    [simulation.activeStatePaths],
  );
  const availableById = useMemo(() => {
    const map = new Map<string, (typeof simulation.availableTransitions)[number]>();
    for (const item of simulation.availableTransitions) {
      map.set(item.transition.id, item);
    }
    return map;
  }, [simulation.availableTransitions]);

  const fitView = useCallback(() => {
    const el = viewportRef.current;
    if (!el || !layout || layout.nodes.length === 0) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of layout.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    if (config.showNotes) {
      for (const note of machine.notes) {
        minX = Math.min(minX, note.x);
        minY = Math.min(minY, note.y);
        maxX = Math.max(maxX, note.x + (note.width ?? 220));
        maxY = Math.max(maxY, note.y + 130);
      }
    }

    const contentW = Math.max(100, maxX - minX + 80);
    const contentH = Math.max(100, maxY - minY + 80);
    const scale = Math.max(
      config.zoomMin,
      Math.min(1.1, config.zoomMax, Math.min(rect.width / contentW, rect.height / contentH)),
    );
    const x = (rect.width - (maxX - minX) * scale) / 2 - minX * scale;
    const y = (rect.height - (maxY - minY) * scale) / 2 - minY * scale;
    setViewport({ x, y, scale });
  }, [layout, machine.notes, config.showNotes, config.zoomMin, config.zoomMax]);

  useEffect(() => {
    if (layout && lastFittedMachineId.current !== machine.id) {
      lastFittedMachineId.current = machine.id;
      fitView();
    }
  }, [layout, machine.id, fitView]);

  useEffect(() => {
    return controller.onViewportAction((action) => {
      if (action === "fit") {
        fitView();
      } else if (action === "zoomIn") {
        setViewport((v) => ({ ...v, scale: Math.min(config.zoomMax, v.scale * 1.18) }));
      } else if (action === "zoomOut") {
        setViewport((v) => ({ ...v, scale: Math.max(config.zoomMin, v.scale / 1.18) }));
      } else if (action === "resetZoom") {
        setViewport((v) => ({ ...v, scale: 1 }));
      }
    });
  }, [controller, fitView, config.zoomMax, config.zoomMin]);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - viewport.x) / viewport.scale,
        y: (clientY - rect.top - viewport.y) / viewport.scale,
      };
    },
    [viewport],
  );

  function handleWheel(e: ReactWheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0) {
      const zoomFactor = e.deltaY < 0 ? 1.09 : 0.92;
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      setViewport((prev) => {
        const nextScale = Math.max(config.zoomMin, Math.min(config.zoomMax, prev.scale * zoomFactor));
        const ratio = nextScale / prev.scale;
        return {
          scale: nextScale,
          x: mouseX - (mouseX - prev.x) * ratio,
          y: mouseY - (mouseY - prev.y) * ratio,
        };
      });
    }
  }

  function handleBackgroundPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("smv-canvas-stage")) {
      return;
    }
    controller.select({ kind: "machine" });
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      kind: "pan",
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: viewport.x,
      originY: viewport.y,
    });
  }

  function handleBackgroundDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (config.readOnly || isSimulate) return;
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("smv-canvas-stage")) {
      return;
    }
    const world = screenToWorld(e.clientX, e.clientY);
    controller.addState({
      name: "newState",
      position: { x: Math.round(world.x - 88), y: Math.round(world.y - 28) },
    });
  }

  function startNodeDrag(e: ReactPointerEvent, node: LayoutNodeRect) {
    e.stopPropagation();
    controller.select({ kind: "state", path: node.path });
    if (config.canvasTool === "pan") {
      viewportRef.current?.setPointerCapture(e.pointerId);
      setDrag({
        kind: "pan",
        startClientX: e.clientX,
        startClientY: e.clientY,
        originX: viewport.x,
        originY: viewport.y,
      });
      return;
    }
    if (config.readOnly || isSimulate) return;
    viewportRef.current?.setPointerCapture(e.pointerId);
    setDrag({
      kind: "node",
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: node.x,
      originY: node.y,
      targetId: node.path,
    });
  }

  function startConnectDrag(e: ReactPointerEvent, sourceNode: LayoutNodeRect) {
    e.stopPropagation();
    if (config.readOnly || isSimulate) return;
    viewportRef.current?.setPointerCapture(e.pointerId);
    const startX = sourceNode.x + sourceNode.width;
    const startY = sourceNode.y + sourceNode.height / 2;
    setDrag({
      kind: "connect",
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: startX,
      originY: startY,
      targetId: sourceNode.path,
      currentWorldX: startX,
      currentWorldY: startY,
      hoverNodePath: null,
    });
  }

  function startNoteDrag(e: ReactPointerEvent, note: CanvasNote) {
    e.stopPropagation();
    controller.select({ kind: "note", noteId: note.id });
    if (config.readOnly || config.canvasTool === "pan") return;
    viewportRef.current?.setPointerCapture(e.pointerId);
    setDrag({
      kind: "note",
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: note.x,
      originY: note.y,
      targetId: note.id,
    });
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;

    if (drag.kind === "pan") {
      setViewport((prev) => ({ ...prev, x: drag.originX + dx, y: drag.originY + dy }));
      return;
    }

    if (drag.kind === "node" && drag.targetId) {
      if (Math.hypot(dx, dy) < 4) return;
      setLiveNodePos({
        path: drag.targetId,
        x: Math.round(drag.originX + dx / viewport.scale),
        y: Math.round(drag.originY + dy / viewport.scale),
      });
      return;
    }

    if (drag.kind === "note" && drag.targetId) {
      if (Math.hypot(dx, dy) < 3) return;
      setLiveNotePos({
        id: drag.targetId,
        x: Math.round(drag.originX + dx / viewport.scale),
        y: Math.round(drag.originY + dy / viewport.scale),
      });
      return;
    }

    if (drag.kind === "connect" && layout) {
      const world = screenToWorld(e.clientX, e.clientY);
      // Find deepest node under cursor
      const hit = [...layout.nodes]
        .reverse()
        .find(
          (n) =>
            world.x >= n.x &&
            world.x <= n.x + n.width &&
            world.y >= n.y &&
            world.y <= n.y + n.height,
        );
      setDrag((prev) =>
        prev
          ? {
              ...prev,
              currentWorldX: world.x,
              currentWorldY: world.y,
              hoverNodePath: hit?.path ?? null,
            }
          : null,
      );
    }
  }

  function handlePointerUp() {
    if (!drag) return;
    if (drag.kind === "node" && liveNodePos) {
      controller.moveNode(liveNodePos.path, { x: liveNodePos.x, y: liveNodePos.y });
    } else if (drag.kind === "note" && liveNotePos) {
      controller.updateNote(liveNotePos.id, { x: liveNotePos.x, y: liveNotePos.y });
    } else if (drag.kind === "connect" && drag.targetId && drag.hoverNodePath) {
      controller.addTransition({
        sourcePath: drag.targetId,
        targetPath: drag.hoverNodePath,
        kind: "on",
        eventKey: "NEXT",
      });
    }
    setDrag(null);
    setLiveNodePos(null);
    setLiveNotePos(null);
  }

  function handleEdgeClick(tr: NonNullable<typeof layout>["edges"][number]["transition"]) {
    if (isSimulate) {
      const avail = availableById.get(tr.id);
      if (avail?.enabled) {
        if (tr.kind === "on" && tr.eventKey) {
          controller.sendEvent({ type: tr.eventKey });
          return;
        }
        if (tr.kind === "after" && tr.eventKey) {
          controller.triggerDelay(tr.sourcePath, tr.eventKey);
          return;
        }
        if (tr.kind === "invokeDone" && tr.invokeId) {
          controller.triggerInvokeDone(tr.invokeId);
          return;
        }
        if (tr.kind === "invokeError" && tr.invokeId) {
          controller.triggerInvokeError(tr.invokeId);
          return;
        }
      }
    }

    controller.select({
      kind: "transition",
      sourcePath: tr.sourcePath,
      transitionKind: tr.kind,
      eventKey: tr.eventKey,
      invokeId: tr.invokeId,
      transitionId: tr.id,
    });
  }

  const gridSize = Math.max(10, 24 * viewport.scale);
  const nodes = layout?.nodes ?? [];
  const edges = layout?.edges ?? [];

  return (
    <div
      ref={viewportRef}
      data-testid="smv-canvas"
      className={`smv-canvas-viewport ${config.showGrid ? "has-grid" : ""} ${
        config.canvasTool === "pan" ? "tool-pan" : ""
      } ${drag?.kind === "pan" ? "is-panning" : ""}`}
      style={{
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onWheel={handleWheel}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleBackgroundDoubleClick}
    >
      <div
        className="smv-canvas-stage"
        style={{
          width: layout?.width ?? 1000,
          height: layout?.height ?? 800,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        {/* SVG Edges Layer */}
        <svg
          ref={svgRef}
          className="smv-edges-svg"
          width={layout?.width ?? 1000}
          height={layout?.height ?? 800}
        >
          <defs>
            <marker
              id="smv-arrow"
              markerWidth="9"
              markerHeight="7"
              refX="8"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 9 3.5, 0 7" fill="var(--smv-edge-stroke)" />
            </marker>
            <marker
              id="smv-arrow-selected"
              markerWidth="9"
              markerHeight="7"
              refX="8"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 9 3.5, 0 7" fill="var(--smv-accent)" />
            </marker>
            <marker
              id="smv-arrow-sim"
              markerWidth="9"
              markerHeight="7"
              refX="8"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 9 3.5, 0 7" fill="var(--smv-sim-event)" />
            </marker>
          </defs>

          {edges.map((edge) => {
            const tr = edge.transition;
            const d = buildSvgPath(edge.points, config.edgeRouting);
            const isSelected =
              selection.kind === "transition" && selection.transitionId === tr.id;
            const avail = isSimulate ? availableById.get(tr.id) : undefined;
            const customEdgeColor =
              config.showColors &&
              !(isSimulate && config.fadeColorsInSimulate) &&
              tr.transition.color &&
              tr.transition.color !== "default"
                ? ACCENT_COLORS[tr.transition.color]?.border
                : undefined;

            const marker = isSelected
              ? "url(#smv-arrow-selected)"
              : avail?.enabled
                ? "url(#smv-arrow-sim)"
                : "url(#smv-arrow)";

            return (
              <g key={tr.id}>
                <path className="smv-edge-hit" d={d} onClick={() => handleEdgeClick(tr)} />
                <path
                  className={`smv-edge-path ${isSelected ? "selected" : ""} ${
                    avail?.enabled ? "sim-enabled" : avail?.blockedByGuard ? "sim-blocked" : ""
                  } ${edge.isTargetless ? "targetless" : ""}`}
                  style={!isSelected && !avail && customEdgeColor ? { stroke: customEdgeColor } : undefined}
                  d={d}
                  markerEnd={marker}
                />
              </g>
            );
          })}

          {drag?.kind === "connect" &&
            drag.currentWorldX !== undefined &&
            drag.currentWorldY !== undefined && (
              <line
                x1={drag.originX}
                y1={drag.originY}
                x2={drag.currentWorldX}
                y2={drag.currentWorldY}
                stroke="var(--smv-accent)"
                strokeWidth={2}
                strokeDasharray="6 4"
                markerEnd="url(#smv-arrow-selected)"
              />
            )}
        </svg>

        {/* State Nodes Layer */}
        {nodes.map((node) => {
          const isSelected = selection.kind === "state" && selection.path === node.path;
          const isActive = isSimulate && activeStateSet.has(node.path);
          const isInactive = isSimulate && simulation.running && !isActive;
          const isConnectTarget = drag?.kind === "connect" && drag.hoverNodePath === node.path;
          const x = liveNodePos?.path === node.path ? liveNodePos.x : node.x;
          const y = liveNodePos?.path === node.path ? liveNodePos.y : node.y;
          const colorStyle = resolveColorStyle(
            node.node.color,
            effectiveTheme,
            config.showColors,
            isSimulate && config.fadeColorsInSimulate,
          );
          const hasChildren = Boolean(node.node.states && Object.keys(node.node.states).length > 0);

          return (
            <div
              key={node.path}
              data-testid={`smv-node-${node.path}`}
              className={`smv-node ${hasChildren ? "compound" : ""} ${
                node.resolvedType === "parallel" ? "parallel" : ""
              } ${node.resolvedType === "final" ? "final" : ""} ${
                isSelected ? "selected" : ""
              } ${isActive ? "sim-active" : ""} ${isInactive ? "sim-inactive" : ""} ${
                isConnectTarget ? "connect-target" : ""
              }`}
              style={{
                left: x,
                top: y,
                width: node.width,
                height: node.height,
                zIndex: node.depth + 1,
                ...colorStyle,
              }}
              onPointerDown={(e) => startNodeDrag(e, node)}
            >
              {isSelected && !config.readOnly && !isSimulate && (
                <div
                  className="smv-node-quickbar"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {node.resolvedType !== "final" && node.resolvedType !== "history" && (
                    <button
                      type="button"
                      title="Add child state"
                      onClick={() => controller.addState({ parentPath: node.path, name: "child" })}
                    >
                      <Plus size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    title="Add self/event transition"
                    onClick={() =>
                      controller.addTransition({
                        sourcePath: node.path,
                        targetPath: node.path,
                        kind: "on",
                        eventKey: "EVENT",
                      })
                    }
                  >
                    <ArrowRight size={13} />
                  </button>
                  <button
                    type="button"
                    title="Delete state"
                    onClick={() => controller.deleteState(node.path)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}

              <div className="smv-node-header">
                <div className="smv-node-title-wrap">
                  {node.isInitial && <span className="smv-initial-dot" title="Initial state" />}
                  <span className="smv-node-title" title={node.path}>
                    {node.key}
                  </span>
                </div>
                {node.resolvedType === "parallel" && <span className="smv-type-badge">∥ parallel</span>}
                {node.resolvedType === "final" && <span className="smv-type-badge">◉ final</span>}
                {node.resolvedType === "history" && (
                  <span className="smv-type-badge">
                    H{node.node.history === "deep" ? "*" : ""}
                  </span>
                )}
              </div>

              {(config.showTags && node.node.tags?.length) ||
              (config.showDescriptions && node.node.description) ||
              (config.showActions && (node.node.entry?.length || node.node.exit?.length)) ||
              (config.showInvoke && node.node.invoke?.length) ? (
                <div className="smv-node-body">
                  {config.showTags && node.node.tags && node.node.tags.length > 0 && (
                    <div className="smv-chip-list">
                      {node.node.tags.map((tag) => (
                        <span key={tag} className="smv-chip">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {config.showDescriptions && node.node.description && (
                    <div className="smv-node-desc">{node.node.description}</div>
                  )}

                  {config.showActions && node.node.entry && node.node.entry.length > 0 && (
                    <div className="smv-node-meta-row">
                      <span className="smv-node-meta-label">entry</span>
                      {node.node.entry.map((a, idx) => (
                        <span key={`${a.type}_${idx}`}>→ {a.type}</span>
                      ))}
                    </div>
                  )}

                  {config.showActions && node.node.exit && node.node.exit.length > 0 && (
                    <div className="smv-node-meta-row">
                      <span className="smv-node-meta-label">exit</span>
                      {node.node.exit.map((a, idx) => (
                        <span key={`${a.type}_${idx}`}>← {a.type}</span>
                      ))}
                    </div>
                  )}

                  {config.showInvoke && node.node.invoke && node.node.invoke.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {node.node.invoke.map((inv) => (
                        <div key={inv.id} className="smv-node-invoke" title={inv.description}>
                          <Cpu size={11} />
                          <span>invoke {inv.src}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {!config.readOnly && !isSimulate && (
                <div
                  className="smv-connect-handle"
                  title="Drag to another state to create a transition"
                  onPointerDown={(e) => startConnectDrag(e, node)}
                />
              )}
            </div>
          );
        })}

        {/* Transition Event Pills */}
        {edges.map((edge) => {
          const tr = edge.transition;
          const isSelected = selection.kind === "transition" && selection.transitionId === tr.id;
          const avail = isSimulate ? availableById.get(tr.id) : undefined;
          const baseName =
            tr.kind === "always"
              ? "always"
              : tr.kind === "after"
                ? `${tr.eventKey}${/^\d+$/.test(tr.eventKey ?? "") ? "ms" : ""}`
                : tr.kind === "onDone"
                  ? "onDone"
                  : tr.kind === "invokeDone"
                    ? `${tr.invokeId}.done`
                    : tr.kind === "invokeError"
                      ? `${tr.invokeId}.error`
                      : tr.eventKey || "EVENT";

          const pillColor =
            config.showColors &&
            !(isSimulate && config.fadeColorsInSimulate) &&
            !avail &&
            tr.transition.color &&
            tr.transition.color !== "default"
              ? ACCENT_COLORS[tr.transition.color]?.border
              : undefined;

          return (
            <button
              key={`pill_${tr.id}`}
              type="button"
              data-testid={`smv-edge-pill-${tr.id}`}
              className={`smv-edge-pill ${config.translucentEvents ? "translucent" : ""} ${
                isSelected ? "selected" : ""
              } ${avail?.enabled ? "sim-enabled" : avail?.blockedByGuard ? "sim-blocked" : ""}`}
              style={{
                left: edge.labelPosition.x,
                top: edge.labelPosition.y,
                ...(pillColor && !isSelected ? { borderColor: pillColor } : {}),
              }}
              title={
                avail?.enabled
                  ? `Click to fire ${tr.label}`
                  : avail?.blockedByGuard
                    ? `Blocked by guard [${avail.blockedByGuard}]`
                    : tr.transition.description || tr.label
              }
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                handleEdgeClick(tr);
              }}
            >
              {avail?.enabled && <Play size={10} />}
              {avail?.blockedByGuard && <Lock size={10} />}
              {tr.kind === "after" && !avail && <Clock size={10} />}
              <span>{baseName}</span>
              {config.showGuards && tr.transition.guard && (
                <span className="smv-guard-tag">[{tr.transition.guard}]</span>
              )}
            </button>
          );
        })}

        {/* Canvas Markdown Notes */}
        {config.showNotes &&
          machine.notes.map((note) => {
            const isSelected = selection.kind === "note" && selection.noteId === note.id;
            const nx = liveNotePos?.id === note.id ? liveNotePos.x : note.x;
            const ny = liveNotePos?.id === note.id ? liveNotePos.y : note.y;
            const noteColor = resolveColorStyle(
              note.color ?? "amber",
              effectiveTheme,
              true,
              false,
            );

            return (
              <div
                key={note.id}
                className={`smv-note ${isSelected ? "selected" : ""}`}
                style={{
                  left: nx,
                  top: ny,
                  width: note.width ?? 220,
                  ...noteColor,
                }}
                onPointerDown={(e) => startNoteDrag(e, note)}
              >
                {renderSimpleMarkdown(note.text).map((line, i) => {
                  if (line.startsWith("## ")) return <h2 key={i}>{renderInlineMarkdown(line.slice(3))}</h2>;
                  if (line.startsWith("# ")) return <h1 key={i}>{renderInlineMarkdown(line.slice(2))}</h1>;
                  if (line.startsWith("- ")) return <div key={i}>• {renderInlineMarkdown(line.slice(2))}</div>;
                  return <p key={i}>{line ? renderInlineMarkdown(line) : "\u00A0"}</p>;
                })}
              </div>
            );
          })}
      </div>

      {/* Floating bottom-left Canvas Tools HUD */}
      <div className="smv-canvas-hud" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={`smv-btn smv-btn-icon smv-btn-sm ${
            config.canvasTool === "select" ? "smv-btn-active" : ""
          }`}
          onClick={() => controller.setConfig({ canvasTool: "select" })}
          title="Pointer mode (V)"
          aria-label="Pointer mode"
        >
          <MousePointer2 size={13} />
        </button>
        <button
          type="button"
          className={`smv-btn smv-btn-icon smv-btn-sm ${
            config.canvasTool === "pan" ? "smv-btn-active" : ""
          }`}
          onClick={() => controller.setConfig({ canvasTool: "pan" })}
          title="Hand / Pan mode (H)"
          aria-label="Hand pan mode"
        >
          <Hand size={13} />
        </button>

        {!config.readOnly && !isSimulate && (
          <>
            <button
              type="button"
              className="smv-btn smv-btn-sm"
              onClick={() => controller.addState({ name: "state" })}
              title="Add State (or double-click canvas)"
            >
              <Plus size={13} />
              <span>State</span>
            </button>
            <button
              type="button"
              className="smv-btn smv-btn-icon smv-btn-sm"
              onClick={() => controller.addNote()}
              title="Add Markdown Note"
              aria-label="Add Note"
            >
              <StickyNote size={13} />
            </button>
          </>
        )}

        <button
          type="button"
          className="smv-btn smv-btn-icon smv-btn-sm"
          onClick={() => controller.autoLayout()}
          title="Re-run Auto Layout"
          aria-label="Auto Layout"
        >
          <LayoutGrid size={13} />
        </button>

        <button
          type="button"
          className="smv-btn smv-btn-icon smv-btn-sm"
          onClick={() => controller.zoomOut()}
          title="Zoom Out"
          aria-label="Zoom Out"
        >
          <Minus size={13} />
        </button>
        <span className="smv-zoom-label">{Math.round(viewport.scale * 100)}%</span>
        <button
          type="button"
          className="smv-btn smv-btn-icon smv-btn-sm"
          onClick={() => controller.zoomIn()}
          title="Zoom In"
          aria-label="Zoom In"
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          className="smv-btn smv-btn-icon smv-btn-sm"
          onClick={fitView}
          title="Fit View (F)"
          aria-label="Fit View"
        >
          <Maximize2 size={13} />
        </button>
      </div>

      {/* Minimap */}
      {config.showMinimap && layout && layout.nodes.length > 0 && (
        <div className="smv-minimap" onPointerDown={(e) => e.stopPropagation()}>
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${Math.max(1, layout.width)} ${Math.max(1, layout.height)}`}
            preserveAspectRatio="xMidYMid meet"
          >
            {layout.nodes.map((n) => {
              const active = isSimulate && activeStateSet.has(n.path);
              const selected = selection.kind === "state" && selection.path === n.path;
              return (
                <rect
                  key={n.path}
                  x={n.x}
                  y={n.y}
                  width={n.width}
                  height={n.height}
                  rx={6}
                  fill={
                    active
                      ? "rgba(34, 197, 94, 0.55)"
                      : selected
                        ? "rgba(59, 130, 246, 0.55)"
                        : "rgba(148, 163, 184, 0.25)"
                  }
                  stroke={active ? "#22c55e" : selected ? "#3b82f6" : "rgba(148, 163, 184, 0.5)"}
                  strokeWidth={6}
                />
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
