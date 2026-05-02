---
theme: seriph
title: astro-slidev playground
info: |
  ## astro-slidev playground
  A demo deck for the `astro-slidev` integration.
comark: true
background: https://cover.sli.dev
class: text-center
---

# astro-slidev playground

A demo deck for the `astro-slidev` integration.

---

# Astro components

The block below is a `.astro` file rendered through Astro's Container API and surfaced as a Vue component by `astro-slidev`.

<Hello />

---

# Nested `.astro` imports

`Nested.astro` imports `Card.astro`, which itself imports `Badge.astro`. Each file's scoped styles are emitted independently through Vite.

<Nested />
