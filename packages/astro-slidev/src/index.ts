import type { Plugin } from "vite";

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { renderAstroFile, type ResolveAstro } from "./renderer.ts";

export interface AstroSlidevOptions {
  /**
   * Project root used to locate `node_modules/` for the Astro runtime.
   * Defaults to Vite's resolved root.
   */
  root?: string;
}

const ASTRO_RE = /\.astro(?:\?|$)/;
const VIRTUAL_CSS_PREFIX = "\0astro-slidev-css:";
const VIRTUAL_CSS_RE = new RegExp(`^${VIRTUAL_CSS_PREFIX}(.+):(\\d+)\\.css$`);

/**
 * Vite plugin: turns `*.astro` imports into a Vue component whose template is
 * the static HTML rendered by Astro's Container API at module-load time.
 *
 * `.astro → .astro` imports are supported: dependency files are compiled
 * recursively into a per-render session directory under
 * `node_modules/.astro-slidev/` and dep paths are resolved through Vite's
 * own resolver (so aliases / tsconfig paths flow through). Each dep is
 * registered with `addWatchFile` so dep edits invalidate the entry's HMR.
 *
 * Scoped `<style>` blocks across the entry and its deps are flattened and
 * surfaced as virtual CSS modules side-effect-imported by the generated
 * Vue component, so Vite's CSS pipeline (and HMR) handles them.
 *
 * Limitations:
 * - No client hydration: `client:*` islands render as static HTML only.
 * - No reactive props from Vue side: rendered with empty props. Author-side
 *   props (defined inside the .astro frontmatter) work as usual.
 */
export default function astroSlidev(options: AstroSlidevOptions = {}): Plugin {
  let projectRoot: string;

  // Per-entry cache of last-rendered (flattened) CSS chunks, keyed by absolute
  // entry `.astro` path. Refilled on every load, read by the virtual-CSS
  // load handler.
  const cssByEntry = new Map<string, string[]>();

  return {
    name: "astro-slidev",
    enforce: "pre",
    configResolved(config) {
      projectRoot = options.root ?? config.root;
    },
    async resolveId(source, importer) {
      if (source.startsWith(VIRTUAL_CSS_PREFIX)) return source;
      if (!ASTRO_RE.test(source)) return null;
      if (source.startsWith(".") && importer) {
        const path = await import("node:path");
        return path.resolve(path.dirname(importer), source);
      }
      return null;
    },
    async load(id) {
      const cssMatch = id.match(VIRTUAL_CSS_RE);
      if (cssMatch) {
        const [, file, idxStr] = cssMatch;
        const chunks = cssByEntry.get(file!);
        const idx = Number(idxStr);
        return { code: chunks?.[idx] ?? "", map: null };
      }

      const cleanId = id.split("?")[0]!;
      if (!ASTRO_RE.test(id)) return null;
      const source = await readFile(cleanId, "utf8");

      const resolveAstro: ResolveAstro = async (importPath, absPath) => {
        const resolved = await this.resolve(importPath, absPath);
        if (!resolved) return null;
        return resolved.id.split("?")[0] ?? null;
      };

      const { html, cssByFile, deps } = await renderAstroFile(
        cleanId,
        source,
        projectRoot,
        resolveAstro,
      );

      // Tell Vite/Rolldown about the dep tree so edits invalidate this module.
      for (const dep of deps) {
        if (dep !== cleanId) this.addWatchFile(dep);
      }

      // Flatten CSS in deterministic order (entry first, then deps sorted)
      // so virtual CSS module IDs stay stable across renders.
      const orderedFiles = [cleanId, ...[...deps].filter((d) => d !== cleanId).sort()];
      const flatCss: string[] = [];
      for (const file of orderedFiles) {
        const chunks = cssByFile.get(file) ?? [];
        flatCss.push(...chunks);
      }
      cssByEntry.set(cleanId, flatCss);

      const componentName = `Astro_${basename(cleanId).replace(/\W+/g, "_")}`;
      const escaped = JSON.stringify(html);

      const cssImports = flatCss
        .map((_, i) => `import ${JSON.stringify(`${VIRTUAL_CSS_PREFIX}${cleanId}:${i}.css`)};`)
        .join("\n");

      return {
        code: [
          `import { defineComponent, h } from "vue";`,
          cssImports,
          `const __html__ = ${escaped};`,
          `export default defineComponent({`,
          `  name: ${JSON.stringify(componentName)},`,
          `  render() {`,
          `    return h("div", { class: "astro-slidev", innerHTML: __html__ });`,
          `  },`,
          `});`,
          ``,
        ].join("\n"),
        map: null,
      };
    },
    handleHotUpdate(ctx) {
      if (ASTRO_RE.test(ctx.file)) {
        return ctx.modules;
      }
    },
  };
}
