# src/utils

Stateless helpers. These four modules are the read/write paths the rest of the site is supposed to go
through — bypassing them is the most common way to introduce a subtle bug here.

## `content-utils.ts` — the only way to read posts

`src/content/config.ts` defines two collections: `posts` (schema-validated frontmatter) and `spec` (the
`about.md` body, empty schema). Read post data through these helpers, **not** `getCollection` directly, or
you lose the prev/next wiring.

The `posts` schema includes `prevTitle`/`prevSlug`/`nextTitle`/`nextSlug` marked "for internal use" —
these are **not** authored in frontmatter; `getSortedPosts()` fills them in after sorting.

Draft handling: every collection query filters with `import.meta.env.PROD ? data.draft !== true : true`, so
drafts render in `pnpm dev` and disappear from builds. That predicate is repeated in **three** functions in
`content-utils.ts` — keep them in sync.

`getSortedPostsList()` exists specifically to strip `post.body` before serializing posts into the Svelte
archive island; use it for anything crossing into client-side props.

## `url-utils.ts` — never hardcode a path

`astro.config.mjs` sets `trailingSlash: "always"` and a configurable `base`. Always build internal links
with `url()` / `getPostUrlBySlug()` / `getTagUrl()` / `getCategoryUrl()` — never hardcode paths, or the site
breaks under a non-root `base`. Route inventory is in the root `CLAUDE.md`.

## `setting-utils.ts` — runtime theme writes

`setTheme` and `setHue` are the runtime counterparts of the `is:inline` pre-paint script in
`Layout.astro`'s `<head>`; both write the `theme` / `hue` `localStorage` keys, and `setTheme` also sets
`data-theme` for Expressive Code. Change the storage keys or the `data-theme` attribute in both places at
once.

`ConfigCarrier.astro` renders the `#config-carrier` element this module reads `data-hue` from — it is the
only supported path from config to client JS.

## `og-utils.ts`

Resolves the `ogImage` prop consumed by `Layout.astro`. This is separate from the `banner` prop, which
`Layout.astro` overwrites unconditionally; see `src/layouts/CLAUDE.md`.
