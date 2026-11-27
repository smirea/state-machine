import {
  type ExportFormat,
  type MachineDocument,
  type StateNodeDocument,
  type TransitionDocument,
} from "./types.ts";
import {
  collectMachineSymbols,
  fromXStateConfig,
  resolveStateNodeType,
  toXStateConfig,
} from "./xstate-adapter.ts";

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? `${pad}${line}` : line))
    .join("\n");
}

function toSafeIdentifier(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_$]/g, "_").replace(/^(\d)/, "_$1");
  return cleaned || "machine";
}

function formatJsObject(value: unknown, level = 0): string {
  const pad = " ".repeat(level * 2);
  const innerPad = " ".repeat((level + 1) * 2);

  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => `${innerPad}${formatJsObject(item, level + 1)}`);
    return `[\n${items.join(",\n")},\n${pad}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    const lines = entries.map(([key, val]) => {
      const formattedKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
      return `${innerPad}${formattedKey}: ${formatJsObject(val, level + 1)}`;
    });
    return `{\n${lines.join(",\n")},\n${pad}}`;
  }

  return "undefined";
}

export function exportTypeScript(doc: MachineDocument): string {
  const symbols = collectMachineSymbols(doc);
  const config = toXStateConfig(doc, { includeVisualMeta: false });
  const varName = `${toSafeIdentifier(doc.id)}Machine`;

  const imports = new Set<string>(["setup"]);
  if (symbols.actors.length > 0) imports.add("fromPromise");

  const setupSections: string[] = [];

  if (symbols.guards.length > 0) {
    const guardEntries = symbols.guards
      .map((g) => `    ${JSON.stringify(g)}: ({ context }) => Boolean(context),`)
      .join("\n");
    setupSections.push(`  guards: {\n${guardEntries}\n  },`);
  }

  if (symbols.actions.length > 0) {
    const actionEntries = symbols.actions
      .map((a) => `    ${JSON.stringify(a)}: ({ event }) => {\n      console.log(${JSON.stringify(a)}, event);\n    },`)
      .join("\n");
    setupSections.push(`  actions: {\n${actionEntries}\n  },`);
  }

  if (symbols.delays.length > 0) {
    const delayEntries = symbols.delays.map((d) => `    ${JSON.stringify(d)}: 2000,`).join("\n");
    setupSections.push(`  delays: {\n${delayEntries}\n  },`);
  }

  if (symbols.actors.length > 0) {
    const actorEntries = symbols.actors
      .map(
        (a) =>
          `    ${JSON.stringify(a)}: fromPromise(async () => {\n      // TODO: implement ${a}\n      return {};\n    }),`,
      )
      .join("\n");
    setupSections.push(`  actors: {\n${actorEntries}\n  },`);
  }

  const machineConfigText = formatJsObject(config, 0);

  if (setupSections.length === 0) {
    return `import { createMachine } from "xstate";\n\nexport const ${varName} = createMachine(${machineConfigText});\n`;
  }

  return [
    `import { ${[...imports].join(", ")} } from "xstate";`,
    "",
    `export const ${varName} = setup({`,
    ...setupSections,
    `}).createMachine(${machineConfigText});`,
    "",
  ].join("\n");
}

export function exportJavaScript(doc: MachineDocument): string {
  return exportTypeScript(doc);
}

export function exportXStateJson(doc: MachineDocument): string {
  return `${JSON.stringify(toXStateConfig(doc, { includeVisualMeta: false }), null, 2)}\n`;
}

export function exportDocumentJson(doc: MachineDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function mermaidId(path: string): string {
  return path.replace(/[^a-zA-Z0-9_]/g, "_");
}

function formatMermaidEdgeLabel(base: string, tr: TransitionDocument): string {
  const parts = [base];
  if (tr.guard) parts.push(`[${tr.guard}]`);
  if (tr.actions && tr.actions.length > 0) {
    parts.push(`/ ${tr.actions.map((a) => a.type).join(", ")}`);
  }
  return parts.join(" ");
}

export function exportMermaid(doc: MachineDocument): string {
  const lines: string[] = ["stateDiagram-v2"];

  function emitTransitions(sourcePath: string, node: StateNodeDocument, pad: string): void {
    const srcId = mermaidId(sourcePath);

    const emitList = (baseLabel: string, list: TransitionDocument[] | undefined) => {
      for (const tr of list ?? []) {
        const target = tr.target
          ? mermaidId(
              tr.target.startsWith("#")
                ? tr.target.replace(`#${doc.id}.`, "").replace(/^#/, "")
                : tr.target.startsWith(".")
                  ? `${sourcePath}${tr.target}`
                  : sourcePath.includes(".")
                    ? `${sourcePath.slice(0, sourcePath.lastIndexOf("."))}.${tr.target}`
                    : tr.target,
            )
          : srcId;
        lines.push(`${pad}${srcId} --> ${target} : ${formatMermaidEdgeLabel(baseLabel, tr)}`);
      }
    };

    for (const [ev, list] of Object.entries(node.on ?? {})) emitList(ev, list);
    emitList("always", node.always);
    for (const [delay, list] of Object.entries(node.after ?? {})) {
      emitList(`after ${delay}${/^\d+$/.test(delay) ? "ms" : ""}`, list);
    }
    emitList("onDone", node.onDone);
    for (const inv of node.invoke ?? []) {
      emitList(`${inv.id}.done`, inv.onDone);
      emitList(`${inv.id}.error`, inv.onError);
    }
  }

  function emitScope(
    states: Record<string, StateNodeDocument>,
    parentPath: string | null,
    initialKey: string | undefined,
    isParallel: boolean,
    depth: number,
  ): void {
    const pad = " ".repeat((depth + 1) * 2);
    const keys = Object.keys(states);

    if (!isParallel) {
      const init = initialKey ?? keys[0];
      if (init && states[init]) {
        const initPath = parentPath ? `${parentPath}.${init}` : init;
        lines.push(`${pad}[*] --> ${mermaidId(initPath)}`);
      }
    }

    keys.forEach((key, idx) => {
      const node = states[key];
      const path = parentPath ? `${parentPath}.${key}` : key;
      const id = mermaidId(path);
      const resolved = resolveStateNodeType(node);

      if (resolved === "final") {
        lines.push(`${pad}${id} : ${key} (final)`);
        lines.push(`${pad}${id} --> [*]`);
      } else if (resolved === "history") {
        lines.push(`${pad}${id} : ${key} (H${node.history === "deep" ? "*" : ""})`);
      } else if (node.states && Object.keys(node.states).length > 0) {
        lines.push(`${pad}state "${key}" as ${id} {`);
        emitScope(node.states, path, node.initial, resolved === "parallel", depth + 1);
        lines.push(`${pad}}`);
      } else {
        lines.push(`${pad}state "${key}" as ${id}`);
      }

      emitTransitions(path, node, pad);

      if (isParallel && idx < keys.length - 1) {
        lines.push(`${pad}--`);
      }
    });
  }

  emitScope(doc.states, null, doc.initial, doc.type === "parallel", 0);
  return `${lines.join("\n")}\n`;
}

export function exportMachine(doc: MachineDocument, format: ExportFormat): string {
  switch (format) {
    case "typescript":
      return exportTypeScript(doc);
    case "javascript":
      return exportJavaScript(doc);
    case "xstate-json":
      return exportXStateJson(doc);
    case "document-json":
      return exportDocumentJson(doc);
    case "mermaid":
      return exportMermaid(doc);
  }
}

// ---------------------------------------------------------------------------
// Safe JS/TS object-literal parser for importing createMachine({...}) source
// without calling eval() or Function().
// ---------------------------------------------------------------------------

type TokenKind = "punct" | "string" | "number" | "ident" | "eof";
interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

function tokenizeJs(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Line comment
    if (ch === "/" && input[i + 1] === "/") {
      i += 2;
      while (i < len && input[i] !== "\n") i++;
      continue;
    }

    // Block comment
    if (ch === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < len && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // String literals (single, double, template without interpolation)
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const start = i++;
      let out = "";
      while (i < len && input[i] !== quote) {
        if (input[i] === "\\" && i + 1 < len) {
          const esc = input[i + 1];
          if (esc === "n") out += "\n";
          else if (esc === "t") out += "\t";
          else if (esc === "r") out += "\r";
          else out += esc;
          i += 2;
        } else {
          out += input[i++];
        }
      }
      i++; // closing quote
      tokens.push({ kind: "string", value: out, pos: start });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(input[i + 1] ?? ""))) {
      const start = i;
      if (ch === "-") i++;
      while (i < len && /[0-9._]/.test(input[i])) i++;
      tokens.push({ kind: "number", value: input.slice(start, i).replace(/_/g, ""), pos: start });
      continue;
    }

    // Identifiers
    if (/[a-zA-Z_$]/.test(ch)) {
      const start = i;
      while (i < len && /[a-zA-Z0-9_$]/.test(input[i])) i++;
      tokens.push({ kind: "ident", value: input.slice(start, i), pos: start });
      continue;
    }

    // Multi-char arrow
    if (ch === "=" && input[i + 1] === ">") {
      tokens.push({ kind: "punct", value: "=>", pos: i });
      i += 2;
      continue;
    }

    tokens.push({ kind: "punct", value: ch, pos: i });
    i++;
  }

  tokens.push({ kind: "eof", value: "", pos: len });
  return tokens;
}

function parseObjectExpressionAt(tokens: Token[], startIdx: number): { value: unknown; nextIdx: number } {
  let idx = startIdx;

  const peek = () => tokens[idx] ?? { kind: "eof", value: "", pos: -1 };
  const next = () => tokens[idx++] ?? { kind: "eof", value: "", pos: -1 };

  function skipBalanced(open: string, close: string): void {
    let depth = 0;
    while (idx < tokens.length) {
      const t = next();
      if (t.kind === "punct" && t.value === open) depth++;
      else if (t.kind === "punct" && t.value === close) {
        depth--;
        if (depth <= 0) return;
      } else if (t.kind === "eof") {
        return;
      }
    }
  }

  function skipOpaqueExpression(): string {
    const start = idx;
    let paren = 0;
    let brace = 0;
    let bracket = 0;
    const parts: string[] = [];

    while (idx < tokens.length) {
      const t = peek();
      if (t.kind === "eof") break;
      if (paren === 0 && brace === 0 && bracket === 0) {
        if (t.kind === "punct" && (t.value === "," || t.value === "}" || t.value === "]")) {
          break;
        }
      }
      next();
      parts.push(t.value);
      if (t.kind === "punct") {
        if (t.value === "(") paren++;
        else if (t.value === ")") paren = Math.max(0, paren - 1);
        else if (t.value === "{") brace++;
        else if (t.value === "}") brace = Math.max(0, brace - 1);
        else if (t.value === "[") bracket++;
        else if (t.value === "]") bracket = Math.max(0, bracket - 1);
      }
    }

    if (idx === start) return "inline";
    const firstIdent = parts.find((p) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(p));
    return firstIdent && firstIdent !== "function" ? firstIdent : "inline";
  }

  function parseValue(): unknown {
    const t = peek();

    if (t.kind === "string") {
      next();
      return t.value;
    }

    if (t.kind === "number") {
      next();
      return Number(t.value);
    }

    if (t.kind === "punct" && t.value === "{") {
      return parseObject();
    }

    if (t.kind === "punct" && t.value === "[") {
      return parseArray();
    }

    if (t.kind === "ident") {
      if (t.value === "true") {
        next();
        return true;
      }
      if (t.value === "false") {
        next();
        return false;
      }
      if (t.value === "null") {
        next();
        return null;
      }
      if (t.value === "undefined") {
        next();
        return undefined;
      }
      // Handle `as Type` assertions after an identifier or call like `assign({...})`
      const label = skipOpaqueExpression();
      return label;
    }

    // Arrow functions `(args) => ...` or other expressions
    return skipOpaqueExpression();
  }

  function parseArray(): unknown[] {
    next(); // [
    const arr: unknown[] = [];
    while (peek().kind !== "eof") {
      if (peek().kind === "punct" && peek().value === "]") {
        next();
        break;
      }
      arr.push(parseValue());
      if (peek().kind === "punct" && peek().value === ",") {
        next();
      } else if (peek().kind === "punct" && peek().value === "]") {
        next();
        break;
      } else {
        // Recover from TypeScript assertions like `as const`
        if (peek().kind === "ident" && peek().value === "as") {
          skipOpaqueExpression();
        } else {
          next();
        }
      }
    }
    return arr;
  }

  function parseObject(): Record<string, unknown> {
    next(); // {
    const obj: Record<string, unknown> = {};
    while (peek().kind !== "eof") {
      if (peek().kind === "punct" && peek().value === "}") {
        next();
        break;
      }

      const keyToken = next();
      if (keyToken.kind === "punct" && keyToken.value === ",") continue;

      let key: string;
      if (keyToken.kind === "string" || keyToken.kind === "ident" || keyToken.kind === "number") {
        key = keyToken.value;
      } else if (keyToken.kind === "punct" && keyToken.value === "[") {
        const inner = next();
        key = inner.value;
        if (peek().kind === "punct" && peek().value === "]") next();
      } else {
        break;
      }

      // Skip TypeScript `as ...` or method shorthand `foo() { ... }`
      if (peek().kind === "punct" && peek().value === "(") {
        skipBalanced("(", ")");
        if (peek().kind === "punct" && peek().value === "{") skipBalanced("{", "}");
        obj[key] = key;
      } else if (peek().kind === "punct" && peek().value === ":") {
        next(); // :
        const val = parseValue();
        // Consume optional TypeScript `as Type`
        if (peek().kind === "ident" && peek().value === "as") {
          skipOpaqueExpression();
        }
        obj[key] = val;
      } else {
        // Shorthand property `{ foo }`
        obj[key] = key;
      }

      if (peek().kind === "punct" && peek().value === ",") {
        next();
      }
    }
    return obj;
  }

  const value = parseValue();
  return { value, nextIdx: idx };
}

function extractMachineConfigFromCode(source: string): Record<string, unknown> | null {
  const tokens = tokenizeJs(source);

  // Locate `createMachine(...)` call and parse its first object argument.
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind === "ident" && tokens[i].value === "createMachine") {
      let cursor = i + 1;
      // Optional generic `<...>` on createMachine<Ctx, Ev>(...)
      if (tokens[cursor]?.kind === "punct" && tokens[cursor].value === "<") {
        let depth = 0;
        while (cursor < tokens.length) {
          if (tokens[cursor].value === "<") depth++;
          else if (tokens[cursor].value === ">") {
            depth--;
            if (depth <= 0) {
              cursor++;
              break;
            }
          }
          cursor++;
        }
      }
      if (tokens[cursor]?.kind === "punct" && tokens[cursor].value === "(") {
        cursor++;
        if (tokens[cursor]?.kind === "punct" && tokens[cursor].value === "{") {
          const parsed = parseObjectExpressionAt(tokens, cursor);
          if (parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)) {
            return parsed.value as Record<string, unknown>;
          }
        }
      }
    }
  }

  // Fallback: top-level object literal `{ id: ..., states: ... }`
  const firstBrace = tokens.findIndex((t) => t.kind === "punct" && t.value === "{");
  if (firstBrace !== -1) {
    const parsed = parseObjectExpressionAt(tokens, firstBrace);
    if (parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)) {
      const obj = parsed.value as Record<string, unknown>;
      if ("states" in obj) return obj;
    }
  }

  return null;
}

function isMachineDocument(value: unknown): value is MachineDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    rec.version === 1 &&
    typeof rec.id === "string" &&
    typeof rec.name === "string" &&
    typeof rec.states === "object" &&
    rec.states !== null
  );
}

export function importMachineSource(source: string, fallbackName?: string): MachineDocument {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error("Cannot import empty source.");
  }

  // 1. Try direct JSON parse (Visualizer Document JSON or XState config JSON)
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isMachineDocument(parsed)) {
        return {
          ...parsed,
          context: parsed.context ?? {},
          notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        };
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "states" in parsed) {
        return fromXStateConfig(parsed as Record<string, unknown>, fallbackName);
      }
    } catch {
      // Fall through to JS/TS object-literal extraction (handles JS objects with single quotes/comments)
    }
  }

  // 2. Parse XState TypeScript / JavaScript code
  const extracted = extractMachineConfigFromCode(trimmed);
  if (extracted && "states" in extracted) {
    return fromXStateConfig(extracted, fallbackName);
  }

  throw new Error(
    "Could not parse machine source. Expected a Visualizer JSON document, XState JSON config, or XState createMachine({ ... }) code.",
  );
}

export { indent };
