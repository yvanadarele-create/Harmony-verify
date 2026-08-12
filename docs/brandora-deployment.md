# Deploying Brandora separately from Harmony Verify

Brandora and Harmony Verify are unrelated products that currently share a
repository. This document covers how they are kept apart, what is already safe,
and the one part that has to be done by hand in the Vercel dashboard.

## What is already separate

**Code.** Brandora has no dependency on Harmony, in either direction. Verified:

```bash
grep -rn "@harmony/" packages/brandora-*/src packages/brandora-*/package.json apps/brandora
# no matches
```

Every Brandora package depends only on other `@brandora/*` packages. Harmony's
packages do not reference Brandora at all. Either product could be moved to its
own repository by copying `packages/brandora-*`, `apps/brandora`, its tests and
its scripts — nothing would need rewriting.

**Configuration.** `@brandora/config` reads only `ALIEXPRESS_*`, `BRANDORA_*`
and `ANTHROPIC_*`. `@harmony/config` reads only Harmony's variables. Neither
imports the other.

**Build.** `pnpm build:brandora` builds only the Brandora packages and then runs
the Brandora site check. `pnpm build:web` is untouched and still builds Harmony.

**Tests.** Brandora's suites are `tests/brandora-*.test.ts`. Harmony's are
unchanged and still pass.

## What is shared, and why that is acceptable

- **The pnpm workspace and lockfile.** One install serves both. This is normal
  monorepo behaviour and does not couple the products.
- **`turbo.json`.** Task definitions are generic (`build`, `test`, `typecheck`)
  and apply to whichever packages exist.
- **`tsconfig.base.json`.** Compiler settings only.
- **`.env.example`.** Documents both products' variables in clearly separated
  sections. At runtime each product reads only its own.

None of these carry product logic, so neither deployment can break the other
through them.

## The one thing that is not separable in the repository

**`vercel.json` at the repository root.** Vercel reads a single config per
project, and the root one is Harmony's — it sets `outputDirectory` to
`apps/web`. Editing it to point at Brandora would take the Harmony site down.

So Brandora ships its own `apps/brandora/vercel.json`, which Vercel reads when a
project's **Root Directory** is set to `apps/brandora`. That file is inert for
the Harmony project, which never looks at it.

### Manual step required — I cannot do this for you

In the Vercel dashboard, create a **second project** from this same repository:

| Setting | Value |
| --- | --- |
| Project name | `brandora` (or your choice) |
| Root Directory | `apps/brandora` |
| Include files outside root directory | **Enabled** — the build runs `cd ../..` to reach the workspace |
| Framework preset | Other |
| Build/Install/Output | Leave blank — `apps/brandora/vercel.json` supplies them |

Leave the existing Harmony project untouched: Root Directory empty, root
`vercel.json` as it is.

Then add Brandora's environment variables to the new project only. They are
listed in `.env.example` under the `BRANDORA` heading and documented in
[`configuration.md`](./configuration.md).

### Verifying the split did not break Harmony

```bash
pnpm build:web    # Harmony builds and its site check passes
pnpm build:brandora
pnpm test         # both products' suites
```

## If you would rather split the repositories

That is the cleaner end state, and the code is already shaped for it. Move:

```
packages/brandora-shared      packages/brandora-catalog
packages/brandora-config      packages/brandora-sourcing
packages/brandora-i18n        packages/brandora-quotes
packages/brandora-brand-engine
apps/brandora
tests/brandora-*.test.ts
scripts/check-brandora.mjs
docs/brandora*.md
```

Take `tsconfig.base.json`, `turbo.json` and `pnpm-workspace.yaml` as templates,
and the `BRANDORA` section of `.env.example`. Remove the `brandora` scripts from
the root `package.json` and the Brandora dependencies from `tests/package.json`.
Nothing else in Harmony refers to Brandora, so nothing else needs changing.
