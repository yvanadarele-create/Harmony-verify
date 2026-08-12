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
| `@brandora/web` (`apps/brandora`) | The static front end |

Run everything:

```bash
pnpm install
pnpm build:brandora   # builds the packages, emits the front-end data, checks the site
pnpm test             # 391 tests
pnpm brandora         # serves apps/brandora on :4100
```

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

## What is not built yet

Stated plainly, because a specification section with no code behind it is not a
feature:

- **The AI runtime.** The prompts, the tool definitions, the reply contract and
  the validation are all built and tested. What is missing is the server route
  that holds `ANTHROPIC_API_KEY` and makes the call. `StrategyProvider` is the
  one interface to implement.
- **Persistence.** Every engine is pure and returns new values; nothing writes to
  PostgreSQL yet. The schema in §55 is expressed as the types in
  `@brandora/shared`, which is what the tables should be generated from.
- **Authentication, accounts and the admin dashboard.** The roles and the
  authorisation rules exist in the state machine; the screens and sessions do not.
- **Live AliExpress calls.** The adapter is written against the documented shape
  and tested against recorded payloads. **The signing scheme must be verified
  against current AliExpress documentation before the first live call** — the
  platform has shipped more than one, and the wrong one fails every request with
  "invalid signature". `signRequest` is exported so it can be checked against a
  known-good signature from the console.
- **Image and video generation.** The logo brief is generated and is written to
  be handed to a designer or an image model; nothing calls one.
- **Checkout, payments, notifications and the visualizer.** The order lifecycle
  and the notification keys are built; the screens and the payment integration
  are not.
