import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import type {
  ComputedLayout,
  FlattenedTransition,
  LayoutEdgeGeometry,
  LayoutNodeRect,
  MachineDocument,
  Point2D,
  StateNodeDocument,
  VisualizerConfig,
} from "./types.ts";
import {
  listAllStates,
  listAllTransitions,
  type StatePathEntry,
} from "./xstate-adapter.ts";

const elk = new ELK();

const LEAF_MIN_WIDTH = 176;
const LEAF_MAX_WIDTH = 270;
const COMPOUND_HEADER_HEIGHT = 44;
const COMPOUND_PADDING = 24;

export function estimateNodeSize(
  entry: StatePathEntry,
  config: Pick<
    VisualizerConfig,
    "showDescriptions" | "showTags" | "showActions" | "showInvoke"
  >,
): { width: number; height: number; headerHeight: number } {
  const { key, node, resolvedType } = entry;
  const hasChildren = Boolean(node.states && Object.keys(node.states).length > 0);

  let width = Math.max(LEAF_MIN_WIDTH, Math.min(LEAF_MAX_WIDTH, 76 + key.length * 8.5));
  let headerHeight = 38;

  if (resolvedType === "history" && !hasChildren) {
    return { width: Math.max(120, 64 + key.length * 8), height: 48, headerHeight: 48 };
  }

  let extraHeight = 0;

  if (config.showTags && node.tags && node.tags.length > 0) {
    extraHeight += 24;
  }

  if (config.showDescriptions && node.description) {
    const lines = Math.min(3, Math.max(1, Math.ceil(node.description.length / 28)));
    extraHeight += lines * 16 + 8;
    width = Math.max(width, 210);
  }

  if (config.showActions) {
    const entryCount = node.entry?.length ?? 0;
    const exitCount = node.exit?.length ?? 0;
    if (entryCount > 0) {
      extraHeight += 20 + entryCount * 18;
      width = Math.max(width, 200);
    }
    if (exitCount > 0) {
      extraHeight += 20 + exitCount * 18;
      width = Math.max(width, 200);
    }
  }

  if (config.showInvoke && node.invoke && node.invoke.length > 0) {
    extraHeight += 18 + node.invoke.length * 22;
    width = Math.max(width, 210);
  }

  if (hasChildren) {
    headerHeight = COMPOUND_HEADER_HEIGHT + extraHeight;
    return { width: Math.max(width, 230), height: headerHeight + 80, headerHeight };
  }

  const height = Math.max(54, headerHeight + extraHeight + (extraHeight > 0 ? 10 : 12));
  return { width, height, headerHeight };
}

export function buildElkGraph(
  doc: MachineDocument,
  config: Pick<
    VisualizerConfig,
    | "layoutDirection"
    | "nodeSpacing"
    | "layerSpacing"
    | "edgeRouting"
    | "showDescriptions"
    | "showTags"
    | "showActions"
    | "showInvoke"
  >,
): {
  graph: ElkNode;
  entriesByPath: Map<string, StatePathEntry>;
  transitions: FlattenedTransition[];
} {
  const entries = listAllStates(doc);
  const entriesByPath = new Map(entries.map((e) => [e.path, e]));
  const transitions = listAllTransitions(doc);

  const elkRouting =
    config.edgeRouting === "POLYLINE"
      ? "POLYLINE"
      : config.edgeRouting === "SPLINES"
        ? "SPLINES"
        : "ORTHOGONAL";

  function buildNode(entry: StatePathEntry): ElkNode {
    const dims = estimateNodeSize(entry, config);
    const childKeys = entry.node.states ? Object.keys(entry.node.states) : [];
    const hasChildren = childKeys.length > 0;

    if (!hasChildren) {
      return {
        id: entry.path,
        width: dims.width,
        height: dims.height,
      };
    }

    const children = childKeys
      .map((k) => entriesByPath.get(`${entry.path}.${k}`))
      .filter((e): e is StatePathEntry => Boolean(e))
      .map(buildNode);

    const isParallel = entry.resolvedType === "parallel";
    const childDirection =
      isParallel && (config.layoutDirection === "RIGHT" || config.layoutDirection === "LEFT")
        ? "DOWN"
        : config.layoutDirection;

    return {
      id: entry.path,
      children,
      layoutOptions: {
        "elk.padding": `[top=${dims.headerHeight + 18},left=${COMPOUND_PADDING},bottom=${COMPOUND_PADDING},right=${COMPOUND_PADDING}]`,
        "elk.direction": childDirection,
        "elk.spacing.nodeNode": String(Math.max(24, Math.round(config.nodeSpacing * 0.8))),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(
          Math.max(48, Math.round(config.layerSpacing * 0.8)),
        ),
        "elk.nodeSize.minimum": `(${dims.width}, ${dims.height})`,
        "elk.nodeSize.constraints": "MINIMUM_SIZE",
      },
    };
  }

  const rootChildren = Object.keys(doc.states)
    .map((k) => entriesByPath.get(k))
    .filter((e): e is StatePathEntry => Boolean(e))
    .map(buildNode);

  const edges: ElkExtendedEdge[] = [];
  for (const tr of transitions) {
    if (!tr.targetPath) continue;
    if (tr.targetPath === tr.sourcePath) continue; // Self-loops are routed explicitly
    if (!entriesByPath.has(tr.sourcePath) || !entriesByPath.has(tr.targetPath)) continue;
    const labelWidth = Math.min(115, Math.max(40, tr.label.length * 5.8 + 14));
    edges.push({
      id: tr.id,
      sources: [tr.sourcePath],
      targets: [tr.targetPath],
      labels: [
        {
          id: `${tr.id}_label`,
          text: tr.label,
          width: labelWidth,
          height: 22,
        },
      ],
    });
  }

  const graph: ElkNode = {
    id: "__root__",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.direction": config.layoutDirection,
      "elk.edgeRouting": elkRouting,
      "elk.spacing.nodeNode": String(config.nodeSpacing),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(config.layerSpacing),
      "elk.spacing.edgeEdge": "16",
      "elk.spacing.edgeNode": "22",
      "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.padding": "[top=44,left=44,bottom=44,right=44]",
    },
    children: rootChildren,
    edges,
  };

  return { graph, entriesByPath, transitions };
}

function buildSelfLoopGeometry(
  node: LayoutNodeRect,
  loopIndex: number,
  isTargetless: boolean,
): { points: Point2D[]; labelPosition: Point2D } {
  const offset = loopIndex * 28;
  if (isTargetless) {
    const startX = node.x + node.width;
    const y1 = node.y + Math.min(node.height - 14, 24 + offset);
    const outX = startX + 34 + loopIndex * 12;
    const y2 = y1 + 22;
    const points: Point2D[] = [
      { x: startX, y: y1 },
      { x: outX, y: y1 },
      { x: outX, y: y2 },
      { x: startX, y: y2 },
    ];
    return {
      points,
      labelPosition: { x: outX + 8, y: (y1 + y2) / 2 },
    };
  }

  const x1 = node.x + node.width - 36 - Math.min(offset, node.width * 0.4);
  const x2 = x1 + 24;
  const topY = node.y;
  const loopTop = topY - 34 - loopIndex * 24;
  const points: Point2D[] = [
    { x: x1, y: topY },
    { x: x1, y: loopTop },
    { x: x2, y: loopTop },
    { x: x2, y: topY },
  ];
  return {
    points,
    labelPosition: { x: (x1 + x2) / 2, y: loopTop - 12 },
  };
}

function computeDirectEdgePoints(source: LayoutNodeRect, target: LayoutNodeRect): Point2D[] {
  const sx = source.x + source.width / 2;
  const sy = source.y + source.height / 2;
  const tx = target.x + target.width / 2;
  const ty = target.y + target.height / 2;
  const dx = tx - sx;
  const dy = ty - sy;

  let start: Point2D;
  let end: Point2D;
  if (Math.abs(dx) >= Math.abs(dy)) {
    start = { x: dx >= 0 ? source.x + source.width : source.x, y: sy };
    end = { x: dx >= 0 ? target.x : target.x + target.width, y: ty };
    const midX = (start.x + end.x) / 2;
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  } else {
    start = { x: sx, y: dy >= 0 ? source.y + source.height : source.y };
    end = { x: tx, y: dy >= 0 ? target.y : target.y + target.height };
    const midY = (start.y + end.y) / 2;
    return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  }
}

function midpointOnPolyline(points: Point2D[]): Point2D {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];

  let total = 0;
  const segLens: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    segLens.push(len);
    total += len;
  }

  let target = total / 2;
  for (let i = 0; i < segLens.length; i++) {
    if (target <= segLens[i] || i === segLens.length - 1) {
      const ratio = segLens[i] > 0 ? target / segLens[i] : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
        y: points[i].y + (points[i + 1].y - points[i].y) * ratio,
      };
    }
    target -= segLens[i];
  }
  return points[0];
}

export async function computeLayout(
  doc: MachineDocument,
  config: VisualizerConfig,
): Promise<ComputedLayout> {
  if (Object.keys(doc.states).length === 0) {
    return { width: 800, height: 600, nodes: [], nodeMap: {}, edges: [] };
  }

  const { graph, entriesByPath, transitions } = buildElkGraph(doc, config);
  const laidOut = await elk.layout(graph);

  const nodes: LayoutNodeRect[] = [];
  const nodeMap: Record<string, LayoutNodeRect> = {};
  const manualOffsets = doc.layout ?? {};

  function collectNodes(elkNode: ElkNode, offsetX: number, offsetY: number): void {
    for (const child of elkNode.children ?? []) {
      const entry = entriesByPath.get(child.id);
      if (!entry) continue;
      const manual = manualOffsets[child.id];
      const absX = manual ? manual.x : offsetX + (child.x ?? 0);
      const absY = manual ? manual.y : offsetY + (child.y ?? 0);
      const rect: LayoutNodeRect = {
        path: entry.path,
        key: entry.key,
        parentPath: entry.parentPath,
        x: absX,
        y: absY,
        width: child.width ?? LEAF_MIN_WIDTH,
        height: child.height ?? 60,
        node: entry.node,
        resolvedType: entry.resolvedType,
        isInitial: entry.isInitial,
        depth: entry.depth,
        hasManualPosition: Boolean(manual),
      };
      nodes.push(rect);
      nodeMap[entry.path] = rect;
      if (child.children && child.children.length > 0) {
        collectNodes(child, absX, absY);
      }
    }
  }

  collectNodes(laidOut, 0, 0);

  // With INCLUDE_CHILDREN, ELK keeps edges on root but expresses their coordinates
  // relative to `edge.container` (the lowest common ancestor state).
  const elkEdgesById = new Map<string, { edge: ElkExtendedEdge; containerOffset: Point2D }>();
  function collectEdges(elkNode: ElkNode, offsetX: number, offsetY: number): void {
    for (const edge of elkNode.edges ?? []) {
      const containerId = (edge as ElkExtendedEdge & { container?: string }).container;
      const containerRect =
        containerId && containerId !== "__root__" ? nodeMap[containerId] : undefined;
      const containerOffset = containerRect
        ? { x: containerRect.x, y: containerRect.y }
        : { x: offsetX, y: offsetY };
      elkEdgesById.set(edge.id, { edge, containerOffset });
    }
    for (const child of elkNode.children ?? []) {
      const rect = nodeMap[child.id];
      const cx = rect ? rect.x : offsetX + (child.x ?? 0);
      const cy = rect ? rect.y : offsetY + (child.y ?? 0);
      collectEdges(child, cx, cy);
    }
  }
  collectEdges(laidOut, 0, 0);

  const selfLoopCountByState = new Map<string, number>();
  const edges: LayoutEdgeGeometry[] = [];

  for (const tr of transitions) {
    const sourceRect = nodeMap[tr.sourcePath];
    if (!sourceRect) continue;

    const isTargetless = !tr.targetPath;
    const isSelfLoop = isTargetless || tr.targetPath === tr.sourcePath;

    if (isSelfLoop) {
      const loopIdx = selfLoopCountByState.get(tr.sourcePath) ?? 0;
      selfLoopCountByState.set(tr.sourcePath, loopIdx + 1);
      const { points, labelPosition } = buildSelfLoopGeometry(sourceRect, loopIdx, isTargetless);
      edges.push({
        transition: tr,
        points,
        labelPosition,
        isSelfLoop: true,
        isTargetless,
      });
      continue;
    }

    const targetRect = nodeMap[tr.targetPath!];
    if (!targetRect) continue;

    const hasManualMove = sourceRect.hasManualPosition || targetRect.hasManualPosition;
    const elkEntry = elkEdgesById.get(tr.id);

    if (!hasManualMove && elkEntry?.edge.sections && elkEntry.edge.sections.length > 0) {
      const section = elkEntry.edge.sections[0];
      const ox = elkEntry.containerOffset.x;
      const oy = elkEntry.containerOffset.y;
      const points: Point2D[] = [
        { x: section.startPoint.x + ox, y: section.startPoint.y + oy },
        ...(section.bendPoints ?? []).map((p) => ({ x: p.x + ox, y: p.y + oy })),
        { x: section.endPoint.x + ox, y: section.endPoint.y + oy },
      ];
      const elkLabel = elkEntry.edge.labels?.[0];
      const labelPosition =
        elkLabel && elkLabel.x !== undefined && elkLabel.y !== undefined
          ? {
              x: elkLabel.x + ox + (elkLabel.width ?? 0) / 2,
              y: elkLabel.y + oy + (elkLabel.height ?? 0) / 2,
            }
          : midpointOnPolyline(points);
      edges.push({
        transition: tr,
        points,
        labelPosition,
        isSelfLoop: false,
        isTargetless: false,
      });
    } else {
      const points = computeDirectEdgePoints(sourceRect, targetRect);
      edges.push({
        transition: tr,
        points,
        labelPosition: midpointOnPolyline(points),
        isSelfLoop: false,
        isTargetless: false,
      });
    }
  }

  let maxX = laidOut.width ?? 800;
  let maxY = laidOut.height ?? 600;
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + n.width + 80);
    maxY = Math.max(maxY, n.y + n.height + 80);
  }
  for (const note of doc.notes) {
    maxX = Math.max(maxX, note.x + (note.width ?? 220) + 80);
    maxY = Math.max(maxY, note.y + 180);
  }

  return {
    width: Math.ceil(maxX),
    height: Math.ceil(maxY),
    nodes,
    nodeMap,
    edges,
  };
}

export function buildSvgPath(points: Point2D[], routing: VisualizerConfig["edgeRouting"]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  if (routing === "SPLINES" && points.length >= 3) {
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      const midX = (curr.x + next.x) / 2;
      const midY = (curr.y + next.y) / 2;
      d += ` Q ${curr.x} ${curr.y} ${midX} ${midY}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
  }

  if (routing === "ORTHOGONAL" && points.length >= 3) {
    const cornerRadius = 8;
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];
      const v1x = curr.x - prev.x;
      const v1y = curr.y - prev.y;
      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;
      const len1 = Math.hypot(v1x, v1y);
      const len2 = Math.hypot(v2x, v2y);
      if (len1 < 1 || len2 < 1) {
        d += ` L ${curr.x} ${curr.y}`;
        continue;
      }
      const r = Math.min(cornerRadius, len1 / 2, len2 / 2);
      const p1x = curr.x - (v1x / len1) * r;
      const p1y = curr.y - (v1y / len1) * r;
      const p2x = curr.x + (v2x / len2) * r;
      const p2y = curr.y + (v2y / len2) * r;
      d += ` L ${p1x} ${p1y} Q ${curr.x} ${curr.y} ${p2x} ${p2y}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
  }

  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

export type { StateNodeDocument };
