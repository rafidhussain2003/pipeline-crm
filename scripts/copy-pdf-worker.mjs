// Copies pdf.js's worker into public/ so the browser can load it from the
// same origin (/pdf.worker.min.mjs). Runs on `postinstall` and before
// `next build` (npm "prebuild"); the copy is git-ignored.
//
// NEVER fails the install/build: if pdfjs-dist isn't resolvable yet (e.g. a
// production-only install, or an odd install order) it warns and exits 0 —
// the Docusign viewer then reports "Could not load the document" instead of
// the whole deploy failing.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
try {
  const require = createRequire(import.meta.url);
  let dir;
  try {
    dir = dirname(require.resolve("pdfjs-dist/package.json"));
  } catch {
    // Some package "exports" maps hide package.json; fall back to the main entry.
    dir = dirname(require.resolve("pdfjs-dist")).replace(/[\\/]build$/, "");
  }
  const src = join(dir, "build", "pdf.worker.min.mjs");
  if (!existsSync(src)) throw new Error(`worker not found at ${src}`);
  mkdirSync("public", { recursive: true });
  copyFileSync(src, join("public", "pdf.worker.min.mjs"));
  console.log("[docusign] copied pdf.js worker to public/pdf.worker.min.mjs");
} catch (err) {
  console.warn(`[docusign] could not copy the pdf.js worker (${err instanceof Error ? err.message : err}) — continuing`);
}
