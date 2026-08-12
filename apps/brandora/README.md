# Brandora — front end

Static HTML, CSS and JavaScript. No framework, no build step for the markup.

```bash
pnpm build:brandora   # emits the generated data, then checks the site
pnpm brandora         # serves on http://localhost:4100
```

## Pages

| File | What it does |
| --- | --- |
| `index.html` | Landing page — hero, how it works, brand creation, physical branding, AI sourcing, small-quantity positioning |
| `create.html` | The brand builder: the interview, then the generated visual identity |
| `catalog.html` | The catalogue, with the quantity filter that demotes what cannot be ordered |
| `package.html` | The brand package builder and the estimated total |

## Generated files — do not edit by hand

These are emitted by the TypeScript packages so there is one source of truth,
and they are committed so a fresh clone serves without a build:

| Path | Emitted by |
| --- | --- |
| `locales/{en,fr,es}.json` | `@brandora/i18n` |
| `data/catalog.json` | `@brandora/catalog` |
| `data/interview.json` | `@brandora/brand-engine` |
| `assets/js/generated/{color,identity}.js` | `@brandora/brand-engine` |

`color.js` and `identity.js` are the *compiled engine modules*, copied rather
than reimplemented. The palette a founder sees in the builder is produced by the
same code that produces the brand kit, so the two cannot drift. The emit step
fails the build if either file grows an import a browser could not resolve.

## Conventions

- **Dark is the primary experience**, and a person's own choice always wins after
  that. Both persist across pages.
- **Every page carries the language switcher and the theme toggle.** The
  integrity check fails a page that is missing either.
- **The page works without JavaScript.** Markup is complete and readable; the
  scripts add preference, motion and translation on top. Interactive pages say
  so in a `<noscript>` rather than showing an empty container.
- **Touch targets are at least 44px** and the layout is mobile-first — this
  product runs on the phone the business already runs on.
- **No secret is ever named here.** `scripts/check-brandora.mjs` fails the build
  if a page or script so much as mentions a secret environment variable.
