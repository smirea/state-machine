import {
  Check,
  Code2,
  Copy,
  Download,
  Lock,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Sliders,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { VisualizerController, VisualizerControllerSnapshot } from "../controller.ts";
import { exportMachine } from "../core/codegen.ts";
import {
  ACCENT_COLORS,
  type AccentColor,
  type EdgeRouting,
  type ExportFormat,
  type LayoutDirection,
  type RightPanelTab,
  type StateNodeType,
  type TransitionKind,
  type VisualizerTheme,
} from "../core/types.ts";
import {
  getStateAtPath,
  getStateKey,
  listAllStates,
  listAllTransitions,
  resolveStateNodeType,
} from "../core/xstate-adapter.ts";
import { saveMachineToFile } from "../storage/files.ts";

interface RightSidebarProps {
  controller: VisualizerController;
  snapshot: VisualizerControllerSnapshot;
}

const COLOR_KEYS = Object.keys(ACCENT_COLORS) as AccentColor[];

export function RightSidebar({ controller, snapshot }: RightSidebarProps) {
  const { config } = snapshot;
  const [tab, setTab] = useState<RightPanelTab>(config.defaultRightTab);

  // Sync tab automatically when switching into Simulate mode
  useEffect(() => {
    if (config.mode === "simulate") {
      setTab("simulate");
    } else if (tab === "simulate") {
      setTab("details");
    }
  }, [config.mode]);

  return (
    <aside className="smv-sidebar smv-sidebar-right" data-testid="smv-right-sidebar">
      <div className="smv-sidebar-tabs">
        <button
          type="button"
          className={`smv-sidebar-tab ${tab === "details" ? "active" : ""}`}
          onClick={() => setTab("details")}
        >
          <Sliders size={12} />
          <span>Details</span>
        </button>
        <button
          type="button"
          className={`smv-sidebar-tab ${tab === "simulate" ? "active" : ""}`}
          onClick={() => {
            setTab("simulate");
            if (config.mode !== "simulate") controller.setMode("simulate");
          }}
        >
          <Play size={12} />
          <span>Simulate</span>
        </button>
        <button
          type="button"
          className={`smv-sidebar-tab ${tab === "code" ? "active" : ""}`}
          onClick={() => setTab("code")}
        >
          <Code2 size={12} />
          <span>Code</span>
        </button>
        <button
          type="button"
          className={`smv-sidebar-tab ${tab === "settings" ? "active" : ""}`}
          onClick={() => setTab("settings")}
        >
          <Settings size={12} />
          <span>Config</span>
        </button>
      </div>

      <div className="smv-sidebar-content">
        {tab === "details" && <DetailsTab controller={controller} snapshot={snapshot} />}
        {tab === "simulate" && <SimulateTab controller={controller} snapshot={snapshot} />}
        {tab === "code" && <CodeTab controller={controller} snapshot={snapshot} />}
        {tab === "settings" && <SettingsTab controller={controller} snapshot={snapshot} />}
      </div>
    </aside>
  );
}

function ColorPicker({
  value,
  disabled,
  onChange,
}: {
  value?: AccentColor;
  disabled?: boolean;
  onChange: (color: AccentColor) => void;
}) {
  return (
    <div className="smv-swatches">
      {COLOR_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          className={`smv-swatch ${(value ?? "default") === key ? "selected" : ""}`}
          style={{
            background: key === "default" ? "var(--smv-surface-hover)" : ACCENT_COLORS[key].badge,
          }}
          title={ACCENT_COLORS[key].label}
          aria-label={`Color ${ACCENT_COLORS[key].label}`}
          onClick={() => onChange(key)}
        />
      ))}
    </div>
  );
}

function DetailsTab({ controller, snapshot }: RightSidebarProps) {
  const { machine, config, selection } = snapshot;
  const readOnly = config.readOnly;
  const allStates = useMemo(() => listAllStates(machine), [machine]);
  const allTransitions = useMemo(() => listAllTransitions(machine), [machine]);

  // Machine context JSON buffer
  const [contextText, setContextText] = useState(() => JSON.stringify(machine.context ?? {}, null, 2));
  const [contextErr, setContextErr] = useState<string | null>(null);
  useEffect(() => {
    setContextText(JSON.stringify(machine.context ?? {}, null, 2));
    setContextErr(null);
  }, [machine.id, machine.context]);

  // State rename buffer
  const selectedStatePath = selection.kind === "state" ? selection.path : null;
  const selectedStateNode = selectedStatePath ? getStateAtPath(machine, selectedStatePath) : undefined;
  const [stateNameDraft, setStateNameDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [entryDraft, setEntryDraft] = useState("");
  const [exitDraft, setExitDraft] = useState("");
  const [invokeSrcDraft, setInvokeSrcDraft] = useState("");
  const [trActionDraft, setTrActionDraft] = useState("");

  useEffect(() => {
    if (selectedStatePath) {
      setStateNameDraft(getStateKey(selectedStatePath));
    }
  }, [selectedStatePath]);

  // 1. Machine selection
  if (selection.kind === "machine") {
    const rootKeys = Object.keys(machine.states);
    return (
      <>
        <div className="smv-section-header">
          <span>Machine Properties</span>
        </div>

        <div className="smv-field">
          <label className="smv-label">Name</label>
          <input
            className="smv-input"
            disabled={readOnly}
            value={machine.name}
            onChange={(e) => controller.updateMachineMeta({ name: e.target.value })}
          />
        </div>

        <div className="smv-field">
          <label className="smv-label">Machine ID</label>
          <input
            className="smv-input"
            disabled={readOnly}
            value={machine.id}
            onChange={(e) => controller.updateMachineMeta({ id: e.target.value })}
          />
        </div>

        <div className="smv-row">
          <div className="smv-field" style={{ flex: 1 }}>
            <label className="smv-label">Root Type</label>
            <select
              className="smv-select"
              disabled={readOnly}
              value={machine.type ?? "compound"}
              onChange={(e) =>
                controller.updateMachineMeta({
                  type: e.target.value as "compound" | "parallel",
                })
              }
            >
              <option value="compound">Compound</option>
              <option value="parallel">Parallel</option>
            </select>
          </div>

          {machine.type !== "parallel" && (
            <div className="smv-field" style={{ flex: 1 }}>
              <label className="smv-label">Initial State</label>
              <select
                className="smv-select"
                disabled={readOnly}
                value={machine.initial ?? rootKeys[0] ?? ""}
                onChange={(e) => controller.updateMachineMeta({ initial: e.target.value })}
              >
                {rootKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="smv-field">
          <label className="smv-label">Description</label>
          <textarea
            className="smv-textarea"
            disabled={readOnly}
            placeholder="Describe this state machine..."
            value={machine.description ?? ""}
            onChange={(e) => controller.updateMachineMeta({ description: e.target.value })}
          />
        </div>

        <div className="smv-field">
          <div className="smv-row-between">
            <label className="smv-label">Initial Context (JSON)</label>
            {!readOnly && (
              <button
                type="button"
                className="smv-btn smv-btn-sm"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(contextText) as Record<string, unknown>;
                    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                      throw new Error("Context must be a JSON object.");
                    }
                    setContextErr(null);
                    controller.updateMachineMeta({ context: parsed });
                  } catch (err) {
                    setContextErr(err instanceof Error ? err.message : "Invalid JSON");
                  }
                }}
              >
                Apply
              </button>
            )}
          </div>
          <textarea
            className="smv-textarea smv-textarea-mono"
            disabled={readOnly}
            rows={5}
            value={contextText}
            onChange={(e) => setContextText(e.target.value)}
          />
          {contextErr && (
            <div style={{ color: "var(--smv-danger)", fontSize: 11 }}>{contextErr}</div>
          )}
        </div>

        {!readOnly && (
          <div className="smv-row">
            <button
              type="button"
              className="smv-btn smv-btn-primary"
              style={{ flex: 1 }}
              onClick={() => controller.addState({ name: "state" })}
            >
              <Plus size={13} />
              <span>Add State</span>
            </button>
            <button
              type="button"
              className="smv-btn"
              onClick={() => controller.addNote()}
            >
              <Plus size={13} />
              <span>Add Note</span>
            </button>
          </div>
        )}
      </>
    );
  }

  // 2. State selection
  if (selection.kind === "state" && selectedStatePath && selectedStateNode) {
    const resolvedType = resolveStateNodeType(selectedStateNode);
    const outgoing = allTransitions.filter((t) => t.sourcePath === selectedStatePath);
    const childKeys = Object.keys(selectedStateNode.states ?? {});

    return (
      <>
        <div className="smv-row-between">
          <div className="smv-section-header">State: {selectedStatePath}</div>
          {!readOnly && (
            <button
              type="button"
              className="smv-btn smv-btn-danger smv-btn-sm"
              onClick={() => controller.deleteState(selectedStatePath)}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>

        <div className="smv-field">
          <label className="smv-label">State Name</label>
          <div className="smv-row">
            <input
              className="smv-input"
              disabled={readOnly}
              value={stateNameDraft}
              onChange={(e) => setStateNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  controller.renameState(selectedStatePath, stateNameDraft);
                }
              }}
            />
            {!readOnly && stateNameDraft !== getStateKey(selectedStatePath) && (
              <button
                type="button"
                className="smv-btn smv-btn-primary smv-btn-sm"
                onClick={() => controller.renameState(selectedStatePath, stateNameDraft)}
              >
                Rename
              </button>
            )}
          </div>
        </div>

        <div className="smv-row">
          <div className="smv-field" style={{ flex: 1 }}>
            <label className="smv-label">State Type</label>
            <select
              className="smv-select"
              disabled={readOnly}
              value={resolvedType}
              onChange={(e) =>
                controller.updateState(selectedStatePath, {
                  type: e.target.value as StateNodeType,
                })
              }
            >
              <option value="atomic">Normal (atomic)</option>
              <option value="compound">Parent (compound)</option>
              <option value="parallel">Parallel</option>
              <option value="final">Final</option>
              <option value="history">History</option>
            </select>
          </div>

          {resolvedType === "history" && (
            <div className="smv-field" style={{ flex: 1 }}>
              <label className="smv-label">History</label>
              <select
                className="smv-select"
                disabled={readOnly}
                value={selectedStateNode.history ?? "shallow"}
                onChange={(e) =>
                  controller.updateState(selectedStatePath, {
                    history: e.target.value as "shallow" | "deep",
                  })
                }
              >
                <option value="shallow">Shallow</option>
                <option value="deep">Deep</option>
              </select>
            </div>
          )}
        </div>

        {!readOnly && (
          <div className="smv-row">
            <button
              type="button"
              className="smv-btn smv-btn-sm"
              style={{ flex: 1 }}
              onClick={() => controller.setInitialState(selectedStatePath)}
            >
              Set as Initial
            </button>
            {resolvedType !== "final" && resolvedType !== "history" && (
              <button
                type="button"
                className="smv-btn smv-btn-sm"
                style={{ flex: 1 }}
                onClick={() => controller.addState({ parentPath: selectedStatePath, name: "child" })}
              >
                <Plus size={12} />
                <span>Add Child</span>
              </button>
            )}
          </div>
        )}

        {resolvedType === "compound" && childKeys.length > 0 && (
          <div className="smv-field">
            <label className="smv-label">Initial Child State</label>
            <select
              className="smv-select"
              disabled={readOnly}
              value={selectedStateNode.initial ?? childKeys[0]}
              onChange={(e) =>
                controller.updateState(selectedStatePath, { initial: e.target.value })
              }
            >
              {childKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="smv-field">
          <label className="smv-label">Color</label>
          <ColorPicker
            value={selectedStateNode.color}
            disabled={readOnly}
            onChange={(color) =>
              controller.updateState(selectedStatePath, {
                color: color === "default" ? undefined : color,
              })
            }
          />
        </div>

        <div className="smv-field">
          <label className="smv-label">Description</label>
          <textarea
            className="smv-textarea"
            disabled={readOnly}
            rows={2}
            placeholder="Describe this state..."
            value={selectedStateNode.description ?? ""}
            onChange={(e) =>
              controller.updateState(selectedStatePath, {
                description: e.target.value || undefined,
              })
            }
          />
        </div>

        {/* Tags */}
        <div className="smv-field">
          <label className="smv-label">Tags</label>
          <div className="smv-chip-list">
            {(selectedStateNode.tags ?? []).map((tag) => (
              <span key={tag} className="smv-chip">
                #{tag}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() =>
                      controller.updateState(selectedStatePath, {
                        tags: (selectedStateNode.tags ?? []).filter((t) => t !== tag),
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          {!readOnly && (
            <div className="smv-row">
              <input
                className="smv-input"
                placeholder="Add tag..."
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tagDraft.trim()) {
                    const nextTags = [...new Set([...(selectedStateNode.tags ?? []), tagDraft.trim()])];
                    controller.updateState(selectedStatePath, { tags: nextTags });
                    setTagDraft("");
                  }
                }}
              />
              <button
                type="button"
                className="smv-btn smv-btn-sm"
                onClick={() => {
                  if (!tagDraft.trim()) return;
                  const nextTags = [...new Set([...(selectedStateNode.tags ?? []), tagDraft.trim()])];
                  controller.updateState(selectedStatePath, { tags: nextTags });
                  setTagDraft("");
                }}
              >
                <Plus size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Entry Actions */}
        <div className="smv-field">
          <label className="smv-label">Entry Actions</label>
          <div className="smv-chip-list">
            {(selectedStateNode.entry ?? []).map((act, idx) => (
              <span key={`${act.type}_${idx}`} className="smv-chip">
                → {act.type}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() =>
                      controller.updateState(selectedStatePath, {
                        entry: (selectedStateNode.entry ?? []).filter((_, i) => i !== idx),
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          {!readOnly && (
            <div className="smv-row">
              <input
                className="smv-input"
                placeholder="Add entry action..."
                value={entryDraft}
                onChange={(e) => setEntryDraft(e.target.value)}
              />
              <button
                type="button"
                className="smv-btn smv-btn-sm"
                onClick={() => {
                  if (!entryDraft.trim()) return;
                  controller.updateState(selectedStatePath, {
                    entry: [...(selectedStateNode.entry ?? []), { type: entryDraft.trim() }],
                  });
                  setEntryDraft("");
                }}
              >
                <Plus size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Exit Actions */}
        <div className="smv-field">
          <label className="smv-label">Exit Actions</label>
          <div className="smv-chip-list">
            {(selectedStateNode.exit ?? []).map((act, idx) => (
              <span key={`${act.type}_${idx}`} className="smv-chip">
                ← {act.type}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() =>
                      controller.updateState(selectedStatePath, {
                        exit: (selectedStateNode.exit ?? []).filter((_, i) => i !== idx),
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          {!readOnly && (
            <div className="smv-row">
              <input
                className="smv-input"
                placeholder="Add exit action..."
                value={exitDraft}
                onChange={(e) => setExitDraft(e.target.value)}
              />
              <button
                type="button"
                className="smv-btn smv-btn-sm"
                onClick={() => {
                  if (!exitDraft.trim()) return;
                  controller.updateState(selectedStatePath, {
                    exit: [...(selectedStateNode.exit ?? []), { type: exitDraft.trim() }],
                  });
                  setExitDraft("");
                }}
              >
                <Plus size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Invoked Actors */}
        <div className="smv-section">
          <div className="smv-section-header">
            <span>Invoked Actors ({selectedStateNode.invoke?.length ?? 0})</span>
          </div>
          {(selectedStateNode.invoke ?? []).map((inv) => (
            <div key={inv.id} className="smv-card">
              <div className="smv-row-between">
                <strong style={{ fontSize: 12 }}>{inv.src}</strong>
                {!readOnly && (
                  <button
                    type="button"
                    className="smv-btn smv-btn-icon smv-btn-sm"
                    onClick={() =>
                      controller.updateState(selectedStatePath, {
                        invoke: (selectedStateNode.invoke ?? []).filter((i) => i.id !== inv.id),
                      })
                    }
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
              <div className="smv-list-item-sub">id: {inv.id}</div>
              {!readOnly && (
                <div className="smv-row">
                  <button
                    type="button"
                    className="smv-btn smv-btn-sm"
                    style={{ flex: 1 }}
                    onClick={() =>
                      controller.addTransition({
                        sourcePath: selectedStatePath,
                        kind: "invokeDone",
                        invokeId: inv.id,
                        targetPath: allStates[0]?.path,
                      })
                    }
                  >
                    + onDone
                  </button>
                  <button
                    type="button"
                    className="smv-btn smv-btn-sm"
                    style={{ flex: 1 }}
                    onClick={() =>
                      controller.addTransition({
                        sourcePath: selectedStatePath,
                        kind: "invokeError",
                        invokeId: inv.id,
                        targetPath: allStates[0]?.path,
                      })
                    }
                  >
                    + onError
                  </button>
                </div>
              )}
            </div>
          ))}
          {!readOnly && (
            <div className="smv-row">
              <input
                className="smv-input"
                placeholder="Actor src name (e.g. fetchData)..."
                value={invokeSrcDraft}
                onChange={(e) => setInvokeSrcDraft(e.target.value)}
              />
              <button
                type="button"
                className="smv-btn smv-btn-sm"
                onClick={() => {
                  const src = invokeSrcDraft.trim();
                  if (!src) return;
                  controller.updateState(selectedStatePath, {
                    invoke: [...(selectedStateNode.invoke ?? []), { id: src, src }],
                  });
                  setInvokeSrcDraft("");
                }}
              >
                <Plus size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Outgoing Transitions */}
        <div className="smv-section">
          <div className="smv-section-header">
            <span>Transitions ({outgoing.length})</span>
            {!readOnly && (
              <button
                type="button"
                className="smv-btn smv-btn-sm"
                onClick={() =>
                  controller.addTransition({
                    sourcePath: selectedStatePath,
                    targetPath: allStates.find((s) => s.path !== selectedStatePath)?.path ?? selectedStatePath,
                    kind: "on",
                    eventKey: "NEXT",
                  })
                }
              >
                <Plus size={12} />
                <span>Add</span>
              </button>
            )}
          </div>
          {outgoing.map((tr) => (
            <div
              key={tr.id}
              className="smv-list-item"
              onClick={() =>
                controller.select({
                  kind: "transition",
                  sourcePath: tr.sourcePath,
                  transitionKind: tr.kind,
                  eventKey: tr.eventKey,
                  invokeId: tr.invokeId,
                  transitionId: tr.id,
                })
              }
            >
              <div className="smv-list-item-main">
                <div className="smv-list-item-title">{tr.label}</div>
                <div className="smv-list-item-sub">→ {tr.targetPath ?? "(targetless)"}</div>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  // 3. Transition selection
  if (selection.kind === "transition") {
    const found = allTransitions.find((t) => t.id === selection.transitionId);
    if (!found) {
      return <div className="smv-list-item-sub">Transition no longer exists.</div>;
    }

    const locator = {
      sourcePath: found.sourcePath,
      kind: found.kind,
      eventKey: found.eventKey,
      invokeId: found.invokeId,
      transitionId: found.id,
    };

    const sourceNode = getStateAtPath(machine, found.sourcePath);
    const availableInvokes = sourceNode?.invoke ?? [];

    return (
      <>
        <div className="smv-row-between">
          <div className="smv-section-header">Transition</div>
          {!readOnly && (
            <button
              type="button"
              className="smv-btn smv-btn-danger smv-btn-sm"
              onClick={() => controller.deleteTransition(locator)}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>

        <div className="smv-list-item-sub">From: {found.sourcePath}</div>

        <div className="smv-field">
          <label className="smv-label">Trigger Kind</label>
          <select
            className="smv-select"
            disabled={readOnly}
            value={found.kind}
            onChange={(e) => {
              const nextKind = e.target.value as TransitionKind;
              controller.updateTransition(locator, {
                nextKind,
                nextEventKey:
                  nextKind === "after" ? "1000" : nextKind === "on" ? "EVENT" : undefined,
                nextInvokeId:
                  nextKind === "invokeDone" || nextKind === "invokeError"
                    ? availableInvokes[0]?.id
                    : undefined,
              });
            }}
          >
            <option value="on">Event (on)</option>
            <option value="always">Eventless (always)</option>
            <option value="after">Delayed (after)</option>
            <option value="onDone">State Completion (onDone)</option>
            {availableInvokes.length > 0 && (
              <>
                <option value="invokeDone">Invoke onDone</option>
                <option value="invokeError">Invoke onError</option>
              </>
            )}
          </select>
        </div>

        {(found.kind === "on" || found.kind === "after") && (
          <div className="smv-field">
            <label className="smv-label">
              {found.kind === "after" ? "Delay (ms or named delay)" : "Event Name"}
            </label>
            <input
              className="smv-input"
              disabled={readOnly}
              value={found.eventKey ?? ""}
              onChange={(e) =>
                controller.updateTransition(locator, { nextEventKey: e.target.value })
              }
            />
          </div>
        )}

        <div className="smv-field">
          <label className="smv-label">Target State</label>
          <select
            className="smv-select"
            disabled={readOnly}
            value={found.targetPath ?? ""}
            onChange={(e) => {
              const targetPath = e.target.value;
              const formatted = targetPath
                ? targetPath.includes(".")
                  ? `#${machine.id}.${targetPath}`
                  : found.sourcePath.includes(".")
                    ? `#${machine.id}.${targetPath}`
                    : targetPath
                : "";
              controller.updateTransition(locator, { target: formatted });
            }}
          >
            <option value="">(None / Targetless)</option>
            {allStates.map((s) => (
              <option key={s.path} value={s.path}>
                {s.path}
              </option>
            ))}
          </select>
        </div>

        <div className="smv-field">
          <label className="smv-label">Guard Condition</label>
          <input
            className="smv-input"
            disabled={readOnly}
            placeholder="e.g. isValid"
            value={found.transition.guard ?? ""}
            onChange={(e) => controller.updateTransition(locator, { guard: e.target.value })}
          />
        </div>

        <div className="smv-field">
          <label className="smv-label">Transition Actions</label>
          <div className="smv-chip-list">
            {(found.transition.actions ?? []).map((act, idx) => (
              <span key={`${act.type}_${idx}`} className="smv-chip">
                {act.type}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() =>
                      controller.updateTransition(locator, {
                        actions: (found.transition.actions ?? []).filter((_, i) => i !== idx),
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          {!readOnly && (
            <div className="smv-row">
              <input
                className="smv-input"
                placeholder="Add action..."
                value={trActionDraft}
                onChange={(e) => setTrActionDraft(e.target.value)}
              />
              <button
                type="button"
                className="smv-btn smv-btn-sm"
                onClick={() => {
                  if (!trActionDraft.trim()) return;
                  controller.updateTransition(locator, {
                    actions: [...(found.transition.actions ?? []), { type: trActionDraft.trim() }],
                  });
                  setTrActionDraft("");
                }}
              >
                <Plus size={12} />
              </button>
            </div>
          )}
        </div>

        <label className="smv-switch-row">
          <span>Reenter state (`reenter: true`)</span>
          <input
            type="checkbox"
            disabled={readOnly}
            checked={Boolean(found.transition.reenter)}
            onChange={(e) => controller.updateTransition(locator, { reenter: e.target.checked })}
          />
        </label>

        <div className="smv-field">
          <label className="smv-label">Color</label>
          <ColorPicker
            value={found.transition.color}
            disabled={readOnly}
            onChange={(color) => controller.updateTransition(locator, { color })}
          />
        </div>

        <div className="smv-field">
          <label className="smv-label">Description</label>
          <textarea
            className="smv-textarea"
            disabled={readOnly}
            rows={2}
            value={found.transition.description ?? ""}
            onChange={(e) => controller.updateTransition(locator, { description: e.target.value })}
          />
        </div>
      </>
    );
  }

  // 4. Note selection
  if (selection.kind === "note") {
    const note = machine.notes.find((n) => n.id === selection.noteId);
    if (!note) return <div className="smv-list-item-sub">Note deleted.</div>;

    return (
      <>
        <div className="smv-row-between">
          <div className="smv-section-header">Canvas Note (Markdown)</div>
          {!readOnly && (
            <button
              type="button"
              className="smv-btn smv-btn-danger smv-btn-sm"
              onClick={() => controller.deleteNote(note.id)}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>

        <div className="smv-field">
          <label className="smv-label">Markdown Content</label>
          <textarea
            className="smv-textarea"
            disabled={readOnly}
            rows={6}
            value={note.text}
            onChange={(e) => controller.updateNote(note.id, { text: e.target.value })}
          />
        </div>

        <div className="smv-field">
          <label className="smv-label">Color</label>
          <ColorPicker
            value={note.color ?? "amber"}
            disabled={readOnly}
            onChange={(color) => controller.updateNote(note.id, { color })}
          />
        </div>

        <div className="smv-field">
          <label className="smv-label">Width ({note.width ?? 220}px)</label>
          <input
            type="range"
            min={160}
            max={420}
            disabled={readOnly}
            value={note.width ?? 220}
            onChange={(e) => controller.updateNote(note.id, { width: Number(e.target.value) })}
          />
        </div>
      </>
    );
  }

  return null;
}

function SimulateTab({ controller, snapshot }: RightSidebarProps) {
  const { simulation } = snapshot;
  const [customEventType, setCustomEventType] = useState("");
  const [customPayload, setCustomPayload] = useState("{}");
  const [payloadErr, setPayloadErr] = useState<string | null>(null);

  function sendCustomEvent() {
    const type = customEventType.trim();
    if (!type) return;
    try {
      const parsed = customPayload.trim() ? JSON.parse(customPayload) : {};
      setPayloadErr(null);
      controller.sendEvent({ ...parsed, type });
      setCustomEventType("");
    } catch (err) {
      setPayloadErr(err instanceof Error ? err.message : "Invalid JSON payload");
    }
  }

  return (
    <>
      <div className="smv-row-between">
        <div className="smv-section-header">
          Simulation ({simulation.externalActorAttached ? "external actor" : simulation.status})
        </div>
        <div className="smv-row">
          <button
            type="button"
            className="smv-btn smv-btn-sm"
            disabled={!simulation.canStepBack}
            onClick={() => controller.stepBackSimulation()}
            title="Step Back"
          >
            <Undo2 size={12} />
            <span>Back</span>
          </button>
          <button
            type="button"
            className="smv-btn smv-btn-sm"
            disabled={simulation.externalActorAttached}
            onClick={() => controller.resetSimulation()}
            title="Reset Simulation"
          >
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {simulation.error && (
        <div className="smv-card" style={{ borderColor: "var(--smv-danger)", color: "var(--smv-danger)" }}>
          {simulation.error}
        </div>
      )}

      {/* Active States */}
      <div className="smv-section">
        <div className="smv-section-header">Active States</div>
        <div className="smv-chip-list">
          {simulation.activeStatePaths.length === 0 ? (
            <span className="smv-list-item-sub">Not running</span>
          ) : (
            simulation.activeStatePaths.map((p) => (
              <span
                key={p}
                className="smv-chip"
                style={{
                  borderColor: "var(--smv-sim-active)",
                  color: "var(--smv-sim-active)",
                }}
              >
                ● {p}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Available Events & Delays */}
      <div className="smv-section">
        <div className="smv-section-header">Available Transitions</div>
        {simulation.availableTransitions.length === 0 ? (
          <div className="smv-list-item-sub">No outgoing events from current state.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {simulation.availableTransitions.map((avail) => {
              const tr = avail.transition;
              return (
                <button
                  key={tr.id}
                  type="button"
                  disabled={!avail.enabled}
                  className={`smv-btn ${avail.enabled ? "smv-btn-primary" : ""}`}
                  style={{ justifyContent: "space-between", height: "auto", padding: "6px 9px" }}
                  onClick={() => {
                    if (tr.kind === "on" && tr.eventKey) {
                      controller.sendEvent({ type: tr.eventKey });
                    } else if (tr.kind === "after" && tr.eventKey) {
                      controller.triggerDelay(tr.sourcePath, tr.eventKey);
                    } else if (tr.kind === "invokeDone" && tr.invokeId) {
                      controller.triggerInvokeDone(tr.invokeId);
                    } else if (tr.kind === "invokeError" && tr.invokeId) {
                      controller.triggerInvokeError(tr.invokeId);
                    }
                  }}
                >
                  <span className="smv-row">
                    {avail.enabled ? <Play size={11} /> : <Lock size={11} />}
                    <span>{tr.label}</span>
                  </span>
                  <span style={{ fontSize: 10.5, opacity: 0.8 }}>
                    → {tr.targetPath ?? "internal"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Invokes */}
      {simulation.activeInvokes.length > 0 && (
        <div className="smv-section">
          <div className="smv-section-header">Active Invoked Actors</div>
          {simulation.activeInvokes.map(({ invoke }) => (
            <div key={invoke.id} className="smv-card">
              <div style={{ fontWeight: 600, fontSize: 12 }}>
                {invoke.src} <span className="smv-list-item-sub">({invoke.id})</span>
              </div>
              <div className="smv-row">
                <button
                  type="button"
                  className="smv-btn smv-btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => controller.triggerInvokeDone(invoke.id)}
                >
                  Resolve (onDone)
                </button>
                <button
                  type="button"
                  className="smv-btn smv-btn-danger smv-btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => controller.triggerInvokeError(invoke.id)}
                >
                  Reject (onError)
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Guard Overrides */}
      {simulation.knownGuards.length > 0 && (
        <div className="smv-section">
          <div className="smv-section-header">Guard Overrides</div>
          <div className="smv-card">
            {simulation.knownGuards.map((guard) => (
              <label key={guard} className="smv-switch-row">
                <span style={{ fontFamily: "var(--smv-font-mono)", fontSize: 11.5 }}>{guard}</span>
                <input
                  type="checkbox"
                  checked={simulation.guardOverrides[guard] ?? true}
                  onChange={(e) => controller.setGuardOverride(guard, e.target.checked)}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Send custom event */}
      <div className="smv-section">
        <div className="smv-section-header">Send Custom Event</div>
        <div className="smv-row">
          <input
            className="smv-input"
            placeholder="EVENT_TYPE"
            value={customEventType}
            onChange={(e) => setCustomEventType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendCustomEvent();
            }}
          />
          <button type="button" className="smv-btn smv-btn-sm" onClick={sendCustomEvent}>
            Send
          </button>
        </div>
        <textarea
          className="smv-textarea smv-textarea-mono"
          rows={2}
          value={customPayload}
          onChange={(e) => setCustomPayload(e.target.value)}
        />
        {payloadErr && <div style={{ color: "var(--smv-danger)", fontSize: 11 }}>{payloadErr}</div>}
      </div>

      {/* Live Context */}
      <div className="smv-section">
        <div className="smv-section-header">Context</div>
        <pre className="smv-code-pre" style={{ maxHeight: 140 }}>
          {JSON.stringify(simulation.context, null, 2)}
        </pre>
      </div>

      {/* Event Log */}
      <div className="smv-section">
        <div className="smv-section-header">Event Log ({simulation.log.length})</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {[...simulation.log].reverse().map((entry) => (
            <div key={entry.id} className="smv-log-item">
              <div className="smv-row-between">
                <span className="smv-log-event">{entry.eventType}</span>
                <span className="smv-list-item-sub">
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>
              <div className="smv-log-states">
                {entry.fromStates[entry.fromStates.length - 1] ?? "start"} →{" "}
                {entry.toStates[entry.toStates.length - 1] ?? "none"}
              </div>
              {entry.actionsFired.length > 0 && (
                <div className="smv-list-item-sub">
                  actions: {entry.actionsFired.join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function CodeTab({ controller, snapshot }: RightSidebarProps) {
  const { machine, config } = snapshot;
  const [format, setFormat] = useState<ExportFormat>("typescript");
  const [importMode, setImportMode] = useState(false);
  const [importDraft, setImportDraft] = useState("");
  const [importErr, setImportErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generated = useMemo(() => exportMachine(machine, format), [machine, format]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(generated);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  }

  function handleApplyImport() {
    try {
      setImportErr(null);
      controller.importSource(importDraft);
      setImportMode(false);
    } catch (err) {
      setImportErr(err instanceof Error ? err.message : "Failed to parse machine source");
    }
  }

  return (
    <>
      <div className="smv-row-between">
        <div className="smv-section-header">{importMode ? "Import Code / JSON" : "Export Code"}</div>
        {!config.readOnly && (
          <button
            type="button"
            className={`smv-btn smv-btn-sm ${importMode ? "smv-btn-active" : ""}`}
            onClick={() => {
              setImportMode((v) => !v);
              setImportDraft(generated);
              setImportErr(null);
            }}
          >
            <Upload size={12} />
            <span>{importMode ? "Back to Export" : "Import"}</span>
          </button>
        )}
      </div>

      {importMode ? (
        <>
          <div className="smv-list-item-sub">
            Paste XState v5 TypeScript/JavaScript (`createMachine(...)`), XState JSON, or a
            Visualizer Document JSON.
          </div>
          <textarea
            className="smv-textarea smv-textarea-mono"
            rows={16}
            value={importDraft}
            onChange={(e) => setImportDraft(e.target.value)}
          />
          {importErr && <div style={{ color: "var(--smv-danger)", fontSize: 11 }}>{importErr}</div>}
          <button
            type="button"
            className="smv-btn smv-btn-primary"
            onClick={handleApplyImport}
          >
            Import into Visualizer
          </button>
        </>
      ) : (
        <>
          <select
            className="smv-select"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            <option value="typescript">XState v5 TypeScript</option>
            <option value="javascript">XState v5 JavaScript</option>
            <option value="xstate-json">XState v5 JSON</option>
            <option value="document-json">Visualizer Document JSON (lossless)</option>
            <option value="mermaid">Mermaid stateDiagram-v2</option>
          </select>

          <div className="smv-row">
            <button type="button" className="smv-btn smv-btn-sm" onClick={() => void handleCopy()}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
            {config.enableFileIO && (
              <button
                type="button"
                className="smv-btn smv-btn-sm"
                onClick={() => void saveMachineToFile(machine, format)}
              >
                <Download size={12} />
                <span>Download</span>
              </button>
            )}
          </div>

          <pre className="smv-code-pre">{generated}</pre>
        </>
      )}
    </>
  );
}

function SettingsTab({ controller, snapshot }: RightSidebarProps) {
  const { config } = snapshot;

  const toggle = (key: keyof typeof config, label: string) => (
    <label key={key} className="smv-switch-row">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={Boolean(config[key])}
        onChange={(e) => controller.setConfig({ [key]: e.target.checked })}
      />
    </label>
  );

  return (
    <>
      <div className="smv-section">
        <div className="smv-section-header">Layout & Routing</div>

        <div className="smv-field">
          <label className="smv-label">Layout Direction</label>
          <select
            className="smv-select"
            value={config.layoutDirection}
            onChange={(e) =>
              controller.setConfig({ layoutDirection: e.target.value as LayoutDirection })
            }
          >
            <option value="RIGHT">Left → Right (RIGHT)</option>
            <option value="DOWN">Top → Bottom (DOWN)</option>
            <option value="LEFT">Right → Left (LEFT)</option>
            <option value="UP">Bottom → Top (UP)</option>
          </select>
        </div>

        <div className="smv-field">
          <label className="smv-label">Edge Routing</label>
          <select
            className="smv-select"
            value={config.edgeRouting}
            onChange={(e) => controller.setConfig({ edgeRouting: e.target.value as EdgeRouting })}
          >
            <option value="ORTHOGONAL">Orthogonal (Rounded)</option>
            <option value="SPLINES">Curved Splines</option>
            <option value="POLYLINE">Straight Polyline</option>
          </select>
        </div>

        <div className="smv-field">
          <label className="smv-label">Theme</label>
          <select
            className="smv-select"
            value={config.theme}
            onChange={(e) => controller.setConfig({ theme: e.target.value as VisualizerTheme })}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>

        <div className="smv-field">
          <label className="smv-label">Node Spacing ({config.nodeSpacing}px)</label>
          <input
            type="range"
            min={16}
            max={120}
            value={config.nodeSpacing}
            onChange={(e) => controller.setConfig({ nodeSpacing: Number(e.target.value) })}
          />
        </div>

        <div className="smv-field">
          <label className="smv-label">Layer Spacing ({config.layerSpacing}px)</label>
          <input
            type="range"
            min={40}
            max={180}
            value={config.layerSpacing}
            onChange={(e) => controller.setConfig({ layerSpacing: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="smv-section">
        <div className="smv-section-header">Canvas Display</div>
        <div className="smv-card">
          {toggle("translucentEvents", "Translucent event pills")}
          {toggle("showGrid", "Show dot grid")}
          {toggle("showMinimap", "Show minimap")}
          {toggle("showDescriptions", "Show descriptions")}
          {toggle("showTags", "Show tags")}
          {toggle("showActions", "Show entry / exit actions")}
          {toggle("showGuards", "Show guard labels")}
          {toggle("showInvoke", "Show invoked actors")}
          {toggle("showNotes", "Show canvas notes")}
          {toggle("showColors", "Show state & event colors")}
          {toggle("fadeColorsInSimulate", "Fade colors in Simulate mode")}
        </div>
      </div>

      <div className="smv-section">
        <div className="smv-section-header">Behavior & Persistence</div>
        <div className="smv-card">
          {toggle("readOnly", "Read-only mode")}
          {toggle("enableBrowserStorage", "Browser DB (IndexedDB)")}
          {toggle("enableFileIO", "File import / export")}
          {toggle("enableKeyboardShortcuts", "Keyboard shortcuts")}
        </div>
      </div>

      <div className="smv-section">
        <div className="smv-section-header">Programmatic Config JSON</div>
        <pre className="smv-code-pre" style={{ maxHeight: 180 }}>
          {JSON.stringify(config, null, 2)}
        </pre>
      </div>
    </>
  );
}
