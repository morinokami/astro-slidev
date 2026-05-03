import { transform } from "@astrojs/compiler";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformWithOxc } from "vite";

type AstroContainerModule = typeof import("astro/container");
type AstroContainer = Awaited<
  ReturnType<AstroContainerModule["experimental_AstroContainer"]["create"]>
>;

let containerPromise: Promise<AstroContainer> | undefined;

function getContainer(): Promise<AstroContainer> {
  if (!containerPromise) {
    containerPromise = (async () => {
      const mod = await import("astro/container");
      return await mod.experimental_AstroContainer.create();
    })();
  }
  return containerPromise;
}

let sessionCounter = 0;

// Astro's compiler emits side-effect imports back to the original `.astro`
// file with `?astro&type=style` etc. Those are normally intercepted by
// Astro's own Vite plugin; here we run the compiled module directly through
// Node's ESM loader, so we strip them and surface the CSS payloads via
// `result.css` instead.
const STRIP_SIDE_EFFECT_RE = /^\s*import\s+["'][^"']*\.astro\?[^"']*["'];?\s*$/gm;

// `import X from "./Foo.astro"` / `import { X } from "./Foo.astro"`
const FROM_ASTRO_RE = /(\bfrom\s*["'])([^"']+\.astro)(["'])/g;
// Bare `import "./Foo.astro";` (no `?` suffix — those are stripped above).
const SIDE_EFFECT_ASTRO_RE = /(^\s*import\s+["'])([^"']+\.astro)(["'])/gm;

function filenameFor(absPath: string): string {
  return `${createHash("sha1").update(absPath).digest("hex").slice(0, 16)}.mjs`;
}

export type ResolveAstro = (importPath: string, absPath: string) => Promise<string | null>;

interface RenderResult {
  html: string;
  /** CSS chunks per absolute `.astro` file path involved in this render. */
  cssByFile: Map<string, string[]>;
  /** All absolute `.astro` file paths involved (entry + transitive deps). */
  deps: Set<string>;
}

/**
 * Compile an entry `.astro` and its transitive `.astro` dependencies to JS
 * modules on disk, then dynamically import the entry and hand its default
 * export to the Astro Container API.
 *
 * Each render gets a fresh session directory under
 * `<project>/node_modules/.astro-slidev/` so Node's ESM cache is bypassed
 * across HMR reloads. Within a session, dep filenames are content-hash-free
 * (sha1 of the absolute path), which keeps cyclic imports resolvable.
 */
export async function renderAstroFile(
  entryAbsPath: string,
  entrySource: string,
  projectRoot: string,
  resolveAstro: ResolveAstro,
  props: Record<string, unknown> = {},
  sourceOverrides = new Map<string, string>(),
): Promise<RenderResult> {
  const sessionDir = join(
    projectRoot,
    "node_modules",
    ".astro-slidev",
    `s-${Date.now()}-${sessionCounter++}`,
  );
  await mkdir(sessionDir, { recursive: true });

  const cssByFile = new Map<string, string[]>();
  const deps = new Set<string>();
  const seen = new Set<string>();

  const compile = async (absPath: string, source: string): Promise<void> => {
    if (seen.has(absPath)) return;
    seen.add(absPath);
    deps.add(absPath);

    const result = await transform(source, {
      filename: absPath,
      sourcemap: false,
      internalURL: "astro/runtime/server/index.js",
      resolvePath: async (s) => s,
    });
    cssByFile.set(absPath, result.css ?? []);

    // Astro's compiler preserves frontmatter verbatim, so TS-only syntax
    // (`interface`, type annotations, `as` casts, etc.) survives into the
    // emitted module. Strip types via Vite's oxc transform before we hand
    // the module to Node's ESM loader.
    const stripped = await transformWithOxc(result.code, absPath, { lang: "ts" });
    let code = stripped.code.replace(STRIP_SIDE_EFFECT_RE, "");

    const astroImportPaths = new Set<string>();
    for (const m of code.matchAll(FROM_ASTRO_RE)) astroImportPaths.add(m[2]!);
    for (const m of code.matchAll(SIDE_EFFECT_ASTRO_RE)) astroImportPaths.add(m[2]!);

    const depEntries = await Promise.all(
      [...astroImportPaths].map(async (importPath) => {
        const depAbs = await resolveAstro(importPath, absPath);
        if (!depAbs) {
          throw new Error(
            `[astro-slidev] Failed to resolve ${JSON.stringify(importPath)} from ${absPath}`,
          );
        }
        return [importPath, depAbs] as const;
      }),
    );
    const importPathToFilename = new Map(
      depEntries.map(([importPath, depAbs]) => [importPath, filenameFor(depAbs)]),
    );

    const replaceImport = (
      match: string,
      prefix: string,
      importPath: string,
      closingQuote: string,
    ): string => {
      const filename = importPathToFilename.get(importPath);
      if (!filename) return match;
      return `${prefix}./${filename}${closingQuote}`;
    };
    code = code.replace(FROM_ASTRO_RE, replaceImport);
    code = code.replace(SIDE_EFFECT_ASTRO_RE, replaceImport);

    await writeFile(join(sessionDir, filenameFor(absPath)), code, "utf8");

    // Recurse into deps after writing this file. Cycles are safe because
    // `seen` is checked at entry, and dep filenames were already resolved
    // via `filenameFor` (deterministic from abs path).
    await Promise.all(
      depEntries.map(async ([, depAbs]) => {
        if (seen.has(depAbs)) return;
        const depSource = sourceOverrides.get(depAbs) ?? (await readFile(depAbs, "utf8"));
        await compile(depAbs, depSource);
      }),
    );
  };

  try {
    await compile(entryAbsPath, entrySource);
    const entryFile = join(sessionDir, filenameFor(entryAbsPath));
    const mod = await import(pathToFileURL(entryFile).href);
    const container = await getContainer();
    const html = await container.renderToString(mod.default, { props });
    return { html, cssByFile, deps };
  } finally {
    await rm(sessionDir, { recursive: true, force: true }).catch(() => {});
  }
}
