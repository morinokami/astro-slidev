# astro-slidev

Use [Astro](https://astro.build/) components inside [Slidev](https://sli.dev/) slides, via the experimental [Astro Container API](https://docs.astro.build/en/reference/container-reference/).

`.astro` files are rendered to static HTML at module-load time and surfaced as Vue components, so they can be referenced from a slide just like any other component.

## Install

```sh
pnpm add -D astro-slidev astro
```

`astro` is a peer dependency. `vue` and `vite` are also peers and are normally already provided by Slidev.

## Setup

Register the Vite plugin via Slidev's [`setup/vite-plugins.ts`](https://sli.dev/custom/config-vite):

```ts
// setup/vite-plugins.ts
import { defineVitePluginsSetup } from "@slidev/types";
import astroSlidev from "astro-slidev";

export default defineVitePluginsSetup(() => [astroSlidev()]);
```

To let Slidev auto-import `.astro` files placed in `./components/`, extend its component options in `vite.config.ts`:

```ts
// vite.config.ts
export default {
  slidev: {
    components: {
      extensions: ["vue", "md", "js", "ts", "jsx", "tsx", "astro"],
      include: [/\.vue$/, /\.vue\?vue/, /\.vue\?v=/, /\.md$/, /\.md\?vue/, /\.astro$/],
    },
  },
};
```

Place a `.astro` file under `./components/` and reference it from a slide by its filename:

```md
# Slide

<MyComponent />
```

## What works

- Frontmatter scripts and expression interpolation (`{value}`, `.map(...)` in markup)
- Scoped `<style>` blocks — emitted CSS chunks are routed through Vite's CSS pipeline and participate in HMR
- HMR on `.astro` source changes

## Limitations

- **No client hydration.** `client:load` / `client:idle` / `client:visible` islands appear in the rendered HTML as `<astro-island>` custom elements, but the Astro client runtime is not loaded, so they never hydrate.
- **No framework integrations.** Renderers for React / Vue / Svelte / Solid / Preact islands are not registered on the container. Components that depend on them will fail to render.
- **No prop pass-through from Vue.** A `.astro` file is rendered once at module-load time with empty props; props supplied by the Vue host are ignored. Frontmatter constants and Astro-side defaults work as usual.
- **No relative `.astro` imports.** A `.astro` file importing another `.astro` (e.g. `import Card from "./Card.astro"`) is not currently resolved, because the compiled module is loaded from a cache directory rather than from the original location.
- **Container API is experimental upstream** and may break across Astro minor/patch releases.

## How it works

1. `@astrojs/compiler` transforms the `.astro` source to a JS module.
2. The module is written into `node_modules/.astro-slidev/` and dynamically imported, so its bare-specifier imports (`astro/runtime/server/index.js` etc.) resolve through the project's normal node resolution.
3. `experimental_AstroContainer.renderToString` produces an HTML string.
4. The plugin emits a Vue component that renders that HTML via `innerHTML`.
5. Scoped CSS chunks reported by the compiler are exposed as virtual `.css` modules and side-effect-imported from the generated component.
