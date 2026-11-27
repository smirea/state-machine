import {
  createMachine,
  fromCallback,
  setup,
  type AnyMachineSnapshot,
  type AnyStateMachine,
} from "xstate";
import {
  createId,
  type AccentColor,
  type ActionRef,
  type FlattenedTransition,
  type InvokeDocument,
  type MachineDocument,
  type StateNodeDocument,
  type StateNodeType,
  type TransitionDocument,
} from "./types.ts";

export interface StatePathEntry {
  path: string;
  key: string;
  parentPath: string | null;
  node: StateNodeDocument;
  resolvedType: StateNodeType;
  isInitial: boolean;
  depth: number;
}

export function resolveStateNodeType(node: StateNodeDocument): StateNodeType {
  if (node.type) return node.type;
  if (node.states && Object.keys(node.states).length > 0) return "compound";
  return "atomic";
}

export function getParentPath(path: string): string | null {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? null : path.slice(0, idx);
}

export function getStateKey(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? path : path.slice(idx + 1);
}

export function getStateAtPath(doc: MachineDocument, path: string): StateNodeDocument | undefined {
  if (!path) return undefined;
  const parts = path.split(".");
  let currentMap: Record<string, StateNodeDocument> | undefined = doc.states;
  let current: StateNodeDocument | undefined;
  for (const part of parts) {
    current = currentMap?.[part];
    if (!current) return undefined;
    currentMap = current.states;
  }
  return current;
}

export function listAllStates(doc: MachineDocument): StatePathEntry[] {
  const result: StatePathEntry[] = [];

  function walk(
    states: Record<string, StateNodeDocument> | undefined,
    parentPath: string | null,
    parentInitial: string | undefined,
    parentIsParallel: boolean,
    depth: number,
  ): void {
    if (!states) return;
    const keys = Object.keys(states);
    const effectiveInitial = parentIsParallel ? undefined : (parentInitial ?? keys[0]);
    for (const key of keys) {
      const node = states[key];
      const path = parentPath ? `${parentPath}.${key}` : key;
      const resolvedType = resolveStateNodeType(node);
      result.push({
        path,
        key,
        parentPath,
        node,
        resolvedType,
        isInitial: !parentIsParallel && effectiveInitial === key,
        depth,
      });
      if (node.states) {
        walk(node.states, path, node.initial, resolvedType === "parallel", depth + 1);
      }
    }
  }

  walk(doc.states, null, doc.initial, doc.type === "parallel", 0);
  return result;
}

export function resolveTargetPath(
  doc: MachineDocument,
  sourcePath: string,
  rawTarget: string | undefined,
): string | null {
  if (!rawTarget) return null;
  const trimmed = rawTarget.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("#")) {
    const withoutHash = trimmed.slice(1);
    const machinePrefix = `${doc.id}.`;
    const candidate = withoutHash.startsWith(machinePrefix)
      ? withoutHash.slice(machinePrefix.length)
      : withoutHash;
    if (getStateAtPath(doc, candidate)) return candidate;
    // Also support matching a state node whose meta/id matches `#nodeId`
    const all = listAllStates(doc);
    const byKey = all.find((s) => s.path === candidate || s.key === candidate);
    return byKey?.path ?? null;
  }

  if (trimmed.startsWith(".")) {
    const childCandidate = `${sourcePath}${trimmed}`;
    return getStateAtPath(doc, childCandidate) ? childCandidate : null;
  }

  const parentPath = getParentPath(sourcePath);
  if (parentPath) {
    const siblingCandidate = `${parentPath}.${trimmed}`;
    if (getStateAtPath(doc, siblingCandidate)) return siblingCandidate;
  }

  if (getStateAtPath(doc, trimmed)) return trimmed;

  // Walk ancestor scopes upward
  let cursor = parentPath;
  while (cursor) {
    const upParent = getParentPath(cursor);
    const candidate = upParent ? `${upParent}.${trimmed}` : trimmed;
    if (getStateAtPath(doc, candidate)) return candidate;
    cursor = upParent;
  }

  return null;
}

export function formatTransitionLabel(
  kind: FlattenedTransition["kind"],
  eventKey: string | undefined,
  invokeId: string | undefined,
  transition: TransitionDocument,
): string {
  let base: string;
  switch (kind) {
    case "always":
      base = "always";
      break;
    case "after":
      base = `after ${eventKey ?? ""}${/^\d+$/.test(eventKey ?? "") ? "ms" : ""}`;
      break;
    case "onDone":
      base = "onDone";
      break;
    case "invokeDone":
      base = `${invokeId ?? "invoke"}.done`;
      break;
    case "invokeError":
      base = `${invokeId ?? "invoke"}.error`;
      break;
    case "on":
    default:
      base = eventKey || "EVENT";
      break;
  }

  if (transition.guard) {
    return `${base} [${transition.guard}]`;
  }
  return base;
}

export function listAllTransitions(doc: MachineDocument): FlattenedTransition[] {
  const transitions: FlattenedTransition[] = [];
  const states = listAllStates(doc);

  for (const entry of states) {
    const { path, node } = entry;

    if (node.on) {
      for (const [eventKey, list] of Object.entries(node.on)) {
        for (const tr of list) {
          transitions.push({
            id: tr.id,
            sourcePath: path,
            targetPath: resolveTargetPath(doc, path, tr.target),
            rawTarget: tr.target,
            kind: "on",
            eventKey,
            label: formatTransitionLabel("on", eventKey, undefined, tr),
            transition: tr,
          });
        }
      }
    }

    if (node.always) {
      for (const tr of node.always) {
        transitions.push({
          id: tr.id,
          sourcePath: path,
          targetPath: resolveTargetPath(doc, path, tr.target),
          rawTarget: tr.target,
          kind: "always",
          label: formatTransitionLabel("always", undefined, undefined, tr),
          transition: tr,
        });
      }
    }

    if (node.after) {
      for (const [delayKey, list] of Object.entries(node.after)) {
        for (const tr of list) {
          transitions.push({
            id: tr.id,
            sourcePath: path,
            targetPath: resolveTargetPath(doc, path, tr.target),
            rawTarget: tr.target,
            kind: "after",
            eventKey: delayKey,
            label: formatTransitionLabel("after", delayKey, undefined, tr),
            transition: tr,
          });
        }
      }
    }

    if (node.onDone) {
      for (const tr of node.onDone) {
        transitions.push({
          id: tr.id,
          sourcePath: path,
          targetPath: resolveTargetPath(doc, path, tr.target),
          rawTarget: tr.target,
          kind: "onDone",
          label: formatTransitionLabel("onDone", undefined, undefined, tr),
          transition: tr,
        });
      }
    }

    if (node.invoke) {
      for (const inv of node.invoke) {
        for (const tr of inv.onDone ?? []) {
          transitions.push({
            id: tr.id,
            sourcePath: path,
            targetPath: resolveTargetPath(doc, path, tr.target),
            rawTarget: tr.target,
            kind: "invokeDone",
            invokeId: inv.id,
            label: formatTransitionLabel("invokeDone", undefined, inv.id, tr),
            transition: tr,
          });
        }
        for (const tr of inv.onError ?? []) {
          transitions.push({
            id: tr.id,
            sourcePath: path,
            targetPath: resolveTargetPath(doc, path, tr.target),
            rawTarget: tr.target,
            kind: "invokeError",
            invokeId: inv.id,
            label: formatTransitionLabel("invokeError", undefined, inv.id, tr),
            transition: tr,
          });
        }
      }
    }
  }

  return transitions;
}

export function collectMachineSymbols(doc: MachineDocument): {
  guards: string[];
  actions: string[];
  delays: string[];
  actors: string[];
} {
  const guards = new Set<string>();
  const actions = new Set<string>();
  const delays = new Set<string>();
  const actors = new Set<string>();

  for (const { node } of listAllStates(doc)) {
    for (const a of node.entry ?? []) actions.add(a.type);
    for (const a of node.exit ?? []) actions.add(a.type);
    for (const inv of node.invoke ?? []) {
      actors.add(inv.src);
    }
    if (node.after) {
      for (const delayKey of Object.keys(node.after)) {
        if (!/^\d+$/.test(delayKey)) delays.add(delayKey);
      }
    }
  }

  for (const item of listAllTransitions(doc)) {
    if (item.transition.guard) guards.add(item.transition.guard);
    for (const a of item.transition.actions ?? []) actions.add(a.type);
  }

  return {
    guards: [...guards].sort(),
    actions: [...actions].sort(),
    delays: [...delays].sort(),
    actors: [...actors].sort(),
  };
}

function normalizeActions(raw: unknown): ActionRef[] | undefined {
  if (!raw) return undefined;
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: ActionRef[] = [];
  for (const item of arr) {
    if (typeof item === "string" && item.trim()) {
      out.push({ type: item.trim() });
    } else if (typeof item === "function") {
      out.push({ type: item.name || "inlineAction" });
    } else if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const type = typeof rec.type === "string" ? rec.type : "action";
      const params =
        rec.params && typeof rec.params === "object"
          ? (rec.params as Record<string, unknown>)
          : undefined;
      out.push(params ? { type, params } : { type });
    }
  }
  return out.length > 0 ? out : undefined;
}

function normalizeGuard(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return raw;
  if (typeof raw === "function") return raw.name || "inlineGuard";
  if (typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    if (typeof rec.type === "string") return rec.type;
  }
  return undefined;
}

function normalizeTransitions(raw: unknown, idPrefix: string): TransitionDocument[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: TransitionDocument[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (typeof item === "string") {
      out.push({
        id: createId(`${idPrefix}_${i}`),
        target: item,
      });
    } else if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      let target: string | undefined;
      if (typeof rec.target === "string") {
        target = rec.target;
      } else if (Array.isArray(rec.target) && typeof rec.target[0] === "string") {
        target = rec.target[0];
      }
      const guard = normalizeGuard(rec.guard ?? rec.cond);
      const actions = normalizeActions(rec.actions);
      const meta = rec.meta as Record<string, unknown> | undefined;
      const color = (rec.color ?? meta?.smvColor) as AccentColor | undefined;
      out.push({
        id: typeof rec.id === "string" ? rec.id : createId(`${idPrefix}_${i}`),
        ...(target !== undefined ? { target } : {}),
        ...(guard ? { guard } : {}),
        ...(actions ? { actions } : {}),
        ...(typeof rec.description === "string" ? { description: rec.description } : {}),
        ...(rec.reenter === true ? { reenter: true } : {}),
        ...(color ? { color } : {}),
      });
    }
  }
  return out;
}

function normalizeInvoke(raw: unknown): InvokeDocument[] | undefined {
  if (!raw) return undefined;
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: InvokeDocument[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const src =
      typeof rec.src === "string"
        ? rec.src
        : typeof rec.src === "function"
          ? rec.src.name || `actor_${i + 1}`
          : `actor_${i + 1}`;
    const id = typeof rec.id === "string" ? rec.id : src;
    const onDone = normalizeTransitions(rec.onDone, `inv_done_${id}`);
    const onError = normalizeTransitions(rec.onError, `inv_err_${id}`);
    out.push({
      id,
      src,
      ...(typeof rec.description === "string" ? { description: rec.description } : {}),
      ...(onDone.length > 0 ? { onDone } : {}),
      ...(onError.length > 0 ? { onError } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

function normalizeStateNode(raw: Record<string, unknown>): StateNodeDocument {
  const rawStates =
    raw.states && typeof raw.states === "object"
      ? (raw.states as Record<string, Record<string, unknown>>)
      : undefined;
  let states: Record<string, StateNodeDocument> | undefined;
  if (rawStates) {
    states = {};
    for (const [k, v] of Object.entries(rawStates)) {
      states[k] = normalizeStateNode(v ?? {});
    }
  }

  let on: Record<string, TransitionDocument[]> | undefined;
  if (raw.on && typeof raw.on === "object") {
    on = {};
    for (const [eventKey, value] of Object.entries(raw.on as Record<string, unknown>)) {
      const normalized = normalizeTransitions(value, `on_${eventKey}`);
      if (normalized.length > 0) on[eventKey] = normalized;
    }
    if (Object.keys(on).length === 0) on = undefined;
  }

  let after: Record<string, TransitionDocument[]> | undefined;
  if (raw.after && typeof raw.after === "object") {
    after = {};
    for (const [delayKey, value] of Object.entries(raw.after as Record<string, unknown>)) {
      const normalized = normalizeTransitions(value, `after_${delayKey}`);
      if (normalized.length > 0) after[delayKey] = normalized;
    }
    if (Object.keys(after).length === 0) after = undefined;
  }

  const always = normalizeTransitions(raw.always, "always");
  const onDone = normalizeTransitions(raw.onDone, "onDone");
  const invoke = normalizeInvoke(raw.invoke);
  const entry = normalizeActions(raw.entry);
  const exit = normalizeActions(raw.exit);
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === "string")
    : typeof raw.tags === "string"
      ? [raw.tags]
      : undefined;
  const meta =
    raw.meta && typeof raw.meta === "object" ? (raw.meta as Record<string, unknown>) : undefined;
  const color = (raw.color ?? meta?.smvColor) as AccentColor | undefined;

  let type: StateNodeType | undefined;
  if (
    raw.type === "atomic" ||
    raw.type === "compound" ||
    raw.type === "parallel" ||
    raw.type === "final" ||
    raw.type === "history"
  ) {
    type = raw.type;
  } else if (states && Object.keys(states).length > 0) {
    type = "compound";
  } else {
    type = "atomic";
  }

  return {
    type,
    ...(raw.history === "shallow" || raw.history === "deep" ? { history: raw.history } : {}),
    ...(typeof raw.initial === "string" ? { initial: raw.initial } : {}),
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(color ? { color } : {}),
    ...(entry ? { entry } : {}),
    ...(exit ? { exit } : {}),
    ...(invoke ? { invoke } : {}),
    ...(on ? { on } : {}),
    ...(always.length > 0 ? { always } : {}),
    ...(after ? { after } : {}),
    ...(onDone.length > 0 ? { onDone } : {}),
    ...(states ? { states } : {}),
    ...(meta ? { meta } : {}),
    ...(raw.output !== undefined ? { output: raw.output } : {}),
  };
}

export function fromXStateConfig(rawConfig: Record<string, unknown>, nameOverride?: string): MachineDocument {
  const id = typeof rawConfig.id === "string" && rawConfig.id.trim() ? rawConfig.id.trim() : "machine";
  const name = nameOverride ?? (typeof rawConfig.name === "string" ? rawConfig.name : id);
  const rawStates =
    rawConfig.states && typeof rawConfig.states === "object"
      ? (rawConfig.states as Record<string, Record<string, unknown>>)
      : {};
  const states: Record<string, StateNodeDocument> = {};
  for (const [k, v] of Object.entries(rawStates)) {
    states[k] = normalizeStateNode(v ?? {});
  }

  let context: Record<string, unknown> = {};
  if (rawConfig.context && typeof rawConfig.context === "object" && !Array.isArray(rawConfig.context)) {
    try {
      context = structuredClone(rawConfig.context as Record<string, unknown>);
    } catch {
      context = { ...(rawConfig.context as Record<string, unknown>) };
    }
  }

  const rootType = rawConfig.type === "parallel" ? "parallel" : "compound";
  const stateKeys = Object.keys(states);
  const initial =
    rootType === "parallel"
      ? undefined
      : typeof rawConfig.initial === "string"
        ? rawConfig.initial
        : stateKeys[0];

  return {
    version: 1,
    id,
    name,
    ...(typeof rawConfig.description === "string" ? { description: rawConfig.description } : {}),
    type: rootType,
    ...(initial ? { initial } : {}),
    context,
    states,
    notes: [],
  };
}

export function fromXStateMachine(machine: AnyStateMachine, nameOverride?: string): MachineDocument {
  const config = machine.config as Record<string, unknown>;
  return fromXStateConfig(config, nameOverride);
}

function serializeActionRefs(actions: ActionRef[] | undefined): unknown {
  if (!actions || actions.length === 0) return undefined;
  const mapped = actions.map((a) => (a.params ? { type: a.type, params: a.params } : a.type));
  return mapped.length === 1 ? mapped[0] : mapped;
}

function serializeTransitions(
  transitions: TransitionDocument[] | undefined,
  includeVisualMeta: boolean,
): unknown {
  if (!transitions || transitions.length === 0) return undefined;
  const serialized = transitions.map((tr) => {
    const isSimpleTarget =
      tr.target &&
      !tr.guard &&
      (!tr.actions || tr.actions.length === 0) &&
      !tr.description &&
      !tr.reenter &&
      (!includeVisualMeta || !tr.color);
    if (isSimpleTarget) return tr.target;

    const obj: Record<string, unknown> = {};
    if (tr.target !== undefined) obj.target = tr.target;
    if (tr.guard) obj.guard = tr.guard;
    const actions = serializeActionRefs(tr.actions);
    if (actions !== undefined) obj.actions = actions;
    if (tr.description) obj.description = tr.description;
    if (tr.reenter) obj.reenter = true;
    if (includeVisualMeta && tr.color && tr.color !== "default") {
      obj.meta = { smvColor: tr.color };
    }
    return obj;
  });
  return serialized.length === 1 ? serialized[0] : serialized;
}

function serializeStateNode(node: StateNodeDocument, includeVisualMeta: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const resolvedType = resolveStateNodeType(node);

  if (resolvedType === "parallel" || resolvedType === "final" || resolvedType === "history") {
    out.type = resolvedType;
  }
  if (resolvedType === "history" && node.history) {
    out.history = node.history;
  }
  if (resolvedType === "compound" && node.initial) {
    out.initial = node.initial;
  }
  if (node.description) out.description = node.description;
  if (node.tags && node.tags.length > 0) {
    out.tags = node.tags.length === 1 ? node.tags[0] : node.tags;
  }

  const entry = serializeActionRefs(node.entry);
  if (entry !== undefined) out.entry = entry;
  const exit = serializeActionRefs(node.exit);
  if (exit !== undefined) out.exit = exit;

  if (node.invoke && node.invoke.length > 0) {
    const serializedInvokes = node.invoke.map((inv) => {
      const invObj: Record<string, unknown> = { id: inv.id, src: inv.src };
      if (inv.description) invObj.description = inv.description;
      const done = serializeTransitions(inv.onDone, includeVisualMeta);
      if (done !== undefined) invObj.onDone = done;
      const err = serializeTransitions(inv.onError, includeVisualMeta);
      if (err !== undefined) invObj.onError = err;
      return invObj;
    });
    out.invoke = serializedInvokes.length === 1 ? serializedInvokes[0] : serializedInvokes;
  }

  if (node.on && Object.keys(node.on).length > 0) {
    const onObj: Record<string, unknown> = {};
    for (const [eventKey, trs] of Object.entries(node.on)) {
      const s = serializeTransitions(trs, includeVisualMeta);
      if (s !== undefined) onObj[eventKey] = s;
    }
    if (Object.keys(onObj).length > 0) out.on = onObj;
  }

  const always = serializeTransitions(node.always, includeVisualMeta);
  if (always !== undefined) out.always = always;

  if (node.after && Object.keys(node.after).length > 0) {
    const afterObj: Record<string, unknown> = {};
    for (const [delayKey, trs] of Object.entries(node.after)) {
      const s = serializeTransitions(trs, includeVisualMeta);
      if (s !== undefined) afterObj[delayKey] = s;
    }
    if (Object.keys(afterObj).length > 0) out.after = afterObj;
  }

  const onDone = serializeTransitions(node.onDone, includeVisualMeta);
  if (onDone !== undefined) out.onDone = onDone;

  if (node.states && Object.keys(node.states).length > 0) {
    const nested: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of Object.entries(node.states)) {
      nested[k] = serializeStateNode(v, includeVisualMeta);
    }
    out.states = nested;
  }

  if (node.output !== undefined) out.output = node.output;

  const meta = { ...node.meta };
  if (includeVisualMeta && node.color && node.color !== "default") {
    meta.smvColor = node.color;
  }
  if (Object.keys(meta).length > 0) out.meta = meta;

  return out;
}

export function toXStateConfig(
  doc: MachineDocument,
  options?: { includeVisualMeta?: boolean },
): Record<string, unknown> {
  const includeVisualMeta = options?.includeVisualMeta ?? false;
  const states: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(doc.states)) {
    states[k] = serializeStateNode(v, includeVisualMeta);
  }

  const out: Record<string, unknown> = {
    id: doc.id,
  };
  if (doc.description) out.description = doc.description;
  if (doc.type === "parallel") {
    out.type = "parallel";
  } else if (doc.initial) {
    out.initial = doc.initial;
  }
  if (doc.context && Object.keys(doc.context).length > 0) {
    out.context = doc.context;
  }
  out.states = states;
  return out;
}

export interface CompileRuntimeOptions {
  guardOverrides?: Record<string, boolean>;
  onActionFired?: (actionName: string, params?: Record<string, unknown>) => void;
  customGuards?: Record<string, (args: { context: Record<string, unknown>; event: Record<string, unknown> }) => boolean>;
  customActions?: Record<string, (args: { context: Record<string, unknown>; event: Record<string, unknown> }) => void>;
  customDelays?: Record<string, number>;
}

/**
 * Compiles a MachineDocument into a real executable XState v5 state machine.
 * Simulated invokes stay alive as callback actors until resolved/rejected externally
 * or via `xstate.done.actor.<id>` / `xstate.error.actor.<id>` events in Simulate mode.
 */
export function compileRuntimeMachine(
  doc: MachineDocument,
  options: CompileRuntimeOptions = {},
): AnyStateMachine {
  const symbols = collectMachineSymbols(doc);
  const guards: Record<string, (args: { context: Record<string, unknown>; event: Record<string, unknown> }) => boolean> = {};
  for (const guardName of symbols.guards) {
    guards[guardName] = (args) => {
      if (options.guardOverrides && guardName in options.guardOverrides) {
        return options.guardOverrides[guardName];
      }
      if (options.customGuards && guardName in options.customGuards) {
        return options.customGuards[guardName](args);
      }
      return true;
    };
  }

  const actions: Record<string, (args: { context: Record<string, unknown>; event: Record<string, unknown> }, params?: unknown) => void> = {};
  for (const actionName of symbols.actions) {
    actions[actionName] = (args, params) => {
      options.onActionFired?.(
        actionName,
        params && typeof params === "object" ? (params as Record<string, unknown>) : undefined,
      );
      options.customActions?.[actionName]?.(args);
    };
  }

  const delays: Record<string, number> = {};
  for (const delayName of symbols.delays) {
    delays[delayName] = options.customDelays?.[delayName] ?? 2000;
  }

  const actors: Record<string, ReturnType<typeof fromCallback>> = {};
  for (const actorName of symbols.actors) {
    actors[actorName] = fromCallback(() => {
      return () => {};
    });
  }

  const config = toXStateConfig(doc, { includeVisualMeta: false });

  // Use setup().createMachine when implementations exist; otherwise createMachine directly.
  if (
    Object.keys(guards).length > 0 ||
    Object.keys(actions).length > 0 ||
    Object.keys(delays).length > 0 ||
    Object.keys(actors).length > 0
  ) {
    const machineSetup = setup({
      guards: guards as never,
      actions: actions as never,
      delays: delays as never,
      actors: actors as never,
    });
    return machineSetup.createMachine(config as never) as unknown as AnyStateMachine;
  }

  return createMachine(config as never);
}

/**
 * Extracts active dot-delimited state paths (including all ancestors and parallel leaves)
 * from a live XState v5 snapshot.
 */
export function extractActiveStatePaths(snapshot: AnyMachineSnapshot): string[] {
  const paths = new Set<string>();

  function collectValue(value: unknown, prefix: string): void {
    if (typeof value === "string") {
      const full = prefix ? `${prefix}.${value}` : value;
      addWithAncestors(full);
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const nextPrefix = prefix ? `${prefix}.${k}` : k;
        addWithAncestors(nextPrefix);
        collectValue(v, nextPrefix);
      }
    }
  }

  function addWithAncestors(path: string): void {
    const parts = path.split(".");
    for (let i = 1; i <= parts.length; i++) {
      paths.add(parts.slice(0, i).join("."));
    }
  }

  collectValue(snapshot.value, "");
  return [...paths];
}
