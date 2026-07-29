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
  database        SQLite schema, repositories, audit log                    ✅ complete
  verification-engine  Triage, classification, report scoring               ✅ complete
  expert-matching Specialty routing, conflict and capacity rules            ✅ complete
  pricing-engine  Price and SLA calculation                                 ✅ complete
  ui              Status mapping and formatting (framework-agnostic)        ✅ complete
  ai-engine       Optional LLM refinement over deterministic rules          ✅ complete
  analytics       Aggregate quality metrics                                 ✅ complete
  notifications   Email composition and delivery                            ✅ complete
  cognitive-data  Failure taxonomy and calibration set                      ✅ complete

docs/             Architecture and decision records
tests/            Cross-package tests (29 passing)
scripts/          Repo tooling
infrastructure/   Deployment configuration
```

Status markers are accurate as of the latest commit. Every package listed `✅ complete` has
real source and compiles under strict TypeScript — there are no placeholder packages.

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

## Pending assets

| Asset | Where | Status |
| --- | --- | --- |
| `apps/web/assets/img/founder.jpg` | Founder profile, `company.html` | Awaiting file. Falls back to an "AY" monogram, so the page is never broken. |

To supply the founder portrait, drop the file in and it appears automatically — no code change:

```bash
cp /path/to/portrait.jpg apps/web/assets/img/founder.jpg
```

Square or portrait crop, at least 400×400. Displayed as a 132px circle, focal point biased
slightly above centre for head-and-shoulders framing.

## A note on claims

Site copy deliberately avoids stating security certifications, compliance attestations or
accuracy figures the company does not hold or cannot source. `apps/web/trust.html` publishes that
discipline as an explicit position. If a real certification is obtained, add it to the
data-handling table there with its actual scope and date — and not before.
