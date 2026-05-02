# Project

`astro-slidev` — Vite plugin that lets Slidev slides use `.astro` components by rendering them through Astro's experimental Container API at module-load time, then exposing the result as a Vue component.

# Repo layout

pnpm workspace monorepo:

- `packages/astro-slidev/` — the published package (`src/index.ts`, `src/renderer.ts`)
- `playground/` — Slidev project that consumes the local package via `workspace:*`
- `README.md` is a symlink to `packages/astro-slidev/README.md` — edit the real file

# Commands

This repo uses **`vite-plus` (`vp`)**, not raw `vite`/`tsc`/`vitest`. Always go through `vp`:

- `vp run ready` — full check + build (run before declaring work done)
- `vp run --filter astro-slidev build` — build the package (`vp pack`)
- `vp run --filter astro-slidev dev` — watch-mode build (`vp pack --watch`)
- `vp run --filter astro-slidev check` — typecheck + lint (`vp check`)
- `vp run --filter playground dev` — run the Slidev playground to manually verify rendering

# Dependencies

- Install packages with `vp install` (do not invoke `pnpm install` / `pnpm add` directly).
- pnpm catalog is the source of truth for versions — bump in `pnpm-workspace.yaml` under `catalog:`, then reference as `"catalog:"` in `package.json`. Don't pin versions directly in package files.
- `catalogMode: prefer` is set; new deps should use the catalog.
- TypeScript is `@typescript/native-preview` (the Go-based `tsc`). Do not switch to stock `typescript` for typechecks — `vp check` wires this up.
- Node `>=22.12.0`, pnpm 10.x.

# Code style

- ES modules only (`"type": "module"`). Use `import`/`export`, never `require`.
- Use `.ts` extensions in relative imports (`allowImportingTsExtensions` is on).
- File and directory names under `packages/*/{src,tests}` **must be kebab-case** (`.ls-lint.yml` enforces this).
- Public API of `astro-slidev` is whatever `src/index.ts` exports — keep it minimal.

# Known limitations (don't "fix" these without discussion)

These are documented constraints of the Container API approach, not bugs:

- No client hydration of `client:*` islands.
- No framework renderer integrations (React/Vue/Svelte/Solid/Preact inside `.astro`).
- No prop pass-through from the Vue host to the `.astro` module.
- Astro Container API is upstream-experimental and may break on minor/patch bumps.

If a task touches one of these, surface it before changing behavior.

# Workflow

- Changesets: user-facing changes to `packages/astro-slidev` need a `.changeset/*.md` entry (`pnpm changeset`).
- `knip` is run separately in CI via `vpx knip` (not by `vp check`); if you add an entry point or intentionally-unused dep, update `knip.json` rather than silencing it elsewhere.
- After non-trivial changes, run `pnpm ready` and, for rendering changes, also `pnpm --filter playground dev` to eyeball a slide.
