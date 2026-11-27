import type { AnyActor, AnyStateMachine } from "xstate";
import { exportMachine, importMachineSource } from "./core/codegen.ts";
import { computeLayout } from "./core/layout.ts";
import {
  addNote,
  addState,
  addTransition,
  clearLayoutOverrides,
  createEmptyMachine,
  deleteNote,
  deleteState,
  deleteTransition,
  renameState,
  setInitialState,
  setNodePosition,
  updateMachineMeta,
  updateNote,
  updateState,
  updateTransition,
} from "./core/operations.ts";
import { AUTH_FLOW_PRESET, MACHINE_PRESETS } from "./core/presets.ts";
import { MachineSimulator } from "./core/simulator.ts";
import {
  DEFAULT_VISUALIZER_CONFIG,
  type AccentColor,
  type CanvasNote,
  type ComputedLayout,
  type ExportFormat,
  type MachineDocument,
  type SimulationState,
  type StateNodeDocument,
  type StateNodeType,
  type StoredMachineRecord,
  type TransitionDocument,
  type TransitionKind,
  type VisualizerConfig,
  type VisualizerMode,
  type VisualizerSelection,
} from "./core/types.ts";
import {
  fromXStateConfig,
  fromXStateMachine,
  type CompileRuntimeOptions,
} from "./core/xstate-adapter.ts";
import { createBrowserStorage } from "./storage/indexeddb.ts";
import type { MachineStorage } from "./storage/types.ts";

export interface VisualizerControllerSnapshot {
  machine: MachineDocument;
  config: VisualizerConfig;
  selection: VisualizerSelection;
  layout: ComputedLayout | null;
  layoutLoading: boolean;
  simulation: SimulationState;
  savedMachines: StoredMachineRecord[];
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  lastError: string | null;
}

export interface VisualizerEventMap {
  machineChange: MachineDocument;
  configChange: VisualizerConfig;
  selectionChange: VisualizerSelection;
  modeChange: VisualizerMode;
  simulationChange: SimulationState;
  storageChange: StoredMachineRecord[];
  error: string;
}

export interface VisualizerControllerOptions {
  machine?: MachineDocument | AnyStateMachine | Record<string, unknown>;
  config?: Partial<VisualizerConfig>;
  storage?: MachineStorage;
  seedPresetsIfEmpty?: boolean;
  runtimeOptions?: Omit<CompileRuntimeOptions, "guardOverrides" | "onActionFired">;
}

function isAnyStateMachine(value: unknown): value is AnyStateMachine {
  return Boolean(
    value &&
      typeof value === "object" &&
      "config" in value &&
      typeof (value as { transition?: unknown }).transition === "function",
  );
}

function isMachineDocument(value: unknown): value is MachineDocument {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { version?: unknown }).version === 1 &&
      typeof (value as { states?: unknown }).states === "object",
  );
}

export function normalizeMachineInput(
  input?: MachineDocument | AnyStateMachine | Record<string, unknown>,
): MachineDocument {
  if (!input) return structuredClone(AUTH_FLOW_PRESET);
  if (isMachineDocument(input)) return structuredClone(input);
  if (isAnyStateMachine(input)) return fromXStateMachine(input);
  return fromXStateConfig(input);
}

export class VisualizerController {
  private machine: MachineDocument;
  private config: VisualizerConfig;
  private selection: VisualizerSelection = { kind: "machine" };
  private layout: ComputedLayout | null = null;
  private layoutLoading = false;
  private layoutNonce = 0;
  private undoStack: MachineDocument[] = [];
  private redoStack: MachineDocument[] = [];
  private savedMachines: StoredMachineRecord[] = [];
  private dirty = false;
  private lastError: string | null = null;

  private readonly storage: MachineStorage;
  private readonly simulator: MachineSimulator;
  private readonly seedPresetsIfEmpty: boolean;
  private readonly listeners = new Set<(snap: VisualizerControllerSnapshot) => void>();
  private readonly eventListeners = new Map<keyof VisualizerEventMap, Set<(payload: unknown) => void>>();
  private cachedSnapshot: VisualizerControllerSnapshot | null = null;
  private viewportActionHandlers = new Set<(action: "fit" | "zoomIn" | "zoomOut" | "resetZoom") => void>();

  constructor(options: VisualizerControllerOptions = {}) {
    this.config = { ...DEFAULT_VISUALIZER_CONFIG, ...options.config };
    this.machine = normalizeMachineInput(options.machine);
    this.storage = options.storage ?? createBrowserStorage(this.config.storageDbName);
    this.seedPresetsIfEmpty = options.seedPresetsIfEmpty ?? true;
    this.simulator = new MachineSimulator(this.machine, options.runtimeOptions);

    this.simulator.subscribe((simState) => {
      this.emitEvent("simulationChange", simState);
      this.notify();
    });

    if (this.config.mode === "simulate") {
      this.simulator.start();
    }

    void this.recomputeLayout();
    if (this.config.enableBrowserStorage) {
      void this.refreshStorage(this.seedPresetsIfEmpty);
    }
  }

  subscribe(listener: (snap: VisualizerControllerSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  on<K extends keyof VisualizerEventMap>(
    event: K,
    handler: (payload: VisualizerEventMap[K]) => void,
  ): () => void {
    let set = this.eventListeners.get(event);
    if (!set) {
      set = new Set();
      this.eventListeners.set(event, set);
    }
    set.add(handler as (payload: unknown) => void);
    return () => {
      set?.delete(handler as (payload: unknown) => void);
    };
  }

  onViewportAction(
    handler: (action: "fit" | "zoomIn" | "zoomOut" | "resetZoom") => void,
  ): () => void {
    this.viewportActionHandlers.add(handler);
    return () => {
      this.viewportActionHandlers.delete(handler);
    };
  }

  fitView(): void {
    for (const h of this.viewportActionHandlers) h("fit");
  }

  zoomIn(): void {
    for (const h of this.viewportActionHandlers) h("zoomIn");
  }

  zoomOut(): void {
    for (const h of this.viewportActionHandlers) h("zoomOut");
  }

  resetZoom(): void {
    for (const h of this.viewportActionHandlers) h("resetZoom");
  }

  private emitEvent<K extends keyof VisualizerEventMap>(
    event: K,
    payload: VisualizerEventMap[K],
  ): void {
    const set = this.eventListeners.get(event);
    if (!set) return;
    for (const handler of set) {
      handler(payload);
    }
  }

  private notify(): void {
    this.cachedSnapshot = null;
    const snap = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snap);
    }
  }

  getSnapshot(): VisualizerControllerSnapshot {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = {
        machine: this.machine,
        config: this.config,
        selection: this.selection,
        layout: this.layout,
        layoutLoading: this.layoutLoading,
        simulation: this.simulator.getState(),
        savedMachines: this.savedMachines,
        dirty: this.dirty,
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0,
        lastError: this.lastError,
      };
    }
    return this.cachedSnapshot;
  }

  getMachine(): MachineDocument {
    return this.machine;
  }

  getConfig(): VisualizerConfig {
    return this.config;
  }

  clearError(): void {
    if (!this.lastError) return;
    this.lastError = null;
    this.notify();
  }

  private reportError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.lastError = message;
    this.emitEvent("error", message);
    this.notify();
  }

  setConfig(partial: Partial<VisualizerConfig>): void {
    const prev = this.config;
    this.config = { ...this.config, ...partial };
    this.emitEvent("configChange", this.config);

    if (partial.mode && partial.mode !== prev.mode) {
      this.emitEvent("modeChange", partial.mode);
      if (partial.mode === "simulate") {
        this.simulator.setDocument(this.machine, false);
        this.simulator.start();
      } else {
        this.simulator.stop();
      }
    }

    const layoutKeys: Array<keyof VisualizerConfig> = [
      "layoutDirection",
      "nodeSpacing",
      "layerSpacing",
      "edgeRouting",
      "showDescriptions",
      "showTags",
      "showActions",
      "showInvoke",
    ];
    if (layoutKeys.some((k) => partial[k] !== undefined && partial[k] !== prev[k])) {
      void this.recomputeLayout();
    } else {
      this.notify();
    }
  }

  setMode(mode: VisualizerMode): void {
    this.setConfig({ mode });
  }

  select(selection: VisualizerSelection): void {
    this.selection = selection;
    this.emitEvent("selectionChange", selection);
    this.notify();
  }

  private commitMachine(next: MachineDocument, options?: { recordHistory?: boolean; markDirty?: boolean }): void {
    const recordHistory = options?.recordHistory ?? true;
    if (recordHistory) {
      this.undoStack.push(this.machine);
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
    }
    this.machine = next;
    this.dirty = options?.markDirty ?? true;
    this.lastError = null;
    this.simulator.setDocument(this.machine, this.config.mode === "simulate");
    this.emitEvent("machineChange", this.machine);
    void this.recomputeLayout();
  }

  setMachine(
    input: MachineDocument | AnyStateMachine | Record<string, unknown>,
    options?: { markDirty?: boolean },
  ): void {
    const doc = normalizeMachineInput(input);
    this.undoStack = [];
    this.redoStack = [];
    this.selection = { kind: "machine" };
    this.commitMachine(doc, { recordHistory: false, markDirty: options?.markDirty ?? false });
  }

  loadPreset(presetId: string): void {
    const preset = MACHINE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.setMachine(structuredClone(preset.document), { markDirty: false });
  }

  createNewMachine(name?: string): void {
    const doc = createEmptyMachine(name);
    this.setMachine(doc, { markDirty: true });
  }

  undo(): void {
    if (this.config.readOnly || this.undoStack.length === 0) return;
    const prev = this.undoStack.pop()!;
    this.redoStack.push(this.machine);
    this.machine = prev;
    this.dirty = true;
    this.simulator.setDocument(this.machine, this.config.mode === "simulate");
    this.emitEvent("machineChange", this.machine);
    void this.recomputeLayout();
  }

  redo(): void {
    if (this.config.readOnly || this.redoStack.length === 0) return;
    const next = this.redoStack.pop()!;
    this.undoStack.push(this.machine);
    this.machine = next;
    this.dirty = true;
    this.simulator.setDocument(this.machine, this.config.mode === "simulate");
    this.emitEvent("machineChange", this.machine);
    void this.recomputeLayout();
  }

  async recomputeLayout(): Promise<ComputedLayout | null> {
    const nonce = ++this.layoutNonce;
    this.layoutLoading = true;
    this.notify();
    try {
      const computed = await computeLayout(this.machine, this.config);
      if (nonce !== this.layoutNonce) return this.layout;
      this.layout = computed;
      this.layoutLoading = false;
      this.notify();
      return computed;
    } catch (err) {
      if (nonce === this.layoutNonce) {
        this.layoutLoading = false;
        this.reportError(err);
      }
      return null;
    }
  }

  autoLayout(): void {
    this.commitMachine(clearLayoutOverrides(this.machine));
  }

  // ---- Design-mode mutations ----

  addState(options?: {
    parentPath?: string | null;
    name?: string;
    type?: StateNodeType;
    position?: { x: number; y: number };
  }): string | null {
    if (this.config.readOnly) return null;
    try {
      const res = addState(this.machine, options);
      this.selection = { kind: "state", path: res.statePath };
      this.commitMachine(res.document);
      return res.statePath;
    } catch (err) {
      this.reportError(err);
      return null;
    }
  }

  renameState(statePath: string, newKey: string): string | null {
    if (this.config.readOnly) return null;
    try {
      const res = renameState(this.machine, statePath, newKey);
      if (this.selection.kind === "state" && this.selection.path === statePath) {
        this.selection = { kind: "state", path: res.newPath };
      }
      this.commitMachine(res.document);
      return res.newPath;
    } catch (err) {
      this.reportError(err);
      return null;
    }
  }

  deleteState(statePath: string): void {
    if (this.config.readOnly) return;
    if (this.selection.kind === "state" && this.selection.path === statePath) {
      this.selection = { kind: "machine" };
    }
    this.commitMachine(deleteState(this.machine, statePath));
  }

  updateState(statePath: string, patch: Partial<StateNodeDocument>): void {
    if (this.config.readOnly) return;
    this.commitMachine(updateState(this.machine, statePath, patch));
  }

  setInitialState(statePath: string): void {
    if (this.config.readOnly) return;
    this.commitMachine(setInitialState(this.machine, statePath));
  }

  addTransition(params: {
    sourcePath: string;
    targetPath?: string;
    kind?: TransitionKind;
    eventKey?: string;
    invokeId?: string;
    guard?: string;
    description?: string;
    color?: AccentColor;
  }): string | null {
    if (this.config.readOnly) return null;
    try {
      const res = addTransition(this.machine, params);
      this.selection = {
        kind: "transition",
        sourcePath: params.sourcePath,
        transitionKind: res.kind,
        eventKey: res.eventKey,
        invokeId: params.invokeId,
        transitionId: res.transitionId,
      };
      this.commitMachine(res.document);
      return res.transitionId;
    } catch (err) {
      this.reportError(err);
      return null;
    }
  }

  updateTransition(
    locator: {
      sourcePath: string;
      kind: TransitionKind;
      eventKey?: string;
      invokeId?: string;
      transitionId: string;
    },
    patch: Partial<TransitionDocument> & {
      nextKind?: TransitionKind;
      nextEventKey?: string;
      nextInvokeId?: string;
    },
  ): void {
    if (this.config.readOnly) return;
    const res = updateTransition(this.machine, locator, patch);
    this.selection = {
      kind: "transition",
      sourcePath: res.locator.sourcePath,
      transitionKind: res.locator.kind,
      eventKey: res.locator.eventKey,
      invokeId: res.locator.invokeId,
      transitionId: res.locator.transitionId,
    };
    this.commitMachine(res.document);
  }

  deleteTransition(locator: {
    sourcePath: string;
    kind: TransitionKind;
    eventKey?: string;
    invokeId?: string;
    transitionId: string;
  }): void {
    if (this.config.readOnly) return;
    this.selection = { kind: "machine" };
    this.commitMachine(deleteTransition(this.machine, locator));
  }

  updateMachineMeta(
    patch: Partial<Pick<MachineDocument, "id" | "name" | "description" | "type" | "initial" | "context">>,
  ): void {
    if (this.config.readOnly) return;
    this.commitMachine(updateMachineMeta(this.machine, patch));
  }

  addNote(note?: Partial<Omit<CanvasNote, "id">>): string | null {
    if (this.config.readOnly) return null;
    const res = addNote(this.machine, note);
    this.selection = { kind: "note", noteId: res.noteId };
    this.commitMachine(res.document);
    return res.noteId;
  }

  updateNote(noteId: string, patch: Partial<Omit<CanvasNote, "id">>): void {
    if (this.config.readOnly) return;
    this.commitMachine(updateNote(this.machine, noteId, patch));
  }

  deleteNote(noteId: string): void {
    if (this.config.readOnly) return;
    if (this.selection.kind === "note" && this.selection.noteId === noteId) {
      this.selection = { kind: "machine" };
    }
    this.commitMachine(deleteNote(this.machine, noteId));
  }

  moveNode(statePath: string, position: { x: number; y: number }): void {
    if (this.config.readOnly) return;
    this.commitMachine(setNodePosition(this.machine, statePath, position));
  }

  // ---- Simulation controls ----

  sendEvent(event: { type: string; [key: string]: unknown }): void {
    if (this.config.mode !== "simulate") {
      this.setMode("simulate");
    }
    this.simulator.send(event);
  }

  triggerDelay(sourcePath: string, delayKey: string): void {
    this.simulator.triggerDelay(sourcePath, delayKey);
  }

  triggerInvokeDone(invokeId: string, output?: unknown): void {
    this.simulator.triggerInvokeDone(invokeId, output);
  }

  triggerInvokeError(invokeId: string, error?: unknown): void {
    this.simulator.triggerInvokeError(invokeId, error);
  }

  setGuardOverride(guardName: string, value: boolean): void {
    this.simulator.setGuardOverride(guardName, value);
  }

  stepBackSimulation(): void {
    this.simulator.stepBack();
  }

  resetSimulation(): void {
    this.simulator.reset();
  }

  attachActor(actor: AnyActor): void {
    this.config = { ...this.config, mode: "simulate" };
    this.simulator.attachActor(actor);
    this.emitEvent("modeChange", "simulate");
    this.notify();
  }

  detachActor(): void {
    this.simulator.detachActor();
  }

  // ---- Code import / export ----

  exportCode(format: ExportFormat): string {
    return exportMachine(this.machine, format);
  }

  importSource(source: string, fallbackName?: string): MachineDocument {
    const doc = importMachineSource(source, fallbackName);
    this.commitMachine(doc, { recordHistory: true, markDirty: true });
    this.selection = { kind: "machine" };
    return doc;
  }

  // ---- Browser DB storage ----

  async refreshStorage(seedIfEmpty = false): Promise<StoredMachineRecord[]> {
    try {
      let records = await this.storage.list();
      if (records.length === 0 && seedIfEmpty) {
        for (const preset of MACHINE_PRESETS) {
          await this.storage.save(preset.document);
        }
        records = await this.storage.list();
      }
      this.savedMachines = records;
      this.emitEvent("storageChange", records);
      this.notify();
      return records;
    } catch (err) {
      this.reportError(err);
      return [];
    }
  }

  async saveToStorage(): Promise<StoredMachineRecord | null> {
    try {
      const saved = await this.storage.save(this.machine);
      this.dirty = false;
      await this.refreshStorage(false);
      return saved;
    } catch (err) {
      this.reportError(err);
      return null;
    }
  }

  async loadFromStorage(id: string): Promise<MachineDocument | null> {
    try {
      const rec = await this.storage.get(id);
      if (!rec) return null;
      this.setMachine(rec.document, { markDirty: false });
      return rec.document;
    } catch (err) {
      this.reportError(err);
      return null;
    }
  }

  async deleteFromStorage(id: string): Promise<void> {
    try {
      await this.storage.delete(id);
      await this.refreshStorage(false);
    } catch (err) {
      this.reportError(err);
    }
  }

  async duplicateInStorage(id: string): Promise<StoredMachineRecord | null> {
    try {
      const dup = await this.storage.duplicate(id);
      await this.refreshStorage(false);
      return dup;
    } catch (err) {
      this.reportError(err);
      return null;
    }
  }

  destroy(): void {
    this.simulator.stop();
    this.listeners.clear();
    this.eventListeners.clear();
    this.viewportActionHandlers.clear();
  }
}

export function createVisualizerController(
  options: VisualizerControllerOptions = {},
): VisualizerController {
  return new VisualizerController(options);
}
