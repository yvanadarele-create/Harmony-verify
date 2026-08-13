# Brandora

**Build your brand. Put it everywhere.**

Brandora takes a person who has an idea and no brand, and gets them to a physical
branded product they can sell:

```
IDEA → BRAND → LOGO → PRODUCT → SUPPLIER → SHIPPING → QUOTE → ORDER → TRACKING
```

This document covers what is built, how it is arranged, and what is not built yet.

## Architecture

The critical rule is that AliExpress is a *sourcing infrastructure provider*, not
the product. Everything above the adapter speaks Brandora's own vocabulary, so a
second supplier is one new file rather than an audit of the codebase.

```
                        BRANDORA
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
  BRAND ENGINE        AI SURFACE       SOURCING ENGINE
        │                  │                  │
        │                  │          SupplierAdapter
        │                  │            ├── AliExpressAdapter
        │                  │            └── (future suppliers)
        └──────────────────┼──────────────────┘
                           ↓
                     PRODUCT LAYER
                           ↓
                    PACKAGE BUILDER
                           ↓
                         QUOTE
                           ↓
                         ORDER
```

## Packages

| Package | What it owns |
| --- | --- |
| `@brandora/shared` | Domain types, multi-currency money, prefixed ids, the customer/admin error split |
| `@brandora/config` | The only module that reads a credential from the environment |
| `@brandora/i18n` | English, French and Spanish catalogues, typed for completeness |
| `@brandora/brand-engine` | The interview, strategy prompting and validation, palette, typography, logo brief, brand kit |
| `@brandora/catalog` | The Brandora product layer, quantity and customisation filters, the package builder |
| `@brandora/sourcing` | `SupplierAdapter`, the AliExpress adapter, the sourcing agent, scoring, freight, landed cost, caching |
| `@brandora/quotes` | The quote engine and the order state machine |
| `@brandora/database` | SQLite schema and repositories; ownership lives in the query |
| `@brandora/auth` | scrypt password hashing, session lifecycle, authorization policy |
| `@brandora/ai` | The Anthropic-backed `StrategyProvider` and the generation flow |
| `@brandora/server` | The HTTP layer, the authoritative price, payments, and every API route |
| `@brandora/web` (`apps/brandora`) | The front end |

Run everything:

```bash
pnpm install
pnpm build:brandora   # builds the packages, emits the front-end data, checks the site
pnpm test             # 543 tests
pnpm brandora         # serves apps/brandora and /api/* on :4100
```

`BRANDORA_AUTH_SECRET` is required and has no development fallback. See
[`brandora-deployment.md`](./brandora-deployment.md).

## Decisions worth knowing

**Money is integer minor units, and the exponent is per currency.** FCFA/XOF has
*no* decimal places. Code that assumes `cents = amount × 100` multiplies every
West African price by a hundred. `packages/brandora-shared/src/money.ts` is the
only place that knows this, and `DEFAULT_CURRENCY` is one constant.

**Supplier prices are converted, never adopted.** A supplier quotes 0.42 USD; the
customer is quoted in FCFA. `SupplierOffer.unitCost` can only be constructed
through a `RateSource`, so there is no path that treats 0.42 as 0.42 FCFA. The
rate used is recorded, because a quote must be reconstructable during a dispute.

**Missing information never scores as good news.** A supplier that publishes no
delivery estimate scores neutral, not fast. A product whose listing says nothing
about branding is `unknown`, not customisable. Brandora shows "Delivery estimate
unavailable" rather than a plausible date.

**The palette is derived, not generated.** Contrast, print legibility and a
working surface/ink pair are constraints a language model satisfies by luck.
Every palette Brandora emits is checked against WCAG AA before it is returned,
and "regenerate" is a seeded variation so it is reproducible. The model writes
the words; it does not pick the hex.

**The browser runs the same identity code as the server.** `identity.js` and
`color.js` are copied from the compiled brand engine into
`apps/brandora/assets/js/generated/`, so the palette in the preview is the
palette in the downloaded brand kit. The copy step fails the build if either
file grows an import a browser could not resolve.

**Money leaves Brandora only when an admin moves it.** There is no transition
into `supplier-processing` that a customer action can reach, and the state
machine enforces it rather than the interface.

## Security

Every rule in §29 and §61 of the specification has a test in
`tests/brandora-security.test.ts`:

- Credentials are read only by `@brandora/config`, only from the environment.
- The admin integrations page returns masks, never values. There is no variant
  that returns the real value "just for the admin screen".
- Anything bound for a log passes through `redact()`, which is pattern-based:
  it catches the signed query strings and bearer tokens suppliers echo back in
  their error bodies, including ones nobody registered.
- Customers see a sentence they can act on; the supplier's error code goes to
  the admin.
- A test walks the repository and fails on any credential-shaped assignment, and
  a second walks `apps/brandora` and fails if a page or script so much as names a
  secret variable.

### Rotating the AliExpress credentials

If the App Secret, Access Token or Refresh Token has ever appeared in a chat
message, an issue, a screenshot or a commit, treat it as public and rotate it in
the AliExpress console. The Refresh Token matters most — it outlives the Access
Token, so a leak of it is a leak of the integration until it is revoked.

## Persistence, auth and AI

**Persistence** is SQLite via Node 22's built-in `node:sqlite` — the same choice
Harmony made, and for the same reasons: no dependency, no native build step, no
connection pool to misconfigure. The schema declares its own constraints, so an
order pointing at a missing quote or a status nobody defined is impossible to
persist rather than merely unlikely.

The rule that shapes every read: **ownership is part of the query, not a check
after it.** `findProject(id)` followed by `if (project.userId !== me) throw` is
the shape that produces IDOR bugs, because the next person to add a route will
remember the first line and forget the second. The customer methods take an
owner and put it in the `WHERE` clause — another user's project is not found and
rejected, it is simply not found. Admin reads are named `…AsAdmin` so an
unscoped query is impossible to write by accident and obvious in review.

**Auth** is scrypt with a per-password salt and timing-safe comparison, plus
server-side sessions rather than JWTs — a session row can be revoked instantly,
which is what "log out everywhere" and "this account is compromised" both need.
Verifying a password for an address that does not exist burns the same work as a
real one, so login cannot be used to enumerate accounts.

Authorization is a pure function over a principal and a resource, in one file.
A refused cross-user read returns **404, not 403** — a 403 confirms the id is
real, which is exactly what someone enumerating ids wants.

**AI** is the official Anthropic SDK behind the `StrategyProvider` interface the
brand engine already defined. The key is read by `@brandora/config` and never
leaves the process. Three things the provider does that are easy to get wrong:
it checks `stop_reason` **before** reading content (a refusal returns HTTP 200
with empty content, so indexing `content[0]` throws a `TypeError` and reports a
policy decline as a crash); it treats a `max_tokens` stop as a failure with its
real cause named, rather than letting a truncated reply blame the model at the
JSON parser; and it maps SDK error *classes* rather than message text, because
wording changes between releases and status codes do not.

With no key configured, `UnconfiguredStrategyProvider` **fails** with a clear
admin message. It does not fabricate a brand — a provider that invents a
plausible name and story is exactly what makes a demo look finished and a launch
fail.

## The server

One process serves the site and the API from one origin. That is what lets the
session live in an HttpOnly cookie the page's JavaScript cannot read, rather
than in `localStorage`, where any injected script can take it — and it removes
CORS, preflights and a second deployment along the way.

Three rules run through every route, and they are structural rather than
procedural — there is no request shape that breaks them:

**The session names the user.** No route reads a `userId` from a body or a query
string. `requireUser` returns the row the cookie resolved to, and that id is
what goes into the `WHERE` clause.

**Ownership is a filter, not a check.** `findProject(id)` followed by
`if (project.userId !== me) throw` is the shape that produces IDOR bugs, because
the next person to add a route remembers the first line and forgets the second.
Reads take an owner and put it in the query, so another customer's project is
*not found* — and a cross-user read returns **404, not 403**, because a 403
confirms the id is real.

**Money is recomputed, never accepted.** `packages/brandora-server/src/pricing.ts`
has no function that accepts a price, a subtotal or a total. A client sends
product ids, quantities and a customisation choice — three facts about intent.
Checkout reads the amount from the stored quote; verification refuses to settle
when the provider reports a different figure, and marks the payment `mismatch`.

`tests/brandora-server-security.test.ts` scans the route file and fails if any
of those three ever stops being true, which is the part that survives the next
twenty routes.

## The browser holds nothing

`localStorage` holds a theme, a locale, which project is on screen, and the
interview while it is still being typed — the last of which is a half-filled
form, not a record. Brands, packages, quotes and orders are fetched from the
server on every load, so signing in on a different phone shows the same thing
and clearing a browser loses nothing. A test enumerates every storage key the
front end writes and fails on anything else.

The browser also never does currency arithmetic. Money crosses the wire as an
integer *and* a formatted string, because a front end that divides by 100 turns
15 000 FCFA into 150.

## Payments

Env-based Paystack, with the amount read from the stored quote at every step.
The `payments` row records what was charged at initialisation, and verification
compares the provider's figure against it — a difference is a tampered payment,
refused rather than reconciled. Paystack takes amounts in the currency's
smallest unit, which is exactly what `Money.amount` holds, including for XOF
where the smallest unit *is* the franc. There is no `× 100` anywhere in that
file; it is the most expensive bug available in a West African checkout.

With no key configured, Brandora does not fabricate a charge. The order is
placed and sits at `pending` until an administrator confirms an arranged
transfer — an honest state a business can operate in, and how a great many
orders in this market are actually settled.

## What is not built yet

Stated plainly, because a specification section with no code behind it is not a
feature:

- **Durable storage on serverless.** SQLite on a local disk is the right choice
  for one long-lived process and the wrong one for Vercel's filesystem. See
  [`brandora-deployment.md`](./brandora-deployment.md) — this needs a decision,
  not a workaround.
- **Live AliExpress calls.** The adapter is written against the platform's
  published algorithm and tested against recorded payloads. **The signing scheme
  has not been verified against AliExpress's own documentation** — the developer
  portal was unreachable from the environment this was written in. Check
  `signRequest` against a known-good signature from the console before the first
  live call.
- **The Paystack webhook route.** `paystackSignatureValid` is implemented and
  tested; nothing yet mounts it as an endpoint. Payment is confirmed by the
  customer's return to the order page, which verifies server-side — the webhook
  would make that robust against a customer who closes the tab.
- **Logo and image generation.** The logo brief is generated and written to be
  handed to a designer or an image model. The brand book shows the monogram in
  the brand's own typeface and colours, and says that is what it is. Nothing
  calls an image model.
- **The brand-kit download as a zip.** The guidelines document is generated and
  downloadable as Markdown; the manifest lists what a full kit would contain.
- **Notifications.** The keys and the order lifecycle are built; no email or
  WhatsApp integration sends anything.
- **Trends and social intelligence.** Not started.

## Deployment

Brandora and Harmony share a repository but no code. See
[`brandora-deployment.md`](./brandora-deployment.md) for what is already
separate, the one manual step in the Vercel dashboard, and how to split the
repositories if you would rather.
