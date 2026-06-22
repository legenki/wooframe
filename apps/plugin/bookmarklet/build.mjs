// Regenerates snapshot.bookmarklet.txt from snapshot.js.
// Run from the repo root: `node apps/plugin/bookmarklet/build.mjs`
//
// Bundles + minifies snapshot.js into a self-contained IIFE, appends a call to
// runSnapshot(), URL-encodes it, and writes the `javascript:` one-liner.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// esbuild lives in the pnpm store but isn't exposed as a root bin; resolve the
// module directly.
const esbuild = require(
  require.resolve("esbuild", {
    paths: [
      join(here, "../../../node_modules/.pnpm/esbuild@0.28.1/node_modules"),
    ],
  })
);

const result = await esbuild.build({
  entryPoints: [join(here, "snapshot.js")],
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "__woofigma",
  footer: { js: "__woofigma.runSnapshot();" },
  write: false,
});

const code = result.outputFiles[0].text;
const bookmarklet = `javascript:${encodeURIComponent(code)}\n`;
writeFileSync(join(here, "snapshot.bookmarklet.txt"), bookmarklet);
console.log(`Wrote snapshot.bookmarklet.txt (${bookmarklet.length} chars)`);
