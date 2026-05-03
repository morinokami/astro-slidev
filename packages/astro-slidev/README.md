# astro-slidev

Use [Astro](https://astro.build/) components inside [Slidev](https://sli.dev/) slides, via the experimental [Astro Container API](https://docs.astro.build/en/reference/container-reference/).

`.astro` files are rendered to static HTML at module-load time and surfaced as Vue components, so they can be referenced from a slide just like any other component.

## Install

```sh
pnpm add astro-slidev astro
```

`astro` is a peer dependency. `vue` and `vite` are also peers and are normally already provided by Slidev.

## Setup

Register the Vite plugin in [`vite.config.ts`](https://sli.dev/custom/config-vite):

```ts
import { defineConfig } from "vite";
import astroSlidev from "astro-slidev";

export default defineConfig({
  // `slidev` is a Slidev-specific Vite config extension.
  // @ts-expect-error Vite's base config type does not know about it.
  slidev: {
    components: {
      extensions: ["vue", "astro"],
    },
  },
  plugins: [astroSlidev()],
});
```

Place a `.astro` file under `./components/` and reference it from a slide by its filename:

```md
# Slide

<MyComponent />
```

## What works

- Frontmatter scripts and expression interpolation (`{value}`, `.map(...)` in markup)
- TypeScript syntax in the frontmatter (`interface`, type annotations, `as` casts) — types are stripped via Vite's oxc transform before the module is loaded
- Scoped `<style>` blocks — emitted CSS chunks are routed through Vite's CSS pipeline and participate in HMR
- HMR on `.astro` source changes (including transitive `.astro` deps)
- `.astro` importing another `.astro` (e.g. `import Card from "./Card.astro"`), with paths resolved through Vite's resolver (so aliases / tsconfig paths work)

## Limitations

- **No framework integrations.** Renderers for React / Vue / Svelte / Solid / Preact islands are not registered on the container, so components that depend on them fail to render. By extension, `client:load` / `client:idle` / `client:visible` directives — which only apply to framework islands — aren't usable either.
- **No prop pass-through from slides.** A `.astro` file is rendered once at module-load time with empty props, so attributes written on the component tag in a slide (e.g. `<Greeting name="World" />`) don't reach `Astro.props`. Frontmatter constants and Astro-side defaults work as usual.
- **Container API is experimental upstream** and may break across Astro minor/patch releases.

## How it works

1. `@astrojs/compiler` transforms the entry `.astro` (and its transitive `.astro` deps, resolved via Vite) to JS modules.
2. Each module is run through Vite's oxc transform to strip TypeScript syntax (the Astro compiler preserves frontmatter verbatim, so `interface` / type annotations would otherwise reach Node's ESM loader as-is).
3. Each module is written into a per-render session directory under `node_modules/.astro-slidev/` with `.astro → .astro` imports rewritten to sibling `.mjs` files, then the entry is dynamically imported. Bare-specifier imports (`astro/runtime/server/index.js` etc.) resolve through the project's normal node resolution.
4. `experimental_AstroContainer.renderToString` produces an HTML string.
5. The plugin emits a Vue component that renders that HTML via `innerHTML`.
6. Scoped CSS chunks reported by the compiler — across the entry and its deps — are exposed as virtual `.css` modules and side-effect-imported from the generated component.
7. Dep `.astro` files are registered with `addWatchFile`, so editing a child `.astro` invalidates the entry and triggers HMR.
