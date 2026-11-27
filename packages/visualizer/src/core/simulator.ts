import {
  createActor,
  type AnyActor,
  type AnyMachineSnapshot,
  type AnyStateMachine,
  type Subscription,
} from "xstate";
import {
  createId,
  type ActiveInvokeInfo,
  type AvailableTransitionInfo,
  type MachineDocument,
  type SimulationLogEntry,
  type SimulationState,
} from "./types.ts";
import {
  collectMachineSymbols,
  compileRuntimeMachine,
  extractActiveStatePaths,
  getStateAtPath,
  listAllTransitions,
  type CompileRuntimeOptions,
} from "./xstate-adapter.ts";

interface HistoryFrame {
  snapshot: AnyMachineSnapshot;
  logLength: number;
}

export class MachineSimulator {
  private doc: MachineDocument;
  private runtimeOptions: Omit<CompileRuntimeOptions, "guardOverrides" | "onActionFired">;
  private guardOverrides: Record<string, boolean> = {};
  private actor: AnyActor | null = null;
  private machine: AnyStateMachine | null = null;
  private externalActor: AnyActor | null = null;
  private subscription: Subscription | null = null;
  private pendingActions: string[] = [];
  private log: SimulationLogEntry[] = [];
  private history: HistoryFrame[] = [];
  private lastActiveStates: string[] = [];
  private errorMessage: string | undefined;
  private listeners = new Set<(state: SimulationState) => void>();

  constructor(
    doc: MachineDocument,
    runtimeOptions: Omit<CompileRuntimeOptions, "guardOverrides" | "onActionFired"> = {},
  ) {
    this.doc = doc;
    this.runtimeOptions = runtimeOptions;
    this.syncGuardDefaults();
  }

  private syncGuardDefaults(): void {
    const { guards } = collectMachineSymbols(this.doc);
    const next: Record<string, boolean> = {};
    for (const g of guards) {
      next[g] = g in this.guardOverrides ? this.guardOverrides[g] : true;
    }
    this.guardOverrides = next;
  }

  subscribe(listener: (state: SimulationState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  setDocument(doc: MachineDocument, restartIfRunning = true): void {
    const wasRunning = this.actor !== null && !this.externalActor;
    this.doc = doc;
    this.syncGuardDefaults();
    if (wasRunning && restartIfRunning) {
      this.start();
    } else {
      this.emit();
    }
  }

  start(persistedSnapshot?: AnyMachineSnapshot): void {
    this.stopInternal();
    this.errorMessage = undefined;
    this.pendingActions = [];
    this.log = [];
    this.history = [];

    try {
      const machine = compileRuntimeMachine(this.doc, {
        ...this.runtimeOptions,
        guardOverrides: this.guardOverrides,
        onActionFired: (actionName) => {
          this.pendingActions.push(actionName);
        },
      });
      this.machine = machine;
      const actor = createActor(machine, persistedSnapshot ? { snapshot: persistedSnapshot } : undefined);
      this.actor = actor;

      this.subscription = actor.subscribe((snap) => {
        this.lastActiveStates = extractActiveStatePaths(snap as AnyMachineSnapshot);
        this.emit();
      });

      actor.start();
      const initialSnap = actor.getSnapshot() as AnyMachineSnapshot;
      this.lastActiveStates = extractActiveStatePaths(initialSnap);
      this.log.push({
        id: createId("sim"),
        timestamp: Date.now(),
        eventType: "xstate.init",
        fromStates: [],
        toStates: [...this.lastActiveStates],
        actionsFired: this.flushActions(),
      });
      this.emit();
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.emit();
    }
  }

  stop(): void {
    this.stopInternal();
    this.emit();
  }

  private stopInternal(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    if (this.actor && !this.externalActor) {
      try {
        this.actor.stop();
      } catch {
        // Ignore stop errors from partially initialized actors
      }
    }
    this.actor = null;
    this.externalActor = null;
    this.machine = null;
  }

  /**
   * Attach an externally managed, already-running XState v5 Actor so the visualizer
   * reflects its live snapshots and events in real time.
   */
  attachActor(actor: AnyActor): void {
    this.stopInternal();
    this.externalActor = actor;
    this.actor = actor;
    this.errorMessage = undefined;
    this.log = [];
    this.history = [];

    const initial = actor.getSnapshot() as AnyMachineSnapshot;
    this.lastActiveStates = extractActiveStatePaths(initial);

    this.subscription = actor.subscribe((snap) => {
      const nextPaths = extractActiveStatePaths(snap as AnyMachineSnapshot);
      this.log.push({
        id: createId("sim"),
        timestamp: Date.now(),
        eventType: "external.snapshot",
        fromStates: [...this.lastActiveStates],
        toStates: nextPaths,
        actionsFired: [],
      });
      this.lastActiveStates = nextPaths;
      this.emit();
    });

    this.emit();
  }

  detachActor(): void {
    if (!this.externalActor) return;
    this.stopInternal();
    this.emit();
  }

  send(event: { type: string; [key: string]: unknown }): void {
    if (!this.actor) {
      this.start();
    }
    if (!this.actor) return;

    const prevSnap = this.actor.getSnapshot() as AnyMachineSnapshot;
    const fromStates = extractActiveStatePaths(prevSnap);

    if (!this.externalActor) {
      this.history.push({
        snapshot: prevSnap,
        logLength: this.log.length,
      });
    }

    this.pendingActions = [];
    this.actor.send(event);

    const nextSnap = this.actor.getSnapshot() as AnyMachineSnapshot;
    const toStates = extractActiveStatePaths(nextSnap);
    const { type, ...rest } = event;
    const payload = Object.keys(rest).length > 0 ? rest : undefined;

    this.log.push({
      id: createId("sim"),
      timestamp: Date.now(),
      eventType: type,
      ...(payload ? { payload } : {}),
      fromStates,
      toStates,
      actionsFired: this.flushActions(),
    });
    this.lastActiveStates = toStates;
    this.emit();
  }

  triggerDelay(sourcePath: string, delayKey: string): void {
    const fullStateId = `${this.doc.id}.${sourcePath}`;
    this.send({ type: `xstate.after.${delayKey}.${fullStateId}` });
  }

  triggerInvokeDone(invokeId: string, output: unknown = {}): void {
    this.send({ type: `xstate.done.actor.${invokeId}`, output });
  }

  triggerInvokeError(invokeId: string, error: unknown = { message: "Simulated invoke error" }): void {
    this.send({ type: `xstate.error.actor.${invokeId}`, error });
  }

  setGuardOverride(guardName: string, value: boolean): void {
    this.guardOverrides = { ...this.guardOverrides, [guardName]: value };
    // Guard functions close over `this.guardOverrides` object reference only if mutated in place,
    // so re-evaluate on next transition by also keeping the object updated when running.
    if (this.actor && !this.externalActor) {
      const currentSnap = this.actor.getSnapshot() as AnyMachineSnapshot;
      const savedLog = [...this.log];
      const savedHistory = [...this.history];
      this.start(currentSnap);
      this.log = savedLog;
      this.history = savedHistory;
      this.emit();
    } else {
      this.emit();
    }
  }

  stepBack(): void {
    if (this.externalActor || this.history.length === 0) return;
    const frame = this.history.pop()!;
    const trimmedLog = this.log.slice(0, frame.logLength);
    const savedHistory = [...this.history];
    this.start(frame.snapshot);
    this.log = trimmedLog;
    this.history = savedHistory;
    this.emit();
  }

  reset(): void {
    if (this.externalActor) return;
    this.start();
  }

  private flushActions(): string[] {
    const out = [...this.pendingActions];
    this.pendingActions = [];
    return out;
  }

  getState(): SimulationState {
    const { guards } = collectMachineSymbols(this.doc);
    if (!this.actor) {
      return {
        running: false,
        status: "stopped",
        activeStatePaths: [],
        stateValue: undefined,
        context: this.doc.context ?? {},
        availableTransitions: [],
        activeInvokes: [],
        guardOverrides: { ...this.guardOverrides },
        knownGuards: guards,
        log: [...this.log],
        canStepBack: false,
        externalActorAttached: false,
        ...(this.errorMessage ? { error: this.errorMessage } : {}),
      };
    }

    const snap = this.actor.getSnapshot() as AnyMachineSnapshot;
    const activePaths = extractActiveStatePaths(snap);
    const activeSet = new Set(activePaths);
    const allTransitions = listAllTransitions(this.doc);

    const availableTransitions: AvailableTransitionInfo[] = [];
    for (const tr of allTransitions) {
      if (!activeSet.has(tr.sourcePath)) continue;
      if (tr.kind === "always" || tr.kind === "onDone") continue;

      const guardName = tr.transition.guard;
      const guardAllowed = !guardName || (this.guardOverrides[guardName] ?? true);

      availableTransitions.push({
        transition: tr,
        enabled: guardAllowed && snap.status === "active",
        ...(guardName && !guardAllowed ? { blockedByGuard: guardName } : {}),
        ...(tr.kind === "after"
          ? {
              isDelay: true,
              delayMs: /^\d+$/.test(tr.eventKey ?? "") ? Number(tr.eventKey) : undefined,
            }
          : {}),
        ...(tr.kind === "invokeDone" || tr.kind === "invokeError"
          ? { isInvoke: true, invokeId: tr.invokeId }
          : {}),
      });
    }

    const activeInvokes: ActiveInvokeInfo[] = [];
    for (const path of activePaths) {
      const node = getStateAtPath(this.doc, path);
      for (const inv of node?.invoke ?? []) {
        activeInvokes.push({ statePath: path, invoke: inv });
      }
    }

    return {
      running: true,
      status: snap.status,
      activeStatePaths: activePaths,
      stateValue: snap.value,
      context:
        snap.context && typeof snap.context === "object"
          ? (snap.context as Record<string, unknown>)
          : {},
      availableTransitions,
      activeInvokes,
      guardOverrides: { ...this.guardOverrides },
      knownGuards: guards,
      log: [...this.log],
      canStepBack: !this.externalActor && this.history.length > 0,
      externalActorAttached: this.externalActor !== null,
      ...(this.errorMessage ? { error: this.errorMessage } : {}),
    };
  }
}
