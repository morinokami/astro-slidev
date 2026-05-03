import type { ModuleNode, Plugin, PluginContainer } from "vite";

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { renderAstroFile, type ResolveAstro } from "./renderer.ts";

export interface AstroSlidevOptions {}

const ASTRO_RE = /\.astro(?:\?|$)/;
const VIRTUAL_CSS_PREFIX = "\0astro-slidev-css:";
const VIRTUAL_CSS_RE = new RegExp(`^${VIRTUAL_CSS_PREFIX}(.+):(\\d+)\\.css$`);

type ResolveIdResult = Awaited<ReturnType<PluginContainer["resolveId"]>>;
type ResolveId = (importPath: string, importer: string) => Promise<ResolveIdResult>;

interface EntryRender {
  deps: Set<string>;
  flatCss: string[];
  html: string;
  source: string;
}

/**
 * Vite plugin: turns `*.astro` imports into a Vue component whose template is
 * the static HTML rendered by Astro's Container API at module-load time.
 *
 * Limitations:
 * - No client hydration: `client:*` islands render as static HTML only.
 * - No reactive props from Vue side: rendered with empty props. Author-side
 *   props (defined inside the .astro frontmatter) work as usual.
 */
export default function astroSlidev(_options: AstroSlidevOptions = {}): Plugin {
  let projectRoot: string;

  // Per-entry cache of the last render, keyed by absolute entry `.astro` path.
  // Refilled on every load/HMR pass, read by the virtual-CSS load handler.
  const renderByEntry = new Map<string, EntryRender>();
  const depsByEntry = new Map<string, Set<string>>();
  const entriesByDep = new Map<string, Set<string>>();
  const renderQueues = new Map<string, Promise<EntryRender>>();
  const preparedLoadByEntry = new Map<string, EntryRender>();

  const updateDepIndexes = (entryAbsPath: string, deps: Set<string>) => {
    const previousDeps = depsByEntry.get(entryAbsPath) ?? new Set<string>();
    for (const dep of previousDeps) {
      const entries = entriesByDep.get(dep);
      entries?.delete(entryAbsPath);
      if (entries?.size === 0) entriesByDep.delete(dep);
    }
    depsByEntry.set(entryAbsPath, deps);
    for (const dep of deps) {
      const entries = entriesByDep.get(dep) ?? new Set<string>();
      entries.add(entryAbsPath);
      entriesByDep.set(dep, entries);
    }
  };

  const renderEntry = async (
    entryAbsPath: string,
    source: string,
    resolveAstro: ResolveAstro,
    sourceOverrides?: Map<string, string>,
  ): Promise<EntryRender> => {
    const { html, cssByFile, deps } = await renderAstroFile(
      entryAbsPath,
      source,
      projectRoot,
      resolveAstro,
      {},
      sourceOverrides,
    );

    // Flatten CSS in deterministic order (entry first, then deps sorted)
    // so virtual CSS module IDs stay stable across renders.
    const orderedFiles = [entryAbsPath, ...[...deps].filter((d) => d !== entryAbsPath).sort()];
    const flatCss: string[] = [];
    for (const file of orderedFiles) {
      const chunks = cssByFile.get(file) ?? [];
      flatCss.push(...chunks);
    }

    const entryRender = { deps, flatCss, html, source };
    renderByEntry.set(entryAbsPath, entryRender);
    updateDepIndexes(entryAbsPath, deps);

    return entryRender;
  };

  const queueRenderEntry = (
    entryAbsPath: string,
    source: string,
    resolveAstro: ResolveAstro,
    sourceOverrides?: Map<string, string>,
  ) => {
    const previousRender = renderQueues.get(entryAbsPath) ?? Promise.resolve();
    const queuedRender = previousRender
      .catch(() => {})
      .then(() => renderEntry(entryAbsPath, source, resolveAstro, sourceOverrides));
    renderQueues.set(entryAbsPath, queuedRender);

    return queuedRender.finally(() => {
      if (renderQueues.get(entryAbsPath) === queuedRender) {
        renderQueues.delete(entryAbsPath);
      }
    });
  };

  const createResolveAstro = (resolveId: ResolveId) => {
    const resolveAstro: ResolveAstro = async (importPath, absPath) => {
      const resolved = await resolveId(importPath, absPath);
      if (!resolved) return null;
      return resolved.id.split("?")[0] ?? null;
    };
    return resolveAstro;
  };

  const renderComponentCode = (entryAbsPath: string, html: string, flatCss: string[]) => {
    const componentName = `Astro_${basename(entryAbsPath).replace(/\W+/g, "_")}`;
    const escaped = JSON.stringify(html);

    const cssImports = flatCss
      .map((_, i) => `import ${JSON.stringify(`${VIRTUAL_CSS_PREFIX}${entryAbsPath}:${i}.css`)};`)
      .join("\n");

    return [
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
    ].join("\n");
  };

  const areDepsEqual = (a: Set<string> | undefined, b: Set<string>) => {
    if (!a || a.size !== b.size) return false;
    for (const dep of a) {
      if (!b.has(dep)) return false;
    }
    return true;
  };

  return {
    name: "astro-slidev",
    enforce: "pre",
    configResolved(config) {
      projectRoot = config.root;
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
        const chunks = renderByEntry.get(file!)?.flatCss;
        const idx = Number(idxStr);
        return { code: chunks?.[idx] ?? "", map: null };
      }

      const cleanId = id.split("?")[0]!;
      if (!ASTRO_RE.test(id)) return null;
      const source = await readFile(cleanId, "utf8");

      const prepared = preparedLoadByEntry.get(cleanId);
      const entryRender =
        prepared?.source === source
          ? prepared
          : await queueRenderEntry(
              cleanId,
              source,
              createResolveAstro((importPath, importer) => this.resolve(importPath, importer)),
            );
      preparedLoadByEntry.delete(cleanId);

      // Tell Vite/Rolldown about the dep tree so edits invalidate this module.
      for (const dep of entryRender.deps) {
        if (dep !== cleanId) this.addWatchFile(dep);
      }

      return {
        code: renderComponentCode(cleanId, entryRender.html, entryRender.flatCss),
        map: null,
      };
    },
    async handleHotUpdate(ctx) {
      const cleanFile = ctx.file.split("?")[0]!;
      if (!ASTRO_RE.test(cleanFile)) return;

      const changedSource = await ctx.read();
      const sourceOverrides = new Map([[cleanFile, changedSource]]);
      const affectedEntries = [...(entriesByDep.get(cleanFile) ?? new Set([cleanFile]))];
      const modules = new Set<ModuleNode>();

      for (const entry of affectedEntries) {
        const previousRender = renderByEntry.get(entry);
        const previousCssCount = previousRender?.flatCss.length ?? 0;
        const source = entry === cleanFile ? changedSource : await readFile(entry, "utf8");
        const entryRender = await queueRenderEntry(
          entry,
          source,
          createResolveAstro((importPath, importer) =>
            ctx.server.pluginContainer.resolveId(importPath, importer),
          ),
          sourceOverrides,
        );

        const shouldUpdateEntry =
          !previousRender ||
          previousRender.html !== entryRender.html ||
          previousCssCount !== entryRender.flatCss.length ||
          !areDepsEqual(previousRender.deps, entryRender.deps);
        const entryModule = ctx.server.moduleGraph.getModuleById(entry);
        if (shouldUpdateEntry && entryModule) {
          preparedLoadByEntry.set(entry, entryRender);
          ctx.server.moduleGraph.invalidateModule(entryModule);
          modules.add(entryModule);
        }

        const cssCount = Math.max(previousCssCount, entryRender.flatCss.length);
        for (let i = 0; i < cssCount; i++) {
          const cssModule = ctx.server.moduleGraph.getModuleById(
            `${VIRTUAL_CSS_PREFIX}${entry}:${i}.css`,
          );
          if (cssModule) {
            ctx.server.moduleGraph.invalidateModule(cssModule);
            modules.add(cssModule);
          }
        }
      }

      return [...modules];
    },
  };
}
