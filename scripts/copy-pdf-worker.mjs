// Copies pdf.js's worker into public/ so the browser can load it from the
// same origin (/pdf.worker.min.mjs). Runs automatically before `next build`
// (npm "prebuild"); the copy is git-ignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const src = join(dirname(require.resolve("pdfjs-dist/package.json")), "build", "pdf.worker.min.mjs");
mkdirSync("public", { recursive: true });
copyFileSync(src, join("public", "pdf.worker.min.mjs"));
console.log("[esign] copied pdf.js worker to public/pdf.worker.min.mjs");
