# src/plugins

Local remark/rehype plugins and Expressive Code extensions. The chain that wires them together lives in
`astro.config.mjs`, not here — read both together.

## remark / rehype chain (`astro.config.mjs` → `markdown`)

- `remark-reading-time` and `remark-excerpt` write `minutes`, `words`, and `excerpt` into
  `data.astro.frontmatter`; consumers read them via `remarkPluginFrontmatter` after `entry.render()`
  (`PostCard.astro`, `posts/[...slug].astro`). They are not part of the Zod schema.
- `remark-directive` + `remark-directive-rehype` + `rehype-components` implement custom syntax:
  `:::note`/`tip`/`important`/`caution`/`warning` map to `AdmonitionComponent`, and `::github{repo="..."}`
  to `GithubCardComponent`. Both are hastscript builders in `src/plugins/rehype-component-*.mjs`.
- `remark-github-admonitions-to-directives` converts GitHub-style `> [!NOTE]` blocks into those directives.
  The directive names it emits must match the `components` map in `astro.config.mjs`.
- `rehype-autolink-headings` appends the heading anchors and marks their icon `data-pagefind-ignore` so
  Pagefind does not index the `#` glyphs.

## Expressive Code

Two local plugins extend it: `expressive-code/language-badge.ts` and
`expressive-code/custom-copy-button.ts`. The built-in copy button is disabled in favor of the custom one
(`frames.showCopyToClipboardButton: false`). The theme is imported from `src/config.ts`
(`expressiveCodeConfig`) and must stay a **dark** theme — the blog only overrides dark backgrounds.

## Adding a component

A new directive needs two edits kept in sync: the builder in this directory, and its entry in the
`components` map in `astro.config.mjs`. If the syntax itself is new, it also needs its parser added to
`remarkPlugins`.

`rehype-component-github-card.mjs` currently produces a `useOptionalChain` lint warning. Warnings are
annotated but do not fail CI; see the root `CLAUDE.md` for how to read the annotations.
