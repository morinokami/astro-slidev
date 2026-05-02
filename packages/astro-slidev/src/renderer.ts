import { transform } from "@astrojs/compiler";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

const cacheDirByProject = new Map<string, string>();

function getCacheDir(projectRoot: string): string {
  const cached = cacheDirByProject.get(projectRoot);
  if (cached) return cached;
  const dir = join(projectRoot, "node_modules", ".astro-slidev");
  cacheDirByProject.set(projectRoot, dir);
  return dir;
}

let counter = 0;

export interface RenderResult {
  html: string;
  /** Scoped CSS chunks emitted by Astro's compiler, already class-hashed. */
  css: string[];
}

/**
 * Compile an .astro source string into a JS module on disk, dynamically import it,
 * then hand the default export to the Astro Container API.
 *
 * The compiled module is written into `<project>/node_modules/.astro-slidev/`
 * so that bare-specifier imports (e.g. `astro/runtime/server/index.js`) resolve
 * through the project's normal node resolution.
 *
 * Astro's compiler emits side-effect imports back to the original `.astro`
 * file with `?astro&type=style` etc. (normally intercepted by Astro's Vite
 * plugin). We run the compiled module directly through Node's ESM loader, so
 * we strip those imports here and surface the actual CSS payloads via the
 * `css` field for the Vite plugin to register as virtual modules.
 */
export async function renderAstroFile(
  absPath: string,
  source: string,
  projectRoot: string,
  props: Record<string, unknown> = {},
): Promise<RenderResult> {
  const result = await transform(source, {
    filename: absPath,
    sourcemap: false,
    internalURL: "astro/runtime/server/index.js",
    resolvePath: async (specifier) => specifier,
  });

  const code = result.code.replace(/^\s*import\s+["'][^"']*\.astro\?[^"']*["'];?\s*$/gm, "");

  const cacheDir = getCacheDir(projectRoot);
  await mkdir(cacheDir, { recursive: true });
  const tmpFile = join(cacheDir, `astro-${Date.now()}-${counter++}.mjs`);
  await writeFile(tmpFile, code, "utf8");

  try {
    const mod = await import(pathToFileURL(tmpFile).href);
    const container = await getContainer();
    const html = await container.renderToString(mod.default, { props });
    return { html, css: result.css ?? [] };
  } finally {
    await rm(tmpFile, { force: true }).catch(() => {});
  }
}
