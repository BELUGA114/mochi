# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static blog built from the [Fuwari](https://github.com/saicaca/fuwari) Astro template. The working tree is
currently the unmodified template (single "Initial commit"), so `README.md`, `src/config.ts`,
`astro.config.mjs`, and `docs/` still contain upstream's demo values.

## Commands

pnpm only — `preinstall` runs `only-allow pnpm`, and `.npmrc` sets `manage-package-manager-versions=true`
so Corepack pins the `packageManager` version (`pnpm@9.14.4`). Node >= 20; CI builds on 22 and 23.

| Command | Purpose |
|:--|:--|
| `pnpm install` | Install dependencies |
| `pnpm dev` | Dev server on `localhost:4321` |
| `pnpm build` | `astro build` then `pagefind --site dist` (builds the search index) |
| `pnpm preview` | Serve `./dist` — the only way to exercise real search |
| `pnpm check` | `astro check` — types across `.astro`/`.svelte`/`.ts` |
| `pnpm type-check` | `tsc --noEmit --isolatedDeclarations` |
| `pnpm lint` | `biome check --write ./src` |
| `pnpm format` | `biome format --write ./src` |
| `pnpm new-post <name>` | Scaffold `src/content/posts/<name>.md` with frontmatter |

There is no test framework in this repository. Validation means `pnpm check` + `pnpm lint` + a successful
`pnpm build`. `CONTRIBUTING.md` asks for `pnpm check` and `pnpm format` before submitting, and Conventional
Commits for commit messages.

## Architecture

### Config is the single source of truth

`src/config.ts` exports `siteConfig`, `navBarConfig`, `profileConfig`, `licenseConfig`, and
`expressiveCodeConfig`, all typed by `src/types/config.ts`. It is consumed at build time by layouts,
components, and even `astro.config.mjs` (which imports `expressiveCodeConfig` for the code-block theme).
Values needed by client-side code cross the boundary through `ConfigCarrier.astro`, which renders a
`#config-carrier` element with `data-hue`; `src/utils/setting-utils.ts` reads it back in the browser. If
client JS needs a new config value, add it there rather than importing the config into a Svelte island.

Layout-geometry constants (banner heights, page width, `PAGE_SIZE`, theme mode names) live in
`src/constants/constants.ts` and are shared between the Astro/CSS side and the inline scripts.

### Content collections

`src/content/config.ts` defines two collections: `posts` (schema-validated frontmatter) and `spec` (the
`about.md` body, empty schema). The `posts` schema includes `prevTitle`/`prevSlug`/`nextTitle`/`nextSlug`
marked "for internal use" — these are **not** authored in frontmatter; `getSortedPosts()` in
`src/utils/content-utils.ts` fills them in after sorting. Read post data through those helpers, not
`getCollection` directly, or you lose the prev/next wiring.

Draft handling: every collection query filters with `import.meta.env.PROD ? data.draft !== true : true`, so
drafts render in `pnpm dev` and disappear from builds. That predicate is repeated in three functions in
`content-utils.ts` — keep them in sync.

`getSortedPostsList()` exists specifically to strip `post.body` before serializing posts into the Svelte
archive island; use it for anything crossing into client-side props.

### Routing and URLs

`astro.config.mjs` sets `trailingSlash: "always"` and a configurable `base`. Always build internal links
with `url()` / `getPostUrlBySlug()` / `getTagUrl()` / `getCategoryUrl()` from `src/utils/url-utils.ts` —
never hardcode paths, or the site breaks under a non-root `base`.

- `src/pages/[...page].astro` — paginated index (`PAGE_SIZE`)
- `src/pages/posts/[...slug].astro` — post pages; calls `entry.render()` and reads `remarkPluginFrontmatter`
- `src/pages/archive.astro` — renders `ArchivePanel.svelte` as `client:only="svelte"`; filtering is driven by
  URL query params (`?tag=`, `?category=`, `?uncategorized=true`) parsed in the component
- `src/pages/about.astro`, `rss.xml.ts`, `robots.txt.ts`

`MainGridLayout.astro` (navbar, banner, sidebar, TOC) wraps `Layout.astro` (head, meta, global CSS vars,
all client-side bootstrapping). Pages should use `MainGridLayout`.

### Swup page transitions — the main constraint on client JS

`@swup/astro` swaps the `main` and `#toc` containers without a full page load. Consequently `Layout.astro`
registers nearly all browser behavior through `window.swup.hooks` (`page:view`, `content:replace`,
`visit:start`, `animation:out:start`, `link:click`, `visit:end`) with a `document.addEventListener('swup:enable', setup)`
fallback for the first load. Any new client-side initialization (scrollbars, PhotoSwipe, click-outside
handlers, banner/navbar height math) must be registered the same way or it will silently stop working after
the first in-site navigation. Banner height is changed on `link:click` rather than via a body class because
the class update lands after the transition and looks delayed.

### Theming

Light/dark/auto plus a hue slider. An `is:inline` script in `Layout.astro`'s `<head>` applies the stored
theme and `--hue` before first paint to avoid a flash; `localStorage` keys are `theme` and `hue`. Runtime
changes go through `src/utils/setting-utils.ts` (`setTheme`, `setHue`), which also sets `data-theme` for
Expressive Code. The Expressive Code theme must be a dark theme — the blog only overrides dark backgrounds.

### Markdown pipeline

The remark/rehype chain is configured in `astro.config.mjs` with local plugins in `src/plugins/`:

- `remark-reading-time` and `remark-excerpt` write `minutes`, `words`, and `excerpt` into
  `data.astro.frontmatter`; consumers read them via `remarkPluginFrontmatter` after `entry.render()`
  (`PostCard.astro`, `posts/[...slug].astro`). They are not part of the Zod schema.
- `remark-directive` + `remark-directive-rehype` + `rehype-components` implement custom syntax:
  `:::note`/`tip`/`important`/`caution`/`warning` map to `AdmonitionComponent`, and `::github{repo="..."}`
  to `GithubCardComponent`. Both are hastscript builders in `src/plugins/rehype-component-*.mjs`.
- `remark-github-admonitions-to-directives` converts GitHub-style `> [!NOTE]` blocks into those directives.
- Expressive Code adds two local plugins, `language-badge.ts` and `custom-copy-button.ts`; the built-in copy
  button is disabled in favor of the custom one.

### i18n

`src/i18n/i18nKey.ts` is an enum; each `src/i18n/languages/*.ts` must satisfy the full `Translation` type
(all enum keys). `i18n()` resolves once from `siteConfig.lang` at build time — it is not per-request, so
translation calls at module scope (e.g. `src/constants/link-presets.ts`) are fine. Adding a language means a
new file plus an entry in the `map` in `translation.ts`.

### Search

Pagefind indexes `dist` as a post-build step, so search only works after `pnpm build && pnpm preview`.
`Search.svelte` guards on `import.meta.env.PROD && window.pagefind` and returns hardcoded fake results in
dev. `pagefind.yml` excludes KaTeX spans, the search panel itself, and `[data-pagefind-ignore]`.

### Styling

Tailwind (`@astrojs/tailwind` with `nesting: true`) plus Stylus (`src/styles/variables.styl`,
`markdown-extend.styl`) and PostCSS (`postcss-import`, `postcss-nesting`). Global CSS custom properties are
declared in `Layout.astro` rather than `GlobalStyles.astro` — see the comment there linking the Astro issue
that forces this.

### Path aliases

`tsconfig.json` defines `@components/*`, `@assets/*`, `@constants/*`, `@utils/*`, `@i18n/*`, `@layouts/*`,
and `@/*` (→ `src/*`). The codebase mixes these with relative imports; prefer the aliases in new code.

## Conventions and traps

- Biome formats with **tabs** and double quotes. `biome.json` disables `useConst`, `useImportType`,
  `noUnusedVariables`, and `noUnusedImports` for `.astro`/`.svelte`/`.vue`, since Biome does not fully
  understand those files. `src/**/*.css` is excluded from Biome.
- On a Windows checkout with `core.autocrlf=true`, `biome ci ./src` reports *every* file as unformatted —
  Biome's `lineEnding` defaults to `lf` while the working tree is CRLF. This is a local-only artifact; CI
  runs on Linux and sees LF. To check formatting of a specific file the way CI does, normalize first:
  `tr -d '\r' < <file> | ./node_modules/.bin/biome format --stdin-file-path=<file>` and diff the output.
  Use `biome lint ./src` (no formatter) for a trustworthy local lint signal.
- `LightDarkSwitch.svelte` is the only Svelte component in runes mode; the others use legacy `export let` /
  `$:`. A runes component with no `$props()` is typed `Record<string, never>`, whose index signature makes
  even `client:only` fail `astro check` — hence the explicit empty `$props()` declaration there.
- `Layout.astro` unconditionally overwrites its `banner` prop with `siteConfig.banner.src` (a `TODO`:
  per-post cover banners are disabled). Passing `banner` through `MainGridLayout` currently has no effect.
- Before deploying, change `site` in `astro.config.mjs` (still `https://fuwari.vercel.app/`) and the demo
  values in `src/config.ts`. `vercel.json` is an empty object.
- Do not add `any` to the TypeScript here — `tsconfig` extends `astro/tsconfigs/strict` and `pnpm type-check`
  runs with `--isolatedDeclarations`.

## CI

`.github/workflows/build.yml` — `pnpm astro check` and `pnpm astro build` on a Node 22/23 matrix,
`pnpm install --frozen-lockfile`, concurrency-cancelling, on push/PR to `main`.
`.github/workflows/biome.yml` — `biome ci ./src --reporter=github` using `biome@latest` from
`biomejs/setup-biome`, which can drift from the pinned `@biomejs/biome` 2.2.5 devDependency and fail CI on
rules that pass locally.
