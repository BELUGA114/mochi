# src/layouts

`MainGridLayout.astro` (navbar, banner, sidebar, TOC) wraps `Layout.astro` (head, meta, global CSS vars,
all client-side bootstrapping). Pages should use `MainGridLayout`.

## Swup page transitions — the main constraint on client JS

`@swup/astro` swaps the `main` and `#toc` containers without a full page load. Consequently `Layout.astro`
registers nearly all browser behavior through `window.swup.hooks` (`page:view`, `content:replace`,
`visit:start`, `animation:out:start`, `link:click`, `visit:end`) with a
`document.addEventListener('swup:enable', setup)` fallback for the first load. Any new client-side
initialization (scrollbars, PhotoSwipe, click-outside handlers, banner/navbar height math) must be
registered the same way or it will silently stop working after the first in-site navigation. Banner height
is changed on `link:click` rather than via a body class because the class update lands after the transition
and looks delayed.

## Theming

Light/dark/auto plus a hue slider. An `is:inline` script in `Layout.astro`'s `<head>` applies the stored
theme and `--hue` before first paint to avoid a flash; `localStorage` keys are `theme` and `hue`. Runtime
changes go through `src/utils/setting-utils.ts` (`setTheme`, `setHue`), which also sets `data-theme` for
Expressive Code. The Expressive Code theme must be a dark theme — the blog only overrides dark backgrounds.

## Global CSS custom properties

Global CSS custom properties are declared in `Layout.astro` rather than `GlobalStyles.astro` — see the
comment there linking the Astro issue that forces this. Tokens that must change while the wallpaper is on
are overridden on `body`, never on `:root`; see below for why.

## Wallpaper background

`siteConfig.wallpaper` (optional, currently disabled) renders `src/components/misc/Wallpaper.astro` from
`MainGridLayout.astro` on every page: a `fixed inset-0 -z-10` image layer plus a darkening overlay, with a
random image picked per site visit by an `is:inline` script (one entry in `images` = fixed wallpaper,
several = random per full page reload). Image paths follow `banner.src` rules and are resolved at build
time with the same `import.meta.glob` conventions as `ImageWrapper.astro`; runtime-random `<img src>`
means Astro `<Image>` optimization does not apply. `#wallpaper` sits outside the Swup containers, so it
persists across in-site navigations — do not move it inside them.

Wallpaper takes precedence over the banner: the banner strip, `enable-banner` body class, `toc-hide`, and
`mainPanelTop` are gated on `banner.enable && !wallpaper.enable` in both `Layout.astro` and
`MainGridLayout.astro` — keep the two expressions in sync. When enabled, cards turn translucent: `--card-bg`
is overridden on `body.enable-wallpaper` in `Layout.astro`'s global style block. That override must stay on
`body` — `variables.styl` declares `--card-bg` on `:root`/`:root.dark`, and custom properties resolve to the
nearest declaring ancestor. Defaults (`WALLPAPER_OVERLAY_DEFAULT`, `WALLPAPER_CARD_OPACITY_DEFAULT`) live in
`src/constants/constants.ts`.

Cards also get a frosted-glass treatment in the same style block: `body.enable-wallpaper .card-base` /
`.float-panel` add `backdrop-filter` blur + saturate, a 1px light border, and a soft shadow (the dark card
base is tinted `rgba(18,18,26,…)` rather than pure black). The homepage list wrapper in `PostPage.astro`
carries no surface of its own (transparent at every breakpoint, card gaps via `gap-4`) so the per-card glass
is the only translucent layer — a second translucent layer there would stack with the cards' own background
and crush the wallpaper to ~5% visibility. The TOC gets a lighter glass rail on post pages, gated on
`body.enable-wallpaper:has(#post-container)` — the `:has()` guard keeps the empty TOC placeholder on
non-post pages from rendering an empty panel, and the `mask-image` fade is dropped there because it would
cut the panel's border.

**Before adding an animation to any ancestor of a card, read `src/styles/CLAUDE.md`.** Chromium silently
disables `backdrop-filter` under an animation-filled ancestor, which makes every glass surface render
transparent-but-flat — and the bug does not reproduce in Firefox.

## Layout geometry

Layout-geometry constants (banner heights, page width, `PAGE_SIZE`, theme mode names) live in
`src/constants/constants.ts` and are shared between the Astro/CSS side and the inline scripts.

There are two distinct paths to that file and they must be kept in step: normal `import`s used by the
Astro/CSS side, and the `define:vars` list on the `is:inline` script in `Layout.astro`
(`DEFAULT_THEME`, `LIGHT_MODE`, `DARK_MODE`, `AUTO_MODE`, `BANNER_HEIGHT_EXTEND`, `PAGE_WIDTH`, plus the
config hue). An `is:inline` script cannot use imports, so a constant needed inside it must be added to
`define:vars` as well — forgetting that is a silent `undefined` in the browser, not a build error.

## Known trap: the `banner` prop does nothing

`Layout.astro` unconditionally overwrites its `banner` prop with `siteConfig.banner.src` (a `TODO`:
per-post cover banners are disabled). Passing `banner` through `MainGridLayout` currently has no effect —
the post cover still reaches the `<head>` as `og:image`, but through the separate `ogImage` prop resolved
by `src/utils/og-utils.ts`.
