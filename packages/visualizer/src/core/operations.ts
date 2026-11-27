import {
  createId,
  type AccentColor,
  type CanvasNote,
  type MachineDocument,
  type StateNodeDocument,
  type StateNodeType,
  type TransitionDocument,
  type TransitionKind,
} from "./types.ts";
import { getParentPath, getStateAtPath, getStateKey, resolveTargetPath } from "./xstate-adapter.ts";

function cloneDoc(doc: MachineDocument): MachineDocument {
  return structuredClone(doc);
}

function uniqueKey(existing: Record<string, unknown>, base: string): string {
  const sanitized = base.trim() || "state";
  if (!(sanitized in existing)) return sanitized;
  let i = 2;
  while (`${sanitized}${i}` in existing) i++;
  return `${sanitized}${i}`;
}

export function createEmptyMachine(name = "Untitled Machine"): MachineDocument {
  const id =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "machine";

  return {
    version: 1,
    id,
    name,
    type: "compound",
    initial: "idle",
    context: {},
    states: {
      idle: {
        type: "atomic",
        on: {
          START: [{ id: createId("tr"), target: "active" }],
        },
      },
      active: {
        type: "atomic",
        on: {
          STOP: [{ id: createId("tr"), target: "idle" }],
        },
      },
    },
    notes: [],
  };
}

export function addState(
  doc: MachineDocument,
  options?: {
    parentPath?: string | null;
    name?: string;
    type?: StateNodeType;
    position?: { x: number; y: number };
  },
): { document: MachineDocument; statePath: string } {
  const next = cloneDoc(doc);
  const parentPath = options?.parentPath ?? null;
  const desiredName = options?.name ?? "newState";
  const nodeType = options?.type ?? "atomic";

  const newNode: StateNodeDocument = {
    type: nodeType,
    ...(nodeType === "history" ? { history: "shallow" } : {}),
  };

  let statePath: string;
  if (!parentPath) {
    const key = uniqueKey(next.states, desiredName);
    next.states[key] = newNode;
    if (next.type !== "parallel" && !next.initial) {
      next.initial = key;
    }
    statePath = key;
  } else {
    const parent = getStateAtPath(next, parentPath);
    if (!parent) {
      throw new Error(`Parent state "${parentPath}" not found.`);
    }
    if (!parent.states) parent.states = {};
    const key = uniqueKey(parent.states, desiredName);
    parent.states[key] = newNode;
    if (parent.type === "atomic" || !parent.type) {
      parent.type = "compound";
    }
    if (parent.type !== "parallel" && !parent.initial) {
      parent.initial = key;
    }
    statePath = `${parentPath}.${key}`;
  }

  if (options?.position) {
    next.layout = { ...next.layout, [statePath]: options.position };
  }

  return { document: next, statePath };
}

function rewriteTransitionTargets(
  doc: MachineDocument,
  oldPath: string,
  newPath: string | null,
): void {
  const oldPrefix = `${oldPath}.`;
  const oldHashExact = `#${doc.id}.${oldPath}`;
  const oldHashPrefix = `#${doc.id}.${oldPath}.`;

  function remapTarget(sourcePath: string, target: string | undefined): string | undefined {
    if (!target) return target;
    const resolved = resolveTargetPath(doc, sourcePath, target);
    if (!resolved) return target;

    if (resolved === oldPath) {
      if (newPath === null) return undefined;
      if (target.startsWith("#")) return `#${doc.id}.${newPath}`;
      const sourceParent = getParentPath(sourcePath);
      const newParent = getParentPath(newPath);
      if (sourceParent === newParent) return getStateKey(newPath);
      return `#${doc.id}.${newPath}`;
    }

    if (resolved.startsWith(oldPrefix)) {
      if (newPath === null) return undefined;
      const suffix = resolved.slice(oldPrefix.length);
      const updatedFull = `${newPath}.${suffix}`;
      if (target.startsWith("#")) return `#${doc.id}.${updatedFull}`;
      if (target === oldHashExact || target.startsWith(oldHashPrefix)) {
        return `#${doc.id}.${updatedFull}`;
      }
      return `#${doc.id}.${updatedFull}`;
    }

    return target;
  }

  function updateList(sourcePath: string, list: TransitionDocument[] | undefined): void {
    if (!list) return;
    for (const tr of list) {
      if (tr.target !== undefined) {
        const updated = remapTarget(sourcePath, tr.target);
        if (updated === undefined) {
          delete tr.target;
        } else {
          tr.target = updated;
        }
      }
    }
  }

  function walk(states: Record<string, StateNodeDocument> | undefined, prefix: string): void {
    if (!states) return;
    for (const [k, node] of Object.entries(states)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (node.on) {
        for (const list of Object.values(node.on)) updateList(path, list);
      }
      updateList(path, node.always);
      if (node.after) {
        for (const list of Object.values(node.after)) updateList(path, list);
      }
      updateList(path, node.onDone);
      if (node.invoke) {
        for (const inv of node.invoke) {
          updateList(path, inv.onDone);
          updateList(path, inv.onError);
        }
      }
      walk(node.states, path);
    }
  }

  walk(doc.states, "");
}

export function renameState(
  doc: MachineDocument,
  statePath: string,
  newKeyRaw: string,
): { document: MachineDocument; newPath: string } {
  const newKey = newKeyRaw.trim();
  if (!newKey || newKey.includes(".") || newKey.includes("#")) {
    throw new Error(`Invalid state name "${newKeyRaw}". State names cannot be empty or contain "." or "#".`);
  }

  const oldKey = getStateKey(statePath);
  if (oldKey === newKey) return { document: doc, newPath: statePath };

  const parentPath = getParentPath(statePath);
  const newPath = parentPath ? `${parentPath}.${newKey}` : newKey;
  const next = cloneDoc(doc);

  // Rewrite transitions BEFORE mutating state keys so resolveTargetPath finds the original targets
  rewriteTransitionTargets(next, statePath, newPath);

  const container = parentPath ? getStateAtPath(next, parentPath)?.states : next.states;
  if (!container || !(oldKey in container)) {
    throw new Error(`State "${statePath}" not found.`);
  }
  if (newKey in container) {
    throw new Error(`A sibling state named "${newKey}" already exists.`);
  }

  // Preserve key ordering while renaming
  const rebuilt: Record<string, StateNodeDocument> = {};
  for (const [k, v] of Object.entries(container)) {
    rebuilt[k === oldKey ? newKey : k] = v;
  }

  if (parentPath) {
    const parent = getStateAtPath(next, parentPath)!;
    parent.states = rebuilt;
    if (parent.initial === oldKey) parent.initial = newKey;
  } else {
    next.states = rebuilt;
    if (next.initial === oldKey) next.initial = newKey;
  }

  if (next.layout) {
    const nextLayout: Record<string, { x: number; y: number }> = {};
    const oldPrefix = `${statePath}.`;
    for (const [k, pos] of Object.entries(next.layout)) {
      if (k === statePath) nextLayout[newPath] = pos;
      else if (k.startsWith(oldPrefix)) nextLayout[`${newPath}.${k.slice(oldPrefix.length)}`] = pos;
      else nextLayout[k] = pos;
    }
    next.layout = nextLayout;
  }

  for (const note of next.notes) {
    if (note.anchorStatePath === statePath) note.anchorStatePath = newPath;
  }

  return { document: next, newPath };
}

export function deleteState(doc: MachineDocument, statePath: string): MachineDocument {
  const parentPath = getParentPath(statePath);
  const key = getStateKey(statePath);
  const next = cloneDoc(doc);

  rewriteTransitionTargets(next, statePath, null);

  if (parentPath) {
    const parent = getStateAtPath(next, parentPath);
    if (!parent?.states || !(key in parent.states)) return doc;
    delete parent.states[key];
    const remaining = Object.keys(parent.states);
    if (remaining.length === 0) {
      delete parent.states;
      delete parent.initial;
      if (parent.type === "compound" || parent.type === "parallel") {
        parent.type = "atomic";
      }
    } else if (parent.initial === key) {
      parent.initial = remaining[0];
    }
  } else {
    if (!(key in next.states)) return doc;
    delete next.states[key];
    const remaining = Object.keys(next.states);
    if (next.initial === key) {
      next.initial = remaining[0];
    }
  }

  if (next.layout) {
    const prefix = `${statePath}.`;
    for (const k of Object.keys(next.layout)) {
      if (k === statePath || k.startsWith(prefix)) delete next.layout[k];
    }
  }

  return next;
}

export function updateState(
  doc: MachineDocument,
  statePath: string,
  patch: Partial<StateNodeDocument>,
): MachineDocument {
  const next = cloneDoc(doc);
  const target = getStateAtPath(next, statePath);
  if (!target) return doc;
  Object.assign(target, patch);

  if (patch.type === "parallel") {
    delete target.initial;
  } else if (patch.type === "compound" && target.states && !target.initial) {
    target.initial = Object.keys(target.states)[0];
  } else if (patch.type === "final" || patch.type === "history") {
    delete target.states;
    delete target.initial;
  }

  return next;
}

export function setInitialState(doc: MachineDocument, statePath: string): MachineDocument {
  const parentPath = getParentPath(statePath);
  const key = getStateKey(statePath);
  const next = cloneDoc(doc);
  if (parentPath) {
    const parent = getStateAtPath(next, parentPath);
    if (!parent || parent.type === "parallel") return doc;
    parent.initial = key;
  } else {
    if (next.type === "parallel") return doc;
    next.initial = key;
  }
  return next;
}

function getTransitionBucket(
  node: StateNodeDocument,
  kind: TransitionKind,
  eventKey: string | undefined,
  invokeId: string | undefined,
  createIfMissing: boolean,
): TransitionDocument[] | undefined {
  switch (kind) {
    case "on": {
      const key = eventKey || "EVENT";
      if (!node.on) {
        if (!createIfMissing) return undefined;
        node.on = {};
      }
      if (!node.on[key]) {
        if (!createIfMissing) return undefined;
        node.on[key] = [];
      }
      return node.on[key];
    }
    case "always": {
      if (!node.always) {
        if (!createIfMissing) return undefined;
        node.always = [];
      }
      return node.always;
    }
    case "after": {
      const key = eventKey || "1000";
      if (!node.after) {
        if (!createIfMissing) return undefined;
        node.after = {};
      }
      if (!node.after[key]) {
        if (!createIfMissing) return undefined;
        node.after[key] = [];
      }
      return node.after[key];
    }
    case "onDone": {
      if (!node.onDone) {
        if (!createIfMissing) return undefined;
        node.onDone = [];
      }
      return node.onDone;
    }
    case "invokeDone":
    case "invokeError": {
      const inv = node.invoke?.find((item) => item.id === invokeId);
      if (!inv) return undefined;
      const field = kind === "invokeDone" ? "onDone" : "onError";
      if (!inv[field]) {
        if (!createIfMissing) return undefined;
        inv[field] = [];
      }
      return inv[field];
    }
  }
}

export function formatTargetForSource(
  doc: MachineDocument,
  sourcePath: string,
  targetPath: string,
): string {
  const sourceParent = getParentPath(sourcePath);
  const targetParent = getParentPath(targetPath);
  if (sourceParent === targetParent) {
    return getStateKey(targetPath);
  }
  return `#${doc.id}.${targetPath}`;
}

export function addTransition(
  doc: MachineDocument,
  params: {
    sourcePath: string;
    targetPath?: string;
    kind?: TransitionKind;
    eventKey?: string;
    invokeId?: string;
    guard?: string;
    description?: string;
    color?: AccentColor;
  },
): { document: MachineDocument; transitionId: string; eventKey?: string; kind: TransitionKind } {
  const next = cloneDoc(doc);
  const sourceNode = getStateAtPath(next, params.sourcePath);
  if (!sourceNode) {
    throw new Error(`Source state "${params.sourcePath}" not found.`);
  }

  const kind: TransitionKind = params.kind ?? "on";
  const eventKey =
    kind === "on"
      ? params.eventKey?.trim() || "EVENT"
      : kind === "after"
        ? params.eventKey?.trim() || "1000"
        : undefined;

  const bucket = getTransitionBucket(sourceNode, kind, eventKey, params.invokeId, true);
  if (!bucket) {
    throw new Error(`Could not create transition bucket for ${kind}.`);
  }

  const transitionId = createId("tr");
  const transition: TransitionDocument = {
    id: transitionId,
    ...(params.targetPath
      ? { target: formatTargetForSource(next, params.sourcePath, params.targetPath) }
      : {}),
    ...(params.guard ? { guard: params.guard } : {}),
    ...(params.description ? { description: params.description } : {}),
    ...(params.color ? { color: params.color } : {}),
  };

  bucket.push(transition);
  return { document: next, transitionId, eventKey, kind };
}

export function updateTransition(
  doc: MachineDocument,
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
): {
  document: MachineDocument;
  locator: {
    sourcePath: string;
    kind: TransitionKind;
    eventKey?: string;
    invokeId?: string;
    transitionId: string;
  };
} {
  const next = cloneDoc(doc);
  const node = getStateAtPath(next, locator.sourcePath);
  if (!node) return { document: doc, locator };

  const oldBucket = getTransitionBucket(node, locator.kind, locator.eventKey, locator.invokeId, false);
  if (!oldBucket) return { document: doc, locator };

  const idx = oldBucket.findIndex((t) => t.id === locator.transitionId);
  if (idx === -1) return { document: doc, locator };

  const current = oldBucket[idx];
  const updated: TransitionDocument = {
    ...current,
    ...(patch.target !== undefined ? { target: patch.target || undefined } : {}),
    ...(patch.guard !== undefined ? { guard: patch.guard || undefined } : {}),
    ...(patch.actions !== undefined ? { actions: patch.actions.length > 0 ? patch.actions : undefined } : {}),
    ...(patch.description !== undefined ? { description: patch.description || undefined } : {}),
    ...(patch.reenter !== undefined ? { reenter: patch.reenter || undefined } : {}),
    ...(patch.color !== undefined ? { color: patch.color === "default" ? undefined : patch.color } : {}),
  };

  const targetKind = patch.nextKind ?? locator.kind;
  const targetEventKey =
    targetKind === "on" || targetKind === "after"
      ? (patch.nextEventKey ?? locator.eventKey ?? (targetKind === "after" ? "1000" : "EVENT"))
      : undefined;
  const targetInvokeId =
    targetKind === "invokeDone" || targetKind === "invokeError"
      ? (patch.nextInvokeId ?? locator.invokeId)
      : undefined;

  const moved =
    targetKind !== locator.kind ||
    targetEventKey !== locator.eventKey ||
    targetInvokeId !== locator.invokeId;

  if (!moved) {
    oldBucket[idx] = updated;
    return { document: next, locator };
  }

  oldBucket.splice(idx, 1);
  cleanupEmptyBucket(node, locator.kind, locator.eventKey);

  const newBucket = getTransitionBucket(node, targetKind, targetEventKey, targetInvokeId, true);
  if (!newBucket) return { document: doc, locator };
  newBucket.push(updated);

  return {
    document: next,
    locator: {
      sourcePath: locator.sourcePath,
      kind: targetKind,
      eventKey: targetEventKey,
      invokeId: targetInvokeId,
      transitionId: updated.id,
    },
  };
}

function cleanupEmptyBucket(
  node: StateNodeDocument,
  kind: TransitionKind,
  eventKey: string | undefined,
): void {
  if (kind === "on" && node.on && eventKey && node.on[eventKey]?.length === 0) {
    delete node.on[eventKey];
    if (Object.keys(node.on).length === 0) delete node.on;
  } else if (kind === "after" && node.after && eventKey && node.after[eventKey]?.length === 0) {
    delete node.after[eventKey];
    if (Object.keys(node.after).length === 0) delete node.after;
  } else if (kind === "always" && node.always?.length === 0) {
    delete node.always;
  } else if (kind === "onDone" && node.onDone?.length === 0) {
    delete node.onDone;
  }
}

export function deleteTransition(
  doc: MachineDocument,
  locator: {
    sourcePath: string;
    kind: TransitionKind;
    eventKey?: string;
    invokeId?: string;
    transitionId: string;
  },
): MachineDocument {
  const next = cloneDoc(doc);
  const node = getStateAtPath(next, locator.sourcePath);
  if (!node) return doc;

  const bucket = getTransitionBucket(node, locator.kind, locator.eventKey, locator.invokeId, false);
  if (!bucket) return doc;

  const idx = bucket.findIndex((t) => t.id === locator.transitionId);
  if (idx === -1) return doc;
  bucket.splice(idx, 1);
  cleanupEmptyBucket(node, locator.kind, locator.eventKey);
  return next;
}

export function updateMachineMeta(
  doc: MachineDocument,
  patch: Partial<Pick<MachineDocument, "id" | "name" | "description" | "type" | "initial" | "context">>,
): MachineDocument {
  const next = cloneDoc(doc);
  const oldId = next.id;
  Object.assign(next, patch);
  if (patch.type === "parallel") {
    delete next.initial;
  } else if (patch.type === "compound" && !next.initial) {
    next.initial = Object.keys(next.states)[0];
  }
  if (patch.id && patch.id !== oldId) {
    const oldPrefix = `#${oldId}.`;
    const newPrefix = `#${patch.id}.`;
    const rewriteHash = (list?: TransitionDocument[]) => {
      for (const tr of list ?? []) {
        if (tr.target?.startsWith(oldPrefix)) {
          tr.target = `${newPrefix}${tr.target.slice(oldPrefix.length)}`;
        }
      }
    };
    const walk = (states?: Record<string, StateNodeDocument>) => {
      if (!states) return;
      for (const node of Object.values(states)) {
        for (const list of Object.values(node.on ?? {})) rewriteHash(list);
        rewriteHash(node.always);
        for (const list of Object.values(node.after ?? {})) rewriteHash(list);
        rewriteHash(node.onDone);
        for (const inv of node.invoke ?? []) {
          rewriteHash(inv.onDone);
          rewriteHash(inv.onError);
        }
        walk(node.states);
      }
    };
    walk(next.states);
  }
  return next;
}

export function addNote(
  doc: MachineDocument,
  note?: Partial<Omit<CanvasNote, "id">>,
): { document: MachineDocument; noteId: string } {
  const next = cloneDoc(doc);
  const noteId = createId("note");
  next.notes.push({
    id: noteId,
    text: note?.text ?? "Add a Markdown note...",
    x: note?.x ?? 40,
    y: note?.y ?? 40,
    width: note?.width ?? 220,
    color: note?.color ?? "amber",
    ...(note?.anchorStatePath ? { anchorStatePath: note.anchorStatePath } : {}),
  });
  return { document: next, noteId };
}

export function updateNote(
  doc: MachineDocument,
  noteId: string,
  patch: Partial<Omit<CanvasNote, "id">>,
): MachineDocument {
  const next = cloneDoc(doc);
  const target = next.notes.find((n) => n.id === noteId);
  if (!target) return doc;
  Object.assign(target, patch);
  return next;
}

export function deleteNote(doc: MachineDocument, noteId: string): MachineDocument {
  const next = cloneDoc(doc);
  next.notes = next.notes.filter((n) => n.id !== noteId);
  return next;
}

export function setNodePosition(
  doc: MachineDocument,
  statePath: string,
  position: { x: number; y: number },
): MachineDocument {
  const next = cloneDoc(doc);
  next.layout = {
    ...next.layout,
    [statePath]: { x: Math.round(position.x), y: Math.round(position.y) },
  };
  return next;
}

export function clearLayoutOverrides(doc: MachineDocument): MachineDocument {
  const next = cloneDoc(doc);
  delete next.layout;
  return next;
}
