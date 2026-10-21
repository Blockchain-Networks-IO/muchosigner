/**
 * Opciones de esbuild del paquete de MuchoSigner, en UN sitio: las usan
 * `build-muchosigner.ts` (el fichero que se publica) y
 * `client/src/muchosigner/paquete.test.ts` (que vigila qué entra en él). Si el
 * test empaquetara con otras opciones, podría dar por bueno un paquete que no
 * es el que se publica.
 */
import type { BuildOptions } from "esbuild";
import { realpathSync } from "fs";
import { createRequire } from "module";
import { join, resolve } from "path";

export function muchosignerBuildOptions(root: string): BuildOptions & { write: false; metafile: true } {
  // El códec del QR de la bóveda (`@keystonehq/bc-ur-registry` → cipher-base)
  // usa `stream`, `events`… de Node. En la app los pone vite-plugin-node-polyfills;
  // aquí se usan los MISMOS sustitutos (node-stdlib-browser, su dependencia).
  const polyfillsDir = realpathSync(resolve(root, "node_modules/vite-plugin-node-polyfills"));
  const stdlib = createRequire(join(polyfillsDir, "package.json"))("node-stdlib-browser") as Record<string, string>;
  const nodeAliases = Object.fromEntries(
    ["buffer", "events", "process", "stream", "string_decoder", "util"].map(m => [m, stdlib[m]]),
  );

  return {
    entryPoints: [resolve(root, "client/src/muchosigner/standalone.ts")],
    inject: [resolve(root, "client/src/muchosigner/nodeShim.ts")],
    bundle: true,
    write: false,
    metafile: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    minify: true,
    legalComments: "none",
    alias: { "@shared": resolve(root, "shared"), "@": resolve(root, "client/src"), ...nodeAliases },
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.browser": "true",
      "process.version": JSON.stringify("v22.0.0"),
      "import.meta.env": "{}",
      global: "globalThis",
    },
  };
}
