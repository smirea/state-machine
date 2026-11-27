import {
  Check,
  Download,
  FileCode2,
  FolderOpen,
  LayoutGrid,
  Maximize2,
  Moon,
  PanelLeft,
  PanelRight,
  Pencil,
  Play,
  Redo2,
  Save,
  Sun,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { VisualizerController, VisualizerControllerSnapshot } from "../controller.ts";
import type { ExportFormat } from "../core/types.ts";
import { openMachineFromFile, saveMachineToFile } from "../storage/files.ts";

interface ToolbarProps {
  controller: VisualizerController;
  snapshot: VisualizerControllerSnapshot;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onExportSvg?: () => void;
}

export function Toolbar({
  controller,
  snapshot,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
  onExportSvg,
}: ToolbarProps) {
  const { machine, config, dirty, canUndo, canRedo } = snapshot;
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fileMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setFileMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [fileMenuOpen]);

  async function handleSaveDb() {
    const saved = await controller.saveToStorage();
    if (saved) {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    }
  }

  async function handleOpenFile() {
    setFileMenuOpen(false);
    try {
      const opened = await openMachineFromFile();
      if (opened) {
        controller.setMachine(opened.document, { markDirty: true });
      }
    } catch (err) {
      controller.setConfig({});
      console.error("Failed to open file:", err);
    }
  }

  async function handleSaveFile(format: ExportFormat) {
    setFileMenuOpen(false);
    try {
      await saveMachineToFile(machine, format);
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        console.error("Failed to save file:", err);
      }
    }
  }

  function cycleTheme() {
    const next = config.theme === "dark" ? "light" : "dark";
    controller.setConfig({ theme: next });
  }

  return (
    <header className="smv-toolbar" data-testid="smv-toolbar">
      <div className="smv-toolbar-group">
        <button
          type="button"
          className={`smv-btn smv-btn-icon ${leftOpen ? "smv-btn-active" : ""}`}
          onClick={onToggleLeft}
          title="Toggle Machines & Outline"
          aria-label="Toggle Left Sidebar"
        >
          <PanelLeft size={15} />
        </button>

        <input
          className="smv-title-input"
          value={machine.name}
          disabled={config.readOnly}
          onChange={(e) => controller.updateMachineMeta({ name: e.target.value })}
          aria-label="Machine Name"
          title="Machine name"
        />
        {dirty && <span className="smv-dirty-dot" title="Unsaved changes" />}
      </div>

      <div className="smv-toolbar-group">
        <div className="smv-segmented" role="tablist" aria-label="Editor Mode">
          <button
            type="button"
            role="tab"
            aria-selected={config.mode === "design"}
            className={config.mode === "design" ? "active" : ""}
            onClick={() => controller.setMode("design")}
          >
            <Pencil size={13} />
            <span>Design</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={config.mode === "simulate"}
            className={config.mode === "simulate" ? "active-sim" : ""}
            onClick={() => controller.setMode("simulate")}
          >
            <Play size={13} />
            <span>Simulate</span>
          </button>
        </div>
      </div>

      <div className="smv-toolbar-group">
        {!config.readOnly && (
          <>
            <button
              type="button"
              className="smv-btn smv-btn-icon smv-hide-mobile"
              disabled={!canUndo}
              onClick={() => controller.undo()}
              title="Undo (Cmd/Ctrl+Z)"
              aria-label="Undo"
            >
              <Undo2 size={14} />
            </button>
            <button
              type="button"
              className="smv-btn smv-btn-icon smv-hide-mobile"
              disabled={!canRedo}
              onClick={() => controller.redo()}
              title="Redo (Cmd/Ctrl+Shift+Z)"
              aria-label="Redo"
            >
              <Redo2 size={14} />
            </button>
          </>
        )}

        <button
          type="button"
          className="smv-btn smv-hide-mobile"
          onClick={() => controller.autoLayout()}
          title="Auto-layout machine with ELK"
        >
          <LayoutGrid size={14} />
          <span>Auto Layout</span>
        </button>

        <button
          type="button"
          className="smv-btn smv-btn-icon smv-hide-mobile"
          onClick={() => controller.fitView()}
          title="Fit View (F)"
          aria-label="Fit View"
        >
          <Maximize2 size={14} />
        </button>

        {config.enableBrowserStorage && (
          <button
            type="button"
            className="smv-btn smv-btn-primary"
            onClick={() => void handleSaveDb()}
            title="Save to Browser DB (IndexedDB)"
          >
            {justSaved ? <Check size={14} /> : <Save size={14} />}
            <span className="smv-hide-mobile">{justSaved ? "Saved" : "Save"}</span>
          </button>
        )}

        {config.enableFileIO && (
          <div className="smv-dropdown-wrap" ref={menuRef}>
            <button
              type="button"
              className="smv-btn"
              onClick={() => setFileMenuOpen((v) => !v)}
              title="Open / Export files"
              aria-label="Files menu"
            >
              <FolderOpen size={14} />
              <span className="smv-hide-mobile">File</span>
            </button>

            {fileMenuOpen && (
              <div className="smv-dropdown-menu" role="menu">
                <button
                  type="button"
                  className="smv-dropdown-item"
                  onClick={() => void handleOpenFile()}
                >
                  <FolderOpen size={14} />
                  <span>Open from File (.json / .ts)...</span>
                </button>
                <div className="smv-dropdown-sep" />
                <button
                  type="button"
                  className="smv-dropdown-item"
                  onClick={() => void handleSaveFile("document-json")}
                >
                  <Download size={14} />
                  <span>Save Visualizer Document (.smv.json)</span>
                </button>
                <button
                  type="button"
                  className="smv-dropdown-item"
                  onClick={() => void handleSaveFile("xstate-json")}
                >
                  <Download size={14} />
                  <span>Export XState v5 JSON (.xstate.json)</span>
                </button>
                <button
                  type="button"
                  className="smv-dropdown-item"
                  onClick={() => void handleSaveFile("typescript")}
                >
                  <FileCode2 size={14} />
                  <span>Export XState v5 TypeScript (.ts)</span>
                </button>
                <button
                  type="button"
                  className="smv-dropdown-item"
                  onClick={() => void handleSaveFile("mermaid")}
                >
                  <FileCode2 size={14} />
                  <span>Export Mermaid (.mmd)</span>
                </button>
                {onExportSvg && (
                  <>
                    <div className="smv-dropdown-sep" />
                    <button
                      type="button"
                      className="smv-dropdown-item"
                      onClick={() => {
                        setFileMenuOpen(false);
                        onExportSvg();
                      }}
                    >
                      <Download size={14} />
                      <span>Export Diagram SVG (.svg)</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          className="smv-btn smv-btn-icon"
          onClick={cycleTheme}
          title={`Switch to ${config.theme === "dark" ? "light" : "dark"} theme`}
          aria-label="Toggle Theme"
        >
          {config.theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        <button
          type="button"
          className={`smv-btn smv-btn-icon ${rightOpen ? "smv-btn-active" : ""}`}
          onClick={onToggleRight}
          title="Toggle Inspector / Simulate / Code / Config"
          aria-label="Toggle Right Sidebar"
        >
          <PanelRight size={15} />
        </button>
      </div>
    </header>
  );
}
