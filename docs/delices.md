# Les Délices de Grace Lumière — V1

A food and pastry business run from one place: customers discover the creations and send
a request, Grace confirms availability and price, and the order moves through production
to the customer's hands. Custom cakes, wedding cakes, celebration cakes, pizzas, quiches
and whatever she adds next all live in the same system without being treated the same.

It is a separate application from Harmony Verify. Different database, different process,
no shared code — the two only share this repository and its tooling.

## What is here

```
apps/delices/               The storefront and the admin console — static HTML/CSS/JS
  index.html … 404.html     14 public pages
  admin/index.html          The admin console (hash-routed, one page)
  assets/                   Styles, page scripts, fonts, brand marks

packages/delices-core/      Types, the order lifecycle, validation, money
packages/delices-db/        SQLite schema and repositories
packages/delices-server/    HTTP API and static host (node:http, no framework)

scripts/check-delices.mjs   Link, metadata and accessibility check for the site
tests/delices-*.test.ts     50 tests: domain, database, HTTP
```

There are no runtime dependencies. The server is `node:http`, the database is
`node:sqlite`, the site is hand-written HTML — the same constraint the rest of the
repository follows, and one less thing to keep patched.

## Running it

```bash
pnpm install
pnpm run delices          # builds the three packages and starts the server
```

The site is then at `http://localhost:4100` and the admin at `http://localhost:4100/admin/`.

Configuration comes from the environment (see `.env.example`, section *Les Délices de
Grace Lumière*). The two that matter on day one:

```bash
DELICES_OWNER_EMAIL=grace@example.com
DELICES_OWNER_PASSWORD=un-mot-de-passe-solide   # 10 characters minimum
```

The owner account is created **only when the database has no users at all**, so a restart
never resets a password. Change it later from *Paramètres → Sécurité*.

To see the system with a catalogue in it, run once with `DELICES_SEED_DEMO=1`
(`pnpm run delices:demo`). It writes example products — clearly marked as examples — that
Grace renames, reprices or deletes. It never writes testimonials: those are hers to enter.

## The order lifecycle

```
NEW → REVIEWING → QUOTE_SENT → CONFIRMED → DEPOSIT_PAID → IN_PRODUCTION
    → READY → OUT_FOR_DELIVERY → COMPLETED            (CANCELLED from anywhere open)
```

The machine says which moves are coherent; it never makes one on its own. Two shortcuts
are deliberate, because the business needs them:

- **DEPOSIT_PAID is optional.** A confirmed order can go straight into production for a
  regular who pays on collection.
- **READY can complete directly.** Not every delivery goes through OUT_FOR_DELIVERY —
  plenty are handed over at the door.

Invalid moves are refused by the API with a 409 and a French explanation, and every
transition is written to `order_events`, so an order always carries its own history.

## Standard order vs custom request

This distinction runs through the whole system, and it is the reason the site does not
feel like a form factory.

|                | Standard (pizza, quiche, a listed cake) | Custom (wedding cake, personalised creation) |
| -------------- | --------------------------------------- | -------------------------------------------- |
| Customer path  | size → quantity → basket → send          | brief: occasion, date, servings, shape, flavour, filling, colours, decoration, message, inspiration photo, requirements |
| Price          | resolved from the catalogue, shown as indicative | none — `quoted_total` stays null |
| Grace's step   | confirm availability and total           | study the brief, then send a quote            |
| Same row?      | yes — one `orders` table, `kind` tells them apart |

Both start at `NEW`. Nothing is ever charged automatically, and no order is auto-accepted:
the customer asks, Grace answers. That is the point.

## Prices and money

Amounts are stored as integers in the currency's **minor unit**, and the number of minor
digits is asked of `Intl` rather than assumed to be two — so the same code is correct for
EUR (cents) and for XAF (no subdivision). The currency and the locale are settings.

The browser never sends a price. It sends product and option ids; the server re-prices
every line from the catalogue at the moment of ordering. A tampered request cannot buy a
cake for one franc — there is a test for exactly that.

## The admin console

`/admin/` covers: tableau de bord, commandes (list, detail, status, quote, payment,
internal notes, extra lines), calendrier de production, clients with their history,
produits, catégories, options & choix, photos, témoignages, stock, fournisseurs,
rendez-vous, notifications and paramètres.

Things worth knowing:

- **Categories are rows, not code.** Add "Desserts", "Pâtisseries", "Traiteur", "Boissons"
  or "Plateaux salés" from *Catégories* and they appear as real categories with their own
  products. Nothing about "gâteaux, pizzas, quiches" is hard-coded.
- **The custom-cake choice lists are editable.** *Options & choix* with no product
  selected edits the occasions, shapes, flavours, fillings and decorations offered in
  "Créer mon gâteau".
- **Contact details are settings.** Phone, WhatsApp, e-mail, address, hours, social links,
  currency, lead time and the announcement banner are entered once in *Paramètres* and
  used everywhere. `check-delices.mjs` fails the build if a phone number is hard-coded
  into a page.
- **The calendar counts, it does not refuse.** Busy days are highlighted; whether a
  Saturday with four wedding cakes is full is Grace's judgement, not a constant.
- **Stock alerts at the minimum**, not below it. Recipe-based deduction is out of scope
  for V1; the `product_ingredients` table is the seam it will need.

## Notifications

Every submission writes two messages to an outbox: an acknowledgement for the customer
("Merci pour votre demande…") and the full brief for Grace. Delivery is a `Transport`
interface with a store-only implementation in V1, so a missing SMTP configuration can
never swallow an order — the owner's copy is always visible under *Notifications*.

Adding real e-mail later means writing one `Transport`, not touching the order code.

## Security posture

- Customers never get an account; a phone number identifies a person. The trailing digits
  are what match, so `+33 6 12 34 56 78` and `06 12 34 56 78` are one customer.
- Admin sessions are opaque server-side tokens in an `HttpOnly`, `SameSite=Strict` cookie;
  passwords are scrypt hashes kept in a table separate from `users`. Set
  `DELICES_SECURE_COOKIES=1` behind HTTPS.
- Admin mutations additionally require an `X-Delices-Admin` header, which a cross-site
  form cannot set — the CSRF story for V1.
- Public writes are rate-limited per IP. Uploads are capped at 6 MB, checked against the
  file's own magic bytes (not its name), stored under a generated filename, and served
  from outside the web root.
- Order tracking needs the reference **and** the phone number that placed it, and returns
  a stripped view: no internal notes, no personal details.
- Everything the browser writes to the page goes in as text, never as markup.

## Deliberately not in V1

Online payments, automatic pricing, recipe-based stock deduction, delivery routing,
WhatsApp automation, loyalty, birthday reminders, recurring orders, multi-location,
advanced analytics. The schema leaves room for them (payment status is recorded today,
categories are data, the bill-of-materials table exists) but none of it is built, because
none of it is needed to run the business well next week.

## Photography

The site ships without photographs. Product cards and the gallery fall back to a petal
motif in the brand's palette until Grace uploads her own images from *Photos* — inventing
food photography for a real business would misrepresent what she makes. Uploads are
served with `loading="lazy"`, explicit dimensions and long cache headers; server-side
resizing would need an image library and is left for later.

`apps/delices/assets/img/logo.svg` is a placeholder wordmark in the brand's palette and
type. Replacing that one file with the official artwork is the whole change.

## Operations

- **State that matters:** `DELICES_DB` (the SQLite file) and `DELICES_UPLOAD_DIR` (the
  images). Back them up together; the database references the files by name.
- **Checks:** `pnpm run delices:check` validates every internal link, asset, label, id and
  page-script hook without a browser. `pnpm test` runs the 50 tests.
- **Deployment:** the site needs a Node process — it is not a static host. The Vercel
  configuration at the repository root still builds and deploys the Harmony Verify
  marketing site only; deploying this application is a separate step.
