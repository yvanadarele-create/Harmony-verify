# Harmony Verify

Clinical verification infrastructure for healthcare AI — a monorepo containing the public
marketing site, the customer and expert applications, the internal admin console, the backend
API, and the domain engines they all share.

## Structure

```
apps/
  web             Marketing site — static HTML/CSS/JS, no build step        ✅ complete
  dashboard       Customer application                                      ⏳ planned
  expert-portal   Expert review application                                 ⏳ planned
  admin           Internal admin console                                    ⏳ planned
  api             Backend API                                               ⏳ planned

packages/
  design-system   Canonical design tokens (source of truth for all CSS)     ✅ complete
  shared          Domain types, typed errors, id + signing helpers          ✅ complete
  ui              Shared React components                                   ⏳ planned
  database        Schema, repositories, migrations                          ⏳ planned
  verification-engine  Submission triage, rubric scoring, record assembly   ⏳ planned
  expert-matching Specialty routing, conflict and capacity rules            ⏳ planned
  pricing-engine  Price and SLA calculation                                 ⏳ planned
  ai-engine       LLM classification and drafting                           ⏳ planned
  analytics       Aggregate quality metrics                                 ⏳ planned
  notifications   Email and in-app delivery                                 ⏳ planned
  cognitive-data  Failure taxonomy and evaluation datasets                  ⏳ planned

docs/             Architecture and decision records
tests/            Cross-package integration tests
scripts/          Repo tooling
infrastructure/   Deployment configuration
```

Status markers are accurate as of the latest commit. A `⏳ planned` package exists as a
workspace member with its manifest in place, but has no implementation yet.

## Getting started

```bash
pnpm install          # install all workspace dependencies
pnpm test             # run every package's tests
pnpm typecheck        # type-check the whole repo
```

### The marketing site

It is static on purpose — no bundler, no framework, no build step.

```bash
cd apps/web && python3 -m http.server 4000
# http://localhost:4000
```

Verify link and asset integrity without a browser:

```bash
node scripts/check-web.mjs
```

## Design tokens

`packages/design-system/src/tokens.ts` is the single source of truth for every colour,
font stack and spacing value.

```bash
pnpm tokens    # regenerate all consumers
```

That writes `packages/design-system/dist/tokens.css` for the React apps **and** rewrites the
`:root` block inside `apps/web/assets/css/main.css` in place, between the `/* @tokens:start */`
and `/* @tokens:end */` markers. The static site therefore stays buildless and adds no extra
network request, while remaining impossible to drift from the canonical tokens.

Never hand-edit the block between those markers — the next `pnpm tokens` overwrites it.

## Architecture

```
Visitor → apps/web → sign in → apps/dashboard → submit verification
                                     ↓
                              apps/api
                                     ↓
              verification-engine → expert-matching → pricing-engine
                                     ↓
                         apps/expert-portal (clinician review)
                                     ↓
                    verification record → apps/dashboard
```

Business logic lives in `packages/*`, never in a page or a route handler. Apps compose
engines; they do not reimplement them.

## Pending assets

| Asset | Where | Status |
| --- | --- | --- |
| `apps/web/assets/img/founder.jpg` | Founder profile, `company.html` | Awaiting file. Falls back to an "AY" monogram, so the page is never broken. |

To supply the founder portrait, drop the file in and it appears automatically — no code change:

```bash
cp /path/to/portrait.jpg apps/web/assets/img/founder.jpg
```

Square or portrait crop, at least 400×400. It is displayed as a 132px circle, focal point
biased slightly above centre for head-and-shoulders framing.

## A note on claims

Site copy deliberately avoids stating security certifications, compliance attestations or
accuracy figures the company does not hold or cannot source. `apps/web/trust.html` publishes
that discipline as an explicit position. If a real certification is obtained, add it to the
data-handling table there with its actual scope and date — and not before.
