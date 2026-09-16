# src/components

Astro components and Svelte islands, grouped into `control/` (interactive controls), `misc/` (wallpaper,
image wrapper, footer, …), and `widget/` (sidebar widgets, archive panel, TOC).

## Config must not be imported into a Svelte island

`src/config.ts` is consumed at build time by Astro layouts and components, but values needed by
client-side code cross the boundary through `ConfigCarrier.astro`, which renders a `#config-carrier`
element with `data-hue`; `src/utils/setting-utils.ts` reads it back in the browser. If client JS needs a
new config value, add it to `ConfigCarrier.astro` rather than importing the config into a Svelte island.

## `LightDarkSwitch.svelte` and the runes-mode typing trap

`LightDarkSwitch.svelte` is the only Svelte component in runes mode; the others use legacy `export let` /
`$:`. A runes component with no `$props()` is typed `Record<string, never>`, whose index signature makes
even `client:only` fail `astro check` — hence the explicit empty `$props()` declaration there. Keep that
declaration when editing the file, and do not convert the legacy components to runes piecemeal.

## `misc/Wallpaper.astro`

Rendered from `MainGridLayout.astro` on every page when `siteConfig.wallpaper` is enabled. Image paths
follow `banner.src` rules and are resolved at build time with the same `import.meta.glob` conventions as
`ImageWrapper.astro`; a runtime-random `<img src>` means Astro `<Image>` optimization does not apply.
`#wallpaper` must stay outside the Swup containers, and its picker script must keep
`data-swup-ignore-script` — SwupScriptsPlugin re-runs document-wide scripts on every navigation, so the
attribute is what makes the image change only on a full reload. Full wallpaper context, including the
card-glass rules that depend on it, is in `src/layouts/CLAUDE.md`.

## Client-side surfaces

- `widget/ArchivePanel.svelte` is rendered by `src/pages/archive.astro` as `client:only="svelte"`; its
  filtering is driven by URL query params (`?tag=`, `?category=`, `?uncategorized=true`) parsed inside the
  component. Posts reach it already stripped of `body` via `getSortedPostsList()`.
- `Search.svelte` guards on `import.meta.env.PROD && window.pagefind` and returns hardcoded fake results in
  dev. Pagefind indexes `dist` as a post-build step, so real search only works after
  `pnpm build && pnpm preview`. `pagefind.yml` excludes KaTeX spans, the search panel itself, and
  `[data-pagefind-ignore]`.
- `control/WallpaperToggle.astro` is the homepage's wallpaper-immersive switch. It only flips
  `body.wallpaper-immersive`; every hiding rule lives in `Layout.astro`'s global style block. It must be
  rendered on every page and stay outside the Swup containers (both are load-bearing — see
  `src/layouts/CLAUDE.md`), and its bindings are wrapped in an idempotence guard because Astro inlines
  import-free scripts and Swup replays them on every navigation.
- `PostCard.astro` and the `PostPage.astro` list read `minutes`, `words`, and `excerpt` from
  `remarkPluginFrontmatter` after `entry.render()` — they are not part of the Zod schema.

Any new client-side initialization must be registered through `window.swup.hooks` rather than a bare
`DOMContentLoaded` listener, or it stops working after the first in-site navigation; see
`src/layouts/CLAUDE.md`.
