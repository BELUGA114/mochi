# src/i18n

UI strings for the site chrome (navbar, archive, pagination, "minutes", …) — not for post content, which
carries its own `lang` frontmatter field.

## The contract

`i18nKey.ts` is an enum; each `src/i18n/languages/*.ts` must satisfy the full `Translation` type, meaning
**every** enum key. Adding a key therefore means editing every language file in the same commit, or
`pnpm check` fails.

Adding a language is a new file in `languages/` plus an entry in the `map` in `translation.ts`.

## Resolution is build-time

`i18n()` resolves once from `siteConfig.lang` at build time — it is not per-request, so translation calls
at module scope are fine (e.g. `src/constants/link-presets.ts` does this). Changing `siteConfig.lang`
changes the whole site.

`src/i18n/languages/th.ts` contains combining marks; never round-trip it through a formatter or shell
`tr`/`sed` pipeline that rewrites it to disk — that silently drops Thai tone marks such as U+0E49.
