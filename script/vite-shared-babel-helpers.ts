/**
 * Vite plugin: recharts' inlined Babel helpers, emitted once instead of once
 * per file.
 *
 * recharts publishes its ES build (`recharts/es6/**`) with Babel's helpers
 * inlined at the top of EVERY file that needs them — `_defineProperty`,
 * `_objectSpread`/`ownKeys`, `_extends`, `_objectWithoutProperties`, the
 * `_slicedToArray` family and `_taggedTemplateLiteral`. Measured 2026-11-08
 * (recharts 3.10.1): 103 of the bundled files carry 678 helper declarations
 * between them, and every helper NAME has exactly ONE text across the whole
 * package — the same function, copied ~50 times into vendor-charts.
 *
 * This plugin removes those byte-identical copies and imports the one shared
 * definition from a virtual module instead. It changes no behaviour:
 *   · a helper is only ever removed when its line is character-for-character
 *     the single text that name has across the scanned package;
 *   · a file is rewritten only when EVERY helper line in it qualifies and no
 *     helper name is declared a second way in it — otherwise it is left as
 *     published, so a helper can never resolve to a different body than the
 *     one the file shipped with;
 *   · the helpers are pure functions of their arguments and of each other
 *     (the shared module holds the same set, so their cross-references bind
 *     to identical bodies). `_extends` memoises itself on first call; shared,
 *     it memoises once instead of once per file — same result.
 * Function declarations and import bindings are both initialised before any
 * module code runs, so moving the declaration out of the file does not
 * change when it becomes callable.
 *
 * Removed lines are blanked, not deleted, and the import is appended at the
 * end of the file, so every remaining line keeps its line and column — the
 * transform returns `map: null` (Rollup keeps the incoming mapping) and the
 * hidden production source maps Sentry uses stay correct.
 *
 * tests/unit/rechartsSharedBabelHelpers.test.ts pins the scan floor, the
 * equivalence rules and the refusal cases.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

/** A top-level, single-line Babel helper declaration as Babel emits it. */
export const HELPER_LINE = /^function (_[A-Za-z0-9]+|ownKeys)\(.*\}\s*$/;
export const SHARED_HELPERS_ID = "\0acreos-recharts-babel-helpers";

export interface HelperTable {
  /** helper name -> its single text across the package */
  texts: Map<string, string>;
  /** helper names seen with more than one text — never shared */
  ambiguous: Set<string>;
  filesScanned: number;
  filesWithHelpers: number;
  helperLines: number;
}

/** Read every .js file under `root` and record each helper name's text(s). */
export function scanHelperTable(root: string): HelperTable {
  const seen = new Map<string, Set<string>>();
  let filesScanned = 0;
  let filesWithHelpers = 0;
  let helperLines = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
      filesScanned++;
      let any = false;
      for (const line of fs.readFileSync(full, "utf8").split("\n")) {
        const m = HELPER_LINE.exec(line);
        if (!m) continue;
        any = true;
        helperLines++;
        let texts = seen.get(m[1]);
        if (!texts) seen.set(m[1], (texts = new Set()));
        texts.add(line);
      }
      if (any) filesWithHelpers++;
    }
  }
  const texts = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [name, set] of seen) {
    if (set.size === 1) texts.set(name, [...set][0]);
    else ambiguous.add(name);
  }
  return { texts, ambiguous, filesScanned, filesWithHelpers, helperLines };
}

export type DedupeResult =
  | { kind: "none" }
  | { kind: "refused"; reason: string }
  | { kind: "rewritten"; code: string; names: string[] };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rewrite one module's helper declarations into a shared import, or refuse. */
export function dedupeModuleHelpers(code: string, table: HelperTable): DedupeResult {
  const lines = code.split("\n");
  const names: string[] = [];
  const at: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HELPER_LINE.exec(lines[i]);
    if (!m) continue;
    const name = m[1];
    if (table.ambiguous.has(name)) return { kind: "refused", reason: `${name} has more than one text in the package` };
    if (table.texts.get(name) !== lines[i]) return { kind: "refused", reason: `${name} differs from the package's single text` };
    if (names.includes(name)) return { kind: "refused", reason: `${name} is declared twice` };
    names.push(name);
    at.push(i);
  }
  if (names.length === 0) return { kind: "none" };
  for (const i of at) lines[i] = "";
  const rest = lines.join("\n");
  for (const name of names) {
    // Any other binding of the same name would collide with the import.
    const other = new RegExp(`(?:\\bfunction\\s+|\\b(?:var|let|const|class)\\s+)${escapeRe(name)}\\b`);
    if (other.test(rest)) return { kind: "refused", reason: `${name} is bound again elsewhere in the module` };
  }
  return { kind: "rewritten", code: `${rest}\nimport { ${names.join(", ")} } from ${JSON.stringify(SHARED_HELPERS_ID)};\n`, names };
}

/** The shared module: every unambiguous helper, once, exported by name. */
export function sharedHelpersModule(table: HelperTable): string {
  const names = [...table.texts.keys()].sort();
  return `${names.map((n) => table.texts.get(n)).join("\n")}\nexport { ${names.join(", ")} };\n`;
}

export function rechartsSharedBabelHelpersPlugin(): Plugin {
  let root = "";
  let table: HelperTable | null = null;
  let rewritten = 0;
  let removedLines = 0;
  const refused: string[] = [];
  return {
    name: "acreos-recharts-shared-babel-helpers",
    apply: "build",
    enforce: "pre",
    buildStart() {
      const require = createRequire(import.meta.url);
      root = fs.realpathSync(path.join(path.dirname(require.resolve("recharts/package.json")), "es6"));
      table = scanHelperTable(root);
      rewritten = 0;
      removedLines = 0;
      refused.length = 0;
    },
    resolveId(source) {
      return source === SHARED_HELPERS_ID ? SHARED_HELPERS_ID : null;
    },
    load(id) {
      return id === SHARED_HELPERS_ID && table ? sharedHelpersModule(table) : null;
    },
    transform(code, id) {
      if (!table) return null;
      const file = id.split("?")[0];
      if (!file.endsWith(".js")) return null;
      let real = file;
      try {
        real = fs.realpathSync(file);
      } catch {
        return null;
      }
      if (!real.startsWith(root + path.sep)) return null;
      const result = dedupeModuleHelpers(code, table);
      if (result.kind === "refused") {
        refused.push(`${path.relative(root, real)}: ${result.reason}`);
        return null;
      }
      if (result.kind === "none") return null;
      rewritten++;
      removedLines += result.names.length;
      return { code: result.code, map: null };
    },
    buildEnd() {
      if (!table) return;
      // Printed on every build: a rewrite count of 0 after a recharts upgrade
      // means the package changed shape and the saving silently disappeared.
      this.info(
        `recharts Babel helpers: ${removedLines} inlined copies removed from ${rewritten} modules ` +
          `(${table.texts.size} shared helpers; package scan ${table.filesWithHelpers}/${table.filesScanned} files)`,
      );
      for (const r of refused) this.warn(`recharts Babel helpers left inline in ${r}`);
    },
  };
}
