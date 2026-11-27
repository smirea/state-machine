import {
  Copy,
  Database,
  FolderOpen,
  GitBranch,
  Layers,
  Plus,
  Search,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { VisualizerController, VisualizerControllerSnapshot } from "../controller.ts";
import { MACHINE_PRESETS } from "../core/presets.ts";
import { listAllStates } from "../core/xstate-adapter.ts";
import { openMachineFromFile } from "../storage/files.ts";

interface LeftSidebarProps {
  controller: VisualizerController;
  snapshot: VisualizerControllerSnapshot;
  onCloseMobile?: () => void;
}

export function LeftSidebar({ controller, snapshot, onCloseMobile }: LeftSidebarProps) {
  const { machine, config, savedMachines, selection, simulation } = snapshot;
  const [tab, setTab] = useState<"machines" | "outline">("machines");
  const [query, setQuery] = useState("");

  const filteredSaved = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return savedMachines;
    return savedMachines.filter(
      (rec) =>
        rec.name.toLowerCase().includes(q) ||
        rec.id.toLowerCase().includes(q) ||
        (rec.description ?? "").toLowerCase().includes(q),
    );
  }, [savedMachines, query]);

  const allStates = useMemo(() => listAllStates(machine), [machine]);
  const activeStateSet = useMemo(
    () => new Set(simulation.activeStatePaths),
    [simulation.activeStatePaths],
  );

  async function handleOpenFile() {
    try {
      const res = await openMachineFromFile();
      if (res) {
        controller.setMachine(res.document, { markDirty: true });
        onCloseMobile?.();
      }
    } catch (err) {
      console.error("Import file failed:", err);
    }
  }

  return (
    <aside className="smv-sidebar" data-testid="smv-left-sidebar">
      <div className="smv-sidebar-tabs">
        <button
          type="button"
          className={`smv-sidebar-tab ${tab === "machines" ? "active" : ""}`}
          onClick={() => setTab("machines")}
        >
          <Database size={13} />
          <span>Machines</span>
        </button>
        <button
          type="button"
          className={`smv-sidebar-tab ${tab === "outline" ? "active" : ""}`}
          onClick={() => setTab("outline")}
        >
          <GitBranch size={13} />
          <span>Outline</span>
        </button>
      </div>

      <div className="smv-sidebar-content">
        {tab === "machines" ? (
          <>
            <div className="smv-row">
              {!config.readOnly && (
                <button
                  type="button"
                  className="smv-btn smv-btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => {
                    controller.createNewMachine();
                    onCloseMobile?.();
                  }}
                >
                  <Plus size={14} />
                  <span>New Machine</span>
                </button>
              )}
              {config.enableFileIO && (
                <button
                  type="button"
                  className="smv-btn"
                  onClick={() => void handleOpenFile()}
                  title="Open machine from disk"
                >
                  <FolderOpen size={14} />
                </button>
              )}
            </div>

            {config.enableBrowserStorage && (
              <div className="smv-section">
                <div className="smv-section-header">
                  <span>Browser DB ({savedMachines.length})</span>
                </div>

                <div className="smv-row" style={{ position: "relative" }}>
                  <Search
                    size={13}
                    style={{
                      position: "absolute",
                      left: 8,
                      color: "var(--smv-text-muted)",
                      pointerEvents: "none",
                    }}
                  />
                  <input
                    className="smv-input"
                    style={{ paddingLeft: 26 }}
                    placeholder="Filter saved machines..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>

                {filteredSaved.length === 0 ? (
                  <div className="smv-list-item-sub" style={{ padding: "6px 2px" }}>
                    No machines saved in browser DB yet. Click Save to persist the current machine.
                  </div>
                ) : (
                  filteredSaved.map((rec) => {
                    const isCurrent = rec.id === machine.id;
                    return (
                      <div
                        key={rec.id}
                        className={`smv-list-item ${isCurrent ? "active" : ""}`}
                        onClick={() => {
                          void controller.loadFromStorage(rec.id);
                          onCloseMobile?.();
                        }}
                      >
                        <div className="smv-list-item-main">
                          <div className="smv-list-item-title">{rec.name}</div>
                          <div className="smv-list-item-sub">
                            {rec.id} · {new Date(rec.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                        <div className="smv-row" style={{ gap: 2 }}>
                          <button
                            type="button"
                            className="smv-btn smv-btn-icon smv-btn-sm"
                            title="Duplicate"
                            aria-label={`Duplicate ${rec.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void controller.duplicateInStorage(rec.id);
                            }}
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            type="button"
                            className="smv-btn smv-btn-icon smv-btn-sm"
                            title="Delete from Browser DB"
                            aria-label={`Delete ${rec.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void controller.deleteFromStorage(rec.id);
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            <div className="smv-section">
              <div className="smv-section-header">
                <span>Templates</span>
              </div>
              {MACHINE_PRESETS.map((preset) => (
                <div
                  key={preset.id}
                  className="smv-list-item"
                  onClick={() => {
                    controller.loadPreset(preset.id);
                    onCloseMobile?.();
                  }}
                >
                  <div className="smv-list-item-main">
                    <div className="smv-list-item-title">{preset.label}</div>
                    <div className="smv-list-item-sub">{preset.summary}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="smv-section">
              <div className="smv-section-header">
                <span>States ({allStates.length})</span>
                {!config.readOnly && (
                  <button
                    type="button"
                    className="smv-btn smv-btn-sm"
                    onClick={() => controller.addState({ name: "state" })}
                  >
                    <Plus size={12} />
                    <span>Add</span>
                  </button>
                )}
              </div>

              <div
                className={`smv-list-item ${selection.kind === "machine" ? "active" : ""}`}
                onClick={() => {
                  controller.select({ kind: "machine" });
                  onCloseMobile?.();
                }}
              >
                <div className="smv-row" style={{ minWidth: 0 }}>
                  <Layers size={13} />
                  <span className="smv-list-item-title">{machine.id} (root)</span>
                </div>
              </div>

              {allStates.map((entry) => {
                const isSelected = selection.kind === "state" && selection.path === entry.path;
                const isActiveSim = config.mode === "simulate" && activeStateSet.has(entry.path);
                return (
                  <div
                    key={entry.path}
                    className={`smv-list-item ${isSelected ? "active" : ""}`}
                    style={{ paddingLeft: 10 + entry.depth * 14 }}
                    onClick={() => {
                      controller.select({ kind: "state", path: entry.path });
                      onCloseMobile?.();
                    }}
                  >
                    <div className="smv-row" style={{ minWidth: 0, flex: 1 }}>
                      {isActiveSim ? (
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: "var(--smv-sim-active)",
                            flexShrink: 0,
                          }}
                        />
                      ) : entry.isInitial ? (
                        <span className="smv-initial-dot" />
                      ) : null}
                      <span className="smv-list-item-title">{entry.key}</span>
                    </div>
                    <span className="smv-type-badge">{entry.resolvedType}</span>
                  </div>
                );
              })}
            </div>

            <div className="smv-section">
              <div className="smv-section-header">
                <span>Canvas Notes ({machine.notes.length})</span>
                {!config.readOnly && (
                  <button
                    type="button"
                    className="smv-btn smv-btn-sm"
                    onClick={() => controller.addNote()}
                  >
                    <Plus size={12} />
                    <span>Note</span>
                  </button>
                )}
              </div>
              {machine.notes.map((note) => (
                <div
                  key={note.id}
                  className={`smv-list-item ${
                    selection.kind === "note" && selection.noteId === note.id ? "active" : ""
                  }`}
                  onClick={() => {
                    controller.select({ kind: "note", noteId: note.id });
                    onCloseMobile?.();
                  }}
                >
                  <div className="smv-row" style={{ minWidth: 0 }}>
                    <StickyNote size={13} />
                    <span className="smv-list-item-title">{note.text.split("\n")[0]}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
