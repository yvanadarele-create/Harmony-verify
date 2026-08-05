# Harmony Verify — AI Trust Infrastructure

**Building the trust layer for artificial intelligence.**

As AI systems become increasingly powerful, their greatest challenge is no longer capability —
it is reliability. Organizations deploying AI in critical environments face persistent problems:
hallucinated outputs, lack of verification, limited accountability, and difficulty auditing
AI-driven decisions.

Harmony Verify is the missing trust infrastructure layer that lets organizations deploy AI with
confidence. It sits between an AI system and the professional acting on its output: credentialed
clinicians review the output against source evidence and return a signed, auditable record.

**Initial focus: healthcare AI.** Clinical decision support, ambient documentation, patient-facing
guidance and payer models — the domain with the least tolerance for a confident wrong answer. The
standard that holds here transfers to every other high-stakes field.

**Founder & CEO:** Affriee Darele Yvana

---

## Repository

A monorepo containing the public marketing site, the customer and expert applications, the
internal admin console, the backend API, and the domain engines they all share.

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
  config          Environment and secrets — the only reader of process.env  ✅ complete
  auth            Authorisation policy: areas, resources, route guards      ✅ complete
  database        SQLite schema, repositories, expert lifecycle gates       ✅ complete
  verification-engine  Triage, classification, report scoring               ✅ complete
  expert-matching Specialty routing, conflict and capacity rules            ✅ complete
  pricing-engine  Price and SLA calculation                                 ✅ complete
  applications    Expert and partner admission criteria                     ✅ complete
  payments        Paystack — a new payment page per charge                  ✅ complete
  ui              Status mapping and formatting (framework-agnostic)        ✅ complete
  ai-engine       Optional LLM refinement over deterministic rules          ✅ complete
  analytics       Aggregate quality metrics                                 ✅ complete
  notifications   Email composition and delivery                            ✅ complete
  cognitive-data  Failure taxonomy and calibration set                      ✅ complete

docs/             Architecture, configuration and decision records
tests/            Cross-package tests (160 passing)
scripts/          Repo tooling
infrastructure/   Deployment configuration
```

Status markers are accurate as of the latest commit. Every package listed `✅ complete` has
real source and compiles under strict TypeScript — there are no placeholder packages.

### A second product also lives here

**Les Délices de Grace Lumière** — the ordering system for a food and pastry business
(custom cakes, wedding cakes, celebration cakes, pizzas, quiches) — shares this repository
and its tooling, and nothing else: separate application, separate database, no shared code
with Harmony Verify.

```
apps/delices/               Storefront and admin console — static HTML/CSS/JS
packages/delices-core/      Types, order lifecycle, validation, money
packages/delices-db/        SQLite schema and repositories
packages/delices-server/    HTTP API and static host — no framework, no dependencies
```

```bash
pnpm run delices            # http://localhost:4100  ·  admin at /admin/
pnpm run delices:check      # link, metadata and accessibility check
```

Full architecture and operating guide: [`docs/delices.md`](docs/delices.md).

## Getting started

```bash
pnpm install          # install all workspace dependencies
pnpm run build        # build every package (turbo)
pnpm test             # run the test suite
pnpm typecheck        # type-check the whole repo
```

### The marketing site

Static on purpose — no bundler, no framework, no build step.

```bash
cd apps/web && python3 -m http.server 4000
# http://localhost:4000
```

Verify link and asset integrity without a browser:

```bash
node scripts/check-web.mjs
```

The same check enforces the consent invariants on every page: `consent.js` is
loaded and not deferred, a "Cookie preferences" control exists, and no
third-party or tracking script loads without being gated behind a consent
category. Pasting a vendor snippet into a page fails the build.

## Configuration

Copy `.env.example` to `.env` and fill it in. Every secret is read through
`packages/config`; nothing else in the codebase reads a credential from the
environment, and no secret is ever a literal in this repository.

See **[docs/configuration.md](docs/configuration.md)** for the full variable
list, the rules the codebase enforces, and what to do if a key is ever exposed.

## Deployment

Production deploys from `main` to Vercel. Configuration lives in `vercel.json` at the repository
root:

| Setting | Value | Why |
| --- | --- | --- |
| Root Directory | repository root | `vercel.json` must be visible to Vercel |
| Build Command | `pnpm run build:web` | syncs design tokens, then verifies site integrity |
| Output Directory | `apps/web` | the static site lives here, not at the repo root |
| Framework | none | plain static HTML |

`build:web` deliberately does **not** run the full `turbo run build`. The marketing site needs no
compiled output, so the deploy stays fast and cannot be broken by an unrelated package.

## Design tokens

`packages/design-system/src/tokens.ts` is the single source of truth for every colour, font stack
and spacing value.

```bash
pnpm tokens    # regenerate all consumers
```

That writes `packages/design-system/dist/tokens.css` for the app surfaces **and** rewrites the
`:root` block inside `apps/web/assets/css/main.css` in place, between the `/* @tokens:start */`
and `/* @tokens:end */` markers. The static site therefore stays buildless and adds no extra
network request, while remaining impossible to drift from the canonical tokens.

Never hand-edit the block between those markers — the next `pnpm tokens` overwrites it.

**Brand rule the tokens encode:** `#050F24` is the darkest surface in the system. Emphasis is
created by going *lighter* (`#071A3D` → `#0B2456`), never darker. Gold `#D4AF37` carries
attention; green and coral are reserved for resolved outcomes.

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

Business logic lives in `packages/*`, never in a page or a route handler. Apps compose engines;
they do not reimplement them.

## SEO

The site is static HTML, so there is no rendering problem for crawlers — every
page ships its content in the initial response. On top of that:

- Unique `<title>`, meta description and canonical on every page
- `Organization`, `WebSite` and `Service` JSON-LD on the homepage; `ProfilePage`
  and `Person` on the founder page; `FAQPage` on pricing; `BreadcrumbList` per page
- `sitemap.xml` and a `robots.txt` that keeps crawlers out of signed-in surfaces
- Google Search Console verification tag on every page
- `favicon.ico`, SVG favicon, Apple touch icon and a web manifest

### The site's own URLs come from one place

Every absolute URL the site publishes about itself — canonicals, `og:url`, the
JSON-LD, the sitemap and the `Sitemap:` line in `robots.txt` — is written by
`scripts/site-urls.mjs`, which runs as part of `build:web`.

```bash
SITE_URL=https://harmonyverify.org pnpm run site:urls
```

With no `SITE_URL` it falls back to `PUBLIC_BASE_URL`, then Vercel's production
domain, then the committed default. A Vercel build therefore publishes URLs for
the domain it is actually served from.

Two failures this exists to prevent, both invisible in a browser and both
reported by Search Console only as "your sitemap is wrong":

- **Host drift.** Four different files each carry a full URL. Change the domain
  by hand, miss one, and Search Console rejects the sitemap for containing URLs
  that are not on the property.
- **Extension drift.** `vercel.json` sets `cleanUrls: true`, so the server serves
  `/pricing` and redirects `/pricing.html`. A sitemap of `.html` URLs is a
  sitemap of redirects, and a canonical pointing at `.html` contradicts the URL
  Google actually fetched. The script derives the right form from the deployment
  config rather than assuming it.

`node scripts/check-web.mjs` fails the build if the sitemap mixes hosts, lists a
URL that would redirect, omits a page, disagrees with a canonical, or if
`robots.txt` advertises a sitemap on a different host.

**Contact addresses are separate and opt-in.** Mail is often hosted on a
different domain than the website, and rewriting `hello@` to a domain with no
mailbox behind it silently loses enquiries rather than failing loudly:

```bash
CONTACT_DOMAIN=harmonyverify.org pnpm run site:urls
```

**Still to do by hand:** add real social profile URLs to `sameAs` in the
homepage `Organization` schema once the accounts exist. An empty or invented
`sameAs` is worse than none.

## A note on claims

Site copy deliberately avoids stating security certifications, compliance attestations or
accuracy figures the company does not hold or cannot source. `apps/web/trust.html` publishes that
discipline as an explicit position. If a real certification is obtained, add it to the
data-handling table there with its actual scope and date — and not before.
