import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

/**
 * Architectural guard for the shared OmniPOS core.
 *
 * These directories must run unchanged under React Native and in a browser, so
 * they may not import platform packages directly — they reach the host through
 * `src/core/platform`. Without this test the boundary erodes silently: the app
 * keeps building on device, and the breakage only surfaces when the web client
 * is compiled.
 *
 * To use a new host capability, extend the PlatformAdapter interface and
 * implement it in each adapter rather than adding an exception here.
 */
const SHARED_ROOTS = [
  "src/core",
  "src/database",
  "src/sync",
  "src/store",
  "src/features",
  "src/utils",
  "src/services",
];

/** Files that are legitimately platform-bound and are never shipped to the web client. */
const ALLOWED = new Set([
  // The adapters themselves — the single sanctioned home for platform imports.
  "src/core/platform/native.ts",
  "src/core/platform/web.ts",
  // Hardware and OS integrations; the web client provides its own equivalents.
  "src/features/printer/service.ts",
  "src/features/printer/hooks.ts",
  "src/features/printer/buildReceiptJob.ts",
  "src/features/printer/types.ts",
  "src/utils/receiptPdf.ts",
  "src/utils/scannerAudio.ts",
  "src/services/printer.ts",
  // Uploads read from the device filesystem. The web client will supply its own
  // implementation behind the same exported function names.
  "src/services/storage.ts",
  // Same reason, for the Laravel backend: streaming a file straight from a
  // device URI is inherently native. A browser uploads a File from an input,
  // which is a different mechanism, not the same one behind an adapter — so
  // this is a platform implementation rather than a boundary violation.
  "src/services/laravelStorage.ts",
]);

const FORBIDDEN = [
  /^react-native$/,
  /^react-native\//,
  /^@react-native(-community)?\//,
  /^expo(-|$)/,
  /^@expo\//,
];

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;
const REQUIRE_RE = /require\(\s*["']([^"']+)["']\s*\)/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function specifiersIn(source: string): string[] {
  const found: string[] = [];
  for (const re of [IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) found.push(m[1]);
  }
  return found;
}

describe("shared core platform boundary", () => {
  const root = process.cwd();

  const offenders: string[] = [];
  for (const sharedRoot of SHARED_ROOTS) {
    for (const file of walk(join(root, sharedRoot))) {
      const rel = relative(root, file).split(sep).join(posix.sep);
      if (ALLOWED.has(rel)) continue;
      for (const spec of specifiersIn(readFileSync(file, "utf8"))) {
        if (FORBIDDEN.some((re) => re.test(spec))) {
          offenders.push(`${rel} imports "${spec}"`);
        }
      }
    }
  }

  it("has no direct platform imports outside the sanctioned adapters", () => {
    expect(offenders).toEqual([]);
  });

  it("still covers a non-trivial number of files", () => {
    const scanned = SHARED_ROOTS.reduce((n, r) => n + walk(join(root, r)).length, 0);
    // Guards against the walker silently matching nothing and the test passing vacuously.
    expect(scanned).toBeGreaterThan(50);
  });
});
