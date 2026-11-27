import { exportMachine, importMachineSource } from "../core/codegen.ts";
import type { ExportFormat, MachineDocument } from "../core/types.ts";

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface FileSystemWritableFileStreamLike {
  write(data: string | Blob): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandleLike {
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
}

interface WindowWithFilePickers extends Window {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: FilePickerAcceptType[];
  }) => Promise<FileSystemFileHandleLike[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: FilePickerAcceptType[];
  }) => Promise<FileSystemFileHandleLike>;
}

const FORMAT_METADATA: Record<ExportFormat, { ext: string; mime: string; label: string }> = {
  "document-json": { ext: ".smv.json", mime: "application/json", label: "Visualizer Machine JSON" },
  "xstate-json": { ext: ".xstate.json", mime: "application/json", label: "XState v5 JSON" },
  typescript: { ext: ".machine.ts", mime: "text/typescript", label: "XState v5 TypeScript" },
  javascript: { ext: ".machine.js", mime: "text/javascript", label: "XState v5 JavaScript" },
  mermaid: { ext: ".mmd", mime: "text/plain", label: "Mermaid State Diagram" },
};

export function downloadTextFile(filename: string, content: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveMachineToFile(
  doc: MachineDocument,
  format: ExportFormat = "document-json",
): Promise<string> {
  const meta = FORMAT_METADATA[format];
  const content = exportMachine(doc, format);
  const safeBase = doc.id.replace(/[^a-zA-Z0-9_-]/g, "_") || "machine";
  const filename = `${safeBase}${meta.ext}`;

  const win = typeof window !== "undefined" ? (window as WindowWithFilePickers) : undefined;
  if (win?.showSaveFilePicker) {
    try {
      const handle = await win.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: meta.label, accept: { [meta.mime]: [meta.ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return filename;
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        throw err;
      }
    }
  }

  downloadTextFile(filename, content, meta.mime);
  return filename;
}

export async function openMachineFromFile(): Promise<{ document: MachineDocument; filename: string } | null> {
  const win = typeof window !== "undefined" ? (window as WindowWithFilePickers) : undefined;

  if (win?.showOpenFilePicker) {
    try {
      const [handle] = await win.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "State Machine Files (.json, .ts, .js)",
            accept: {
              "application/json": [".json"],
              "text/plain": [".ts", ".tsx", ".js", ".jsx", ".mjs"],
            },
          },
        ],
      });
      if (!handle) return null;
      const file = await handle.getFile();
      const text = await file.text();
      const baseName = file.name.replace(/\.(smv|xstate|machine)?\.(json|ts|tsx|js|jsx|mjs)$/i, "");
      return { document: importMachineSource(text, baseName), filename: file.name };
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        return null;
      }
    }
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.ts,.tsx,.js,.jsx,.mjs";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const text = await file.text();
        const baseName = file.name.replace(/\.(smv|xstate|machine)?\.(json|ts|tsx|js|jsx|mjs)$/i, "");
        resolve({ document: importMachineSource(text, baseName), filename: file.name });
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}

export function exportSvgElement(svg: SVGSVGElement, filename = "state-machine.svg"): void {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const serializer = new XMLSerializer();
  const content = serializer.serializeToString(clone);
  downloadTextFile(filename, content, "image/svg+xml");
}
