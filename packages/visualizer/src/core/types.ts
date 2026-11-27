export type StateNodeType = "atomic" | "compound" | "parallel" | "final" | "history";

export type HistoryKind = "shallow" | "deep";

export type TransitionKind =
  | "on"
  | "always"
  | "after"
  | "onDone"
  | "invokeDone"
  | "invokeError";

export type AccentColor =
  | "default"
  | "blue"
  | "indigo"
  | "purple"
  | "pink"
  | "red"
  | "orange"
  | "amber"
  | "green"
  | "teal"
  | "slate";

export const ACCENT_COLORS: Record<
  AccentColor,
  { label: string; border: string; bgDark: string; bgLight: string; badge: string }
> = {
  default: {
    label: "Default",
    border: "var(--smv-node-border)",
    bgDark: "var(--smv-node-bg)",
    bgLight: "var(--smv-node-bg)",
    badge: "#3b82f6",
  },
  blue: {
    label: "Blue",
    border: "#3b82f6",
    bgDark: "rgba(59, 130, 246, 0.14)",
    bgLight: "rgba(59, 130, 246, 0.10)",
    badge: "#3b82f6",
  },
  indigo: {
    label: "Indigo",
    border: "#6366f1",
    bgDark: "rgba(99, 102, 241, 0.15)",
    bgLight: "rgba(99, 102, 241, 0.10)",
    badge: "#6366f1",
  },
  purple: {
    label: "Purple",
    border: "#a855f7",
    bgDark: "rgba(168, 85, 247, 0.15)",
    bgLight: "rgba(168, 85, 247, 0.10)",
    badge: "#a855f7",
  },
  pink: {
    label: "Pink",
    border: "#ec4899",
    bgDark: "rgba(236, 72, 153, 0.15)",
    bgLight: "rgba(236, 72, 153, 0.10)",
    badge: "#ec4899",
  },
  red: {
    label: "Red",
    border: "#ef4444",
    bgDark: "rgba(239, 68, 68, 0.15)",
    bgLight: "rgba(239, 68, 68, 0.10)",
    badge: "#ef4444",
  },
  orange: {
    label: "Orange",
    border: "#f97316",
    bgDark: "rgba(249, 115, 22, 0.15)",
    bgLight: "rgba(249, 115, 22, 0.10)",
    badge: "#f97316",
  },
  amber: {
    label: "Amber",
    border: "#f59e0b",
    bgDark: "rgba(245, 158, 11, 0.16)",
    bgLight: "rgba(245, 158, 11, 0.11)",
    badge: "#f59e0b",
  },
  green: {
    label: "Green",
    border: "#22c55e",
    bgDark: "rgba(34, 197, 94, 0.15)",
    bgLight: "rgba(34, 197, 94, 0.10)",
    badge: "#22c55e",
  },
  teal: {
    label: "Teal",
    border: "#14b8a6",
    bgDark: "rgba(20, 184, 166, 0.15)",
    bgLight: "rgba(20, 184, 166, 0.10)",
    badge: "#14b8a6",
  },
  slate: {
    label: "Slate",
    border: "#64748b",
    bgDark: "rgba(100, 116, 139, 0.18)",
    bgLight: "rgba(100, 116, 139, 0.12)",
    badge: "#64748b",
  },
};

export interface ActionRef {
  type: string;
  params?: Record<string, unknown>;
}

export interface TransitionDocument {
  id: string;
  target?: string;
  guard?: string;
  actions?: ActionRef[];
  description?: string;
  reenter?: boolean;
  color?: AccentColor;
}

export interface InvokeDocument {
  id: string;
  src: string;
  description?: string;
  onDone?: TransitionDocument[];
  onError?: TransitionDocument[];
}

export interface StateNodeDocument {
  type?: StateNodeType;
  history?: HistoryKind;
  initial?: string;
  description?: string;
  tags?: string[];
  color?: AccentColor;
  entry?: ActionRef[];
  exit?: ActionRef[];
  invoke?: InvokeDocument[];
  on?: Record<string, TransitionDocument[]>;
  always?: TransitionDocument[];
  after?: Record<string, TransitionDocument[]>;
  onDone?: TransitionDocument[];
  states?: Record<string, StateNodeDocument>;
  meta?: Record<string, unknown>;
  output?: unknown;
}

export interface CanvasNote {
  id: string;
  text: string;
  x: number;
  y: number;
  width?: number;
  color?: AccentColor;
  anchorStatePath?: string;
}

export interface NodePosition {
  x: number;
  y: number;
}

export interface MachineDocument {
  version: 1;
  id: string;
  name: string;
  description?: string;
  type?: "compound" | "parallel";
  initial?: string;
  context: Record<string, unknown>;
  states: Record<string, StateNodeDocument>;
  notes: CanvasNote[];
  layout?: Record<string, NodePosition>;
}

export interface StoredMachineRecord {
  id: string;
  name: string;
  description?: string;
  document: MachineDocument;
  createdAt: number;
  updatedAt: number;
}

export type VisualizerMode = "design" | "simulate";
export type VisualizerTheme = "dark" | "light" | "system";
export type LayoutDirection = "RIGHT" | "DOWN" | "LEFT" | "UP";
export type EdgeRouting = "ORTHOGONAL" | "POLYLINE" | "SPLINES";
export type CanvasTool = "select" | "pan";
export type RightPanelTab = "details" | "simulate" | "code" | "settings";
export type ExportFormat = "typescript" | "javascript" | "xstate-json" | "document-json" | "mermaid";

export interface VisualizerConfig {
  mode: VisualizerMode;
  readOnly: boolean;
  theme: VisualizerTheme;
  layoutDirection: LayoutDirection;
  autoLayout: boolean;
  translucentEvents: boolean;
  showGrid: boolean;
  showMinimap: boolean;
  showDescriptions: boolean;
  showTags: boolean;
  showActions: boolean;
  showGuards: boolean;
  showInvoke: boolean;
  showNotes: boolean;
  showColors: boolean;
  fadeColorsInSimulate: boolean;
  showToolbar: boolean;
  showLeftPanel: boolean;
  showRightPanel: boolean;
  defaultRightTab: RightPanelTab;
  canvasTool: CanvasTool;
  nodeSpacing: number;
  layerSpacing: number;
  edgeRouting: EdgeRouting;
  zoomMin: number;
  zoomMax: number;
  enableBrowserStorage: boolean;
  storageDbName: string;
  enableFileIO: boolean;
  enableKeyboardShortcuts: boolean;
}

export const DEFAULT_VISUALIZER_CONFIG: VisualizerConfig = {
  mode: "design",
  readOnly: false,
  theme: "dark",
  layoutDirection: "RIGHT",
  autoLayout: true,
  translucentEvents: true,
  showGrid: true,
  showMinimap: true,
  showDescriptions: true,
  showTags: true,
  showActions: true,
  showGuards: true,
  showInvoke: true,
  showNotes: true,
  showColors: true,
  fadeColorsInSimulate: true,
  showToolbar: true,
  showLeftPanel: true,
  showRightPanel: true,
  defaultRightTab: "details",
  canvasTool: "select",
  nodeSpacing: 36,
  layerSpacing: 64,
  edgeRouting: "ORTHOGONAL",
  zoomMin: 0.15,
  zoomMax: 2.5,
  enableBrowserStorage: true,
  storageDbName: "state-machine-visualizer",
  enableFileIO: true,
  enableKeyboardShortcuts: true,
};

export type VisualizerSelection =
  | { kind: "machine" }
  | { kind: "state"; path: string }
  | {
      kind: "transition";
      sourcePath: string;
      transitionKind: TransitionKind;
      eventKey?: string;
      invokeId?: string;
      transitionId: string;
    }
  | { kind: "note"; noteId: string };

export interface FlattenedTransition {
  id: string;
  sourcePath: string;
  targetPath: string | null;
  rawTarget?: string;
  kind: TransitionKind;
  eventKey?: string;
  invokeId?: string;
  label: string;
  transition: TransitionDocument;
}

export interface LayoutNodeRect {
  path: string;
  key: string;
  parentPath: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  node: StateNodeDocument;
  resolvedType: StateNodeType;
  isInitial: boolean;
  depth: number;
  hasManualPosition: boolean;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface LayoutEdgeGeometry {
  transition: FlattenedTransition;
  points: Point2D[];
  labelPosition: Point2D;
  isSelfLoop: boolean;
  isTargetless: boolean;
}

export interface ComputedLayout {
  width: number;
  height: number;
  nodes: LayoutNodeRect[];
  nodeMap: Record<string, LayoutNodeRect>;
  edges: LayoutEdgeGeometry[];
}

export interface SimulationLogEntry {
  id: string;
  timestamp: number;
  eventType: string;
  payload?: Record<string, unknown>;
  fromStates: string[];
  toStates: string[];
  actionsFired: string[];
}

export interface AvailableTransitionInfo {
  transition: FlattenedTransition;
  enabled: boolean;
  blockedByGuard?: string;
  isDelay?: boolean;
  delayMs?: number;
  isInvoke?: boolean;
  invokeId?: string;
}

export interface ActiveInvokeInfo {
  statePath: string;
  invoke: InvokeDocument;
}

export interface SimulationState {
  running: boolean;
  status: "active" | "done" | "error" | "stopped";
  activeStatePaths: string[];
  stateValue: unknown;
  context: Record<string, unknown>;
  availableTransitions: AvailableTransitionInfo[];
  activeInvokes: ActiveInvokeInfo[];
  guardOverrides: Record<string, boolean>;
  knownGuards: string[];
  log: SimulationLogEntry[];
  canStepBack: boolean;
  externalActorAttached: boolean;
  error?: string;
}

export function createId(prefix = "id"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
