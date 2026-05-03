---
theme: seriph
title: astro-slidev
info: |
  Use Astro components inside Slidev slides, via Astro's experimental Container API.
comark: true
class: text-left
---

# astro-slidev

A Vite plugin for using `.astro` components in Slidev decks

---

# Demo

This block is rendered from an Astro component.

<div class="mt-6">
  <Hello />
</div>

---

# Install

```sh
pnpm add astro-slidev astro
```

<div class="h-8"></div>

## Configuration

<div class="h-4"></div>

```ts
// vite.config.ts
import { defineConfig } from "vite";
import astroSlidev from "astro-slidev";

export default defineConfig({
  slidev: {
    components: {
      extensions: ["vue", "astro"], // this tells Slidev to scan `.astro` files in `components/`
    },
  },
  plugins: [astroSlidev()],
});
```

---

# What works

<div class="grid grid-cols-2 gap-x-10 gap-y-5 mt-8">
  <div>
    <h3>Astro syntax</h3>
    <p>Build slide sections with the Astro syntax you already use for static UI.</p>
  </div>
  <div>
    <h3>TypeScript</h3>
    <p>Keep typed frontmatter in your components without changing how your deck is authored.</p>
  </div>
  <div>
    <h3>Scoped styles</h3>
    <p>Package each visual block with its own styles instead of spreading slide CSS around.</p>
  </div>
  <div>
    <h3>HMR</h3>
    <p>Edit an Astro component and see the slide update during deck development.</p>
  </div>
</div>

---

# Limitations

<div class="mt-8 grid grid-cols-2 gap-6">
  <div>
    <h3>No framework renderers</h3>
    <p>React, Vue, Svelte, and similar components cannot be rendered inside `.astro` files. Hydration directives like <code>client:load</code> do not run either.</p>
  </div>
  <div>
    <h3>No slide props</h3>
    <p>Slidev-side attributes like <code>&lt;Greeting name="World" /&gt;</code> do not reach <code>Astro.props</code>.</p>
  </div>
</div>

---

<div class="h-full grid place-content-center text-center">
  <h1>Try it</h1>

  <div class="mt-8 text-xl">
    <a href="https://github.com/morinokami/astro-slidev">github.com/morinokami/astro-slidev</a>
  </div>
</div>
