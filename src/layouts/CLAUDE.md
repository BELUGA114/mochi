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
persists across in-site navigations — do not move it inside them. That alone is **not** enough to keep the
picker script from re-running: `@swup/astro` enables `SwupScriptsPlugin` by default (`reloadScripts`), which
re-executes every `<script>` in the whole document on each `content:replace` — outside-container scripts
included. That is why the picker script carries `data-swup-ignore-script`; removing it makes the wallpaper
re-randomize on every in-site navigation.

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

## Post-page sidebar rail

On post pages (`#post-container` present), three things change at once, all pure CSS in
`src/styles/transition.css` gated on `body:has(#post-container)` (a live selector that re-evaluates
when Swup swaps `main` — no JS hook involved): the page width narrows from `--page-width` (75rem) to
56rem on the three width wrappers (`#top-row`, `#main-panel`, `#toc-panel` in
`MainGridLayout.astro`; only `#toc-panel` carries `transition-all duration-700` — `#top-row` and
`#main-panel` snap, the navbar's narrowing being faked by the FLIP script (see below); at
`min-width: 64rem`
(lg) `#main-grid` collapses its first track (`grid-template-columns: 0rem auto`, `column-gap: 0`);
and at `min-width: 96rem` (2xl, the same breakpoint the TOC uses) the sidebar slides out of the page
width via `margin-left: -18.5rem`. The variable is not overridden — `--page-width` ships as an inline `style` attribute on
`<html>`/`<body>` (Layout.astro's `define:vars`) and the wrappers merely inherit it, so a
wrapper-level var rule would win; overriding `max-width` directly on the three wrappers is chosen
because it is surgical — it states exactly what changes, without re-deriving the variable for
anything else in those subtrees. 56rem puts the article card (54rem) within 0.5rem of the homepage
card column (54.5rem).

Non-obvious choices, do not "simplify" them away:

- The grid collapse and the `grid-column: 2` pin are scoped to `min-width: 64rem`. Below lg the
  sidebar and `main` are `col-span-2` stacked and the 17.5rem first track is an empty slot; unscoped,
  the pin put the article's left edge 18.5rem right and the track animation slid it back — the
  "article moves in from the right" artifact on mobile. `#sidebar { display: none }` in post mode
  stays unscoped (mobile post pages intentionally drop the stacked sidebar).
- `#swup-container` is pinned to `grid-column: 2` in post mode — in the 64–96rem band the sidebar is
  `display: none`, and auto-placement would drop the article into the collapsed 0-width first track
  and clip it to zero width. At ≥96rem the in-flow sidebar occupies track 1, so auto-placement lands
  the article in track 2 anyway; the pin keeps both bands behaving identically and makes the
  article's left edge follow the animating track boundary, which is the "content slides into place"
  half of the animation.
- The sidebar's *parking* uses a negative `margin-left`, never `position: absolute`: staying in flow
  means no position flip when leaving post mode (an absolute→static flip while the track animates
  0→17.5rem makes a `w-full` sidebar collapse to zero then puff back — that user-reported bug is
  why this is margin-based), preserves the row-height contribution on short post pages, and
  keeps `#sidebar-sticky` sticky working. `width: 17.5rem` is pinned unconditionally at lg+ for the
  same reason. The *slide animation itself* is not the margin — it is a transient transform
  animation played by the FLIP script (next section). A stylesheet transition on `#sidebar`'s
  transform would be wrong (its `.onload-animation` keyframes animate transform; the FLIP animation
  is safe because on Swup navigations the element persists and its keyframes have already finished,
  with `backwards` fill leaving nothing behind).
- The TOC rail mirrors `#sidebar-sticky`'s behavior: `#toc-inner-wrapper` is `sticky top-4`, so it starts
  aligned with the sidebar cards' top (its static position = the main-content wrapper's top, 5.5rem =
  `mainPanelTop` with the banner off), rises with the page, and pins at the same 1rem offset the
  categories block pins at. For the sticky travel to span the article, the whole TOC subtree
  (`#toc-panel` and everything inside) lives **inside the main-content wrapper** (`absolute w-full z-30
  pointer-events-none` in `MainGridLayout.astro`), as an `absolute inset-0` layer *before* `#main-panel`:
  the wrapper's only in-flow child is `#main-panel`, so its height equals the article height — the same
  grid-row height `#sidebar` spans, and both sticky elements unstick at the same scroll point. This is
  why the TOC cannot stay at body level: an `absolute bottom-0` there anchors to the initial containing
  block (viewport-height, not document-height), and everything between body and the wrapper is a 0-height
  box, so no pure-CSS container of article height exists outside the wrapper. The full-size `inset-0`
  layer is `pointer-events-none` with `pointer-events-auto` only on the rail itself; being placed before
  `#main-panel` keeps the article and BackToTop painting above it, matching the old `z-0` body-level
  sibling. `#toc-panel` keeps `h-full` (the height chain: wrapper → `inset-0` layer → `h-full` panel →
  `top-0 bottom-0` on `#toc-wrapper`) and its `transition-all` now also animates that height across
  navigations — harmless, the panel is an invisible positioning box.

## Post-page FLIP animation (Chrome jank fix)

Entering a post page used to jank in Chrome, worse the longer the post: the layout-property
transitions (`grid-template-columns` / `max-width` / `margin-left`) run the full Style→Layout→Paint
pipeline every frame for 700ms, and the changing article width re-wrapped the whole text each frame
(plus glass `backdrop-filter` re-filtering on paint). Firefox is smooth on the same markup, so it
only showed in Chrome. Locking the article to its final 54rem width (rendering it once and letting
containers animate around it) removed the per-frame reflow but **not** the jank — the per-frame
layout/paint of the moving subtree alone was enough. The fix is FLIP (render final state, invert
with transform, play):

- All post-mode layout changes snap instantly: `transition.css` declares no transitions for the
  `#main-grid` tracks, `#main-panel` max-width, `#top-row` max-width, or the sidebar's negative
  margin (Tailwind's `transition` utility property list doesn't include those properties anyway;
  the extended `transition-property` rule, the `#sidebar` margin transition, and the post-mode
  700ms `#top-row` duration pin from the original commit were deleted, and the
  `transition-all duration-700` classes were dropped from `#main-panel` and `#top-row` in
  `MainGridLayout.astro`).
- The FLIP script lives in `Layout.astro`'s first module script, registered through the standard
  swup hooks: `visit:start` measures `#swup-container`/`#sidebar` rects (the fade-out's
  `translate-y-4` is vertical only, `left` is unaffected); `content:replace` without `before: true`
  runs after the DOM swap, where reading a rect also forces the `:has()` recalc and the final
  layout; then it plays `el.animate([{transform: translateX(delta)}, {transform: translateX(0)}],
  {duration: 700, easing})` — the Web Animations API with its default `fill: none`. So `visit:end`
  returns to ~200ms instead of ~700ms (no queued-navigation latency, no extended
  `#page-height-extend` window), the 0% keyframe applies before first paint (no second forced reflow
  to commit the start state), and no cleanup timer is needed. Transform animations are
  compositor-only: no layout, no text repaint.
- The navbar does an O2 "fake narrowing": the layout snaps with everything else, and
  `startNavbarFlip` in `Layout.astro` fakes the width change entirely on the compositor — the
  glass layer `#navbar-glass` plays `scaleX(oldW/newW) → 1` about the panel centre (the panel is
  `mx-auto` in both modes, so both boxes are concentric), and the three content groups
  (`#navbar-logo` / `#navbar-links` / `#navbar-actions`, ids added in `Navbar.astro`) each play a
  measured `translateX(oldLeft − newLeft) → 0` (the middle group is `justify-between`-centred and
  viewport-stationary, so its delta is ~0 and self-skips). History: the original 700ms
  `#max-width` transition was the only jank source left after the FLIP (differential experiment);
  O1 — a 300ms real transition with the panel's `backdrop-filter` suppressed for the window —
  still stuttered, so the per-frame cost is not just the blur re-filter but the sticky/layout
  recalculation of a real width animation. O2 removes every per-frame main-thread cost by moving
  the glass off the resizing box: `#navbar-panel` is layout-only now (`relative`, no `card-base`),
  and `#navbar-glass` (`card-base absolute inset-0 -z-10 !rounded-t-none`) has constant local
  geometry, so its backdrop sampling region never invalidates on layout. The popovers
  (`#nav-menu-panel`, `#display-setting`, `#search-panel`) anchor to the panel exactly as before —
  it was already their containing block via the old `backdrop-filter`, now via `relative`.
  Transient costs, accepted: the glass's rounded corners/border stretch horizontally up to
  ~1.35×, and `#navbar-logo`'s hover `scale-animation` is suppressed while its WAAPI transform
  runs. Below 75rem the navbar snaps with no animation. Only `#toc-panel` keeps its plain 700ms
  width transition: a branch (not ancestor) of the article, visible only at ≥96rem, and its glass
  rail (`#toc-inner-wrapper`) has constant size and merely translates — the sampling region never
  invalidates, confirmed not to jank.
- Gated to ≥75rem (`FLIP_MIN_WIDTH_QUERY` in Layout.astro; the gate is JS-only — `transition.css`
  has no matching media query any more): the right-edge constraint is the 54rem article card plus
  19.5rem of fixed left-hand width (1rem padding-left + 17.5rem first track + 1rem gap) = 73.5rem
  of layout width. 74.5rem left only ~1px of margin — its extra 1rem just happened to absorb a
  scrollbar — so 75rem was chosen for a real margin. Nothing sets `overflow-x` on `html`/`body`,
  and that must stay so: this threshold is the only guard against a horizontal scrollbar. Below the
  gate everything snaps with no animation.
- The Swup fade runs untouched from the stylesheet — nothing inline overrides it any more. Its
  `translate-y-4` rise, however, stays suppressed while the transform animation runs (WAAPI controls
  the `transform` property for those 700ms), so post navigations fade in as opacity-only. Accepted;
  the sidebar carries no fade classes.
- Running animations are cancelled at `visit:start`: a live WAAPI transform affects
  `getBoundingClientRect`, so a mid-flight FLIP would pollute the next measurement. With `fill: none`
  there is nothing else to clean — the animation leaves no residue when it ends, which is exactly why
  the old lingering-transform hazard is gone along with its timer (no containing block for
  `position: fixed` descendants, no Chromium compositing effect node breaking `backdrop-filter`; see
  the glass trap in `src/styles/CLAUDE.md`).

Leaving a post at ≥75rem FLIPs in reverse (the delta flips sign). In the 75–96rem band entering
a post, the sidebar is `display: none` in post mode, so it vanishes instantly while the article
slides (unchanged from the pre-FLIP behavior); leaving a post re-displays it instantly (`display`
cannot animate) — the known transient, now only in that band. Below 64rem nothing moves at all
(single-column; that is the mobile fix). The navbar narrows/widens via the O2 fake-narrowing above.
If the banner is ever re-enabled, re-check the navbar restructure — `bannerEnabled` also gates the
`navbar-hidden` scroll behavior on `#navbar-wrapper`, and the banner era predates
`#navbar-glass` being a separate layer.

Glass limitation: while a transform animation runs it creates a backdrop root in Chromium, so the
article card **and the sidebar cards** render with flat glass for the 700ms flip (see
`src/styles/CLAUDE.md`, which now documents this traversal of the `.onload-animation` trap). The
sidebar half is a regression versus the old margin transition — margin transitions don't create
backdrop roots, transform animations do — and it self-heals when the animation ends.

## Known trap: the `banner` prop does nothing

`Layout.astro` unconditionally overwrites its `banner` prop with `siteConfig.banner.src` (a `TODO`:
per-post cover banners are disabled). Passing `banner` through `MainGridLayout` currently has no effect —
the post cover still reaches the `<head>` as `og:image`, but through the separate `ogImage` prop resolved
by `src/utils/og-utils.ts`.
