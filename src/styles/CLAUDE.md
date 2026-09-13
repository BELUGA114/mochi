# src/styles

Stylus and global CSS. Tailwind utilities carry most of the layout; these files hold the tokens and the
transition rules.

## Toolchain

Tailwind (`@astrojs/tailwind` with `nesting: true`) plus Stylus (`variables.styl`, `markdown-extend.styl`)
and PostCSS (`postcss-import`, `postcss-nesting`, configured in `postcss.config.mjs`). `src/**/*.css` is
excluded from Biome, so there is no formatter guard rail here — match the surrounding style by hand.

## `variables.styl` declares the tokens on `:root`

`--card-bg` (and the rest of the palette) is declared on `:root` / `:root.dark`, so a token override
anywhere else must land on a **nearer** ancestor than `:root` to win — custom properties resolve to the
nearest declaring ancestor. That is why the wallpaper's translucent card override in `Layout.astro` is
scoped to `body.enable-wallpaper` and must stay there. See `src/layouts/CLAUDE.md` for the wallpaper rules.

## The `.onload-animation` trap — read before touching `transition.css`

Chromium silently disables `backdrop-filter` when any ancestor keeps an animation-filled state: an
ancestor with an opacity animation plus `animation-fill-mode: forwards` becomes a backdrop root, so
descendant cards blur only content inside that subtree — the wallpaper is outside it, so the glass looks
transparent-but-flat.

That is why `.onload-animation` in `src/styles/transition.css` uses `backwards` with no base
`opacity: 0`. `forwards` + `opacity: 0` breaks the glass in Chrome while Firefox keeps working, so the bug
is invisible in a Firefox-only check. Elements with `.onload-animation` are `#navbar`, `#sidebar`,
`#content-wrapper`, the footer, and post/list items; `#toc-inner-wrapper` has no such ancestor, which is
why the TOC rail was the one surface that looked right in Chrome.

Do not give `.onload-animation` (or any new ancestor of a card) a base `opacity: 0` or a
`fill-mode: forwards` opacity animation. Verify glass changes in Chrome, not just Firefox.
