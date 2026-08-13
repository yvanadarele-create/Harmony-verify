# Deploying Brandora

Brandora and Harmony Verify are unrelated products that share a repository. This
document covers how they stay apart, how to run Brandora, what to set, and the
one architectural decision that has to be made before real customers use it.

---

## Read this first: where the data lives

Brandora is **one Node process that serves the site and the API from one
origin**, storing its data in SQLite on the local filesystem. That is a good fit
for a single small server and a bad fit for serverless, because a serverless
function's filesystem does not survive between invocations.

So there are two deployment shapes, and they are not equivalent:

| | Long-lived process (recommended) | Vercel serverless |
| --- | --- | --- |
| Site | served by the same process | served by Vercel's CDN |
| API | same process | `apps/brandora/api/index.js` |
| Accounts, brands, orders | **persist** | **do not persist between cold starts** |
| Suitable for | production | the marketing pages, and a demo API |
| Verified here | yes — the full journey was driven in a browser against it | no — no deploy was run from this environment |

**If you deploy to Vercel as it stands, a customer can create an account, build
a brand and place an order, and a later request may find none of it.** The
function answers correctly; the disk underneath it is thrown away. Nothing in
the code hides this, and nothing in the code can fix it — it is a property of
the storage.

Two honest ways forward:

1. **Run the long-lived process** on any host that gives you a disk — a small
   VPS, Railway, Render, Fly, Hetzner. This is the shape that was built and
   tested, and it needs no code changes.
2. **Keep Vercel and move the database.** `@brandora/database` is one file of
   SQL and one file of repositories behind a `Repositories` interface. Porting
   it to a hosted Postgres is a contained piece of work — every query is in
   `packages/brandora-database/src/repositories.ts` and nothing above it knows
   what the storage is. **This has not been done.**

---

## Running it

```bash
pnpm install
pnpm run build:brandora     # builds the packages, emits the front-end data, checks the site
pnpm run brandora           # serves apps/brandora and /api/* on :4100
```

The server needs `BRANDORA_AUTH_SECRET` and refuses to start without it. That is
deliberate: a development fallback for a signing secret is a fallback that
reaches production, and a known signing secret lets anyone mint a session for
any account.

```bash
export BRANDORA_AUTH_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
export BRANDORA_DATABASE_PATH=./data/brandora.db
export BRANDORA_PUBLIC_BASE_URL=https://your-domain
pnpm run brandora
```

Put a TLS terminator in front of it (Caddy, nginx, or your host's). The session
cookie is marked `Secure` automatically unless `BRANDORA_PUBLIC_BASE_URL` starts
with `http://`.

### Making the first administrator

There is no route that grants a role — by design, so no request can escalate
one. Promote the first admin directly:

```bash
node -e "
  const { openDatabase, createRepositories } = require('@brandora/database');
  const repos = createRepositories(openDatabase(process.env.BRANDORA_DATABASE_PATH));
  const user = repos.users.findByEmail(process.argv[1]);
  if (!user) throw new Error('no such account — sign up first');
  repos.users.setRole(user.id, 'admin');
  console.log('promoted', user.email);
" you@example.com
```

---

## Environment variables

### Required

| Variable | What it does | If unset |
| --- | --- | --- |
| `BRANDORA_AUTH_SECRET` | Signs session cookies | **The server refuses to start** |

### Needed for the product to be complete

| Variable | What it does | If unset |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Writes brand strategy | Generation **fails with a clear message**. It does not invent a brand |
| `PAYSTACK_SECRET_KEY` | Takes payment | Orders are placed and sit at `pending` until an admin confirms an arranged payment |
| `ALIEXPRESS_APP_KEY` / `_APP_SECRET` / `_ACCESS_TOKEN` / `_REFRESH_TOKEN` | Live supplier sourcing | The catalogue serves Brandora's own product layer; no supplier call is made |

### Everything else has a working default

| Variable | Default | Notes |
| --- | --- | --- |
| `BRANDORA_DATABASE_PATH` | `./data/brandora.db` | Separate from Harmony's on purpose |
| `BRANDORA_PUBLIC_BASE_URL` | `http://localhost:4100` | Must match what the browser sees — it is the payment return URL |
| `BRANDORA_STATIC_ROOT` | `./apps/brandora` | |
| `BRANDORA_DEFAULT_CURRENCY` | `XOF` | Zero-decimal; see `money.ts` |
| `BRANDORA_MARGIN_RATE` | `0.35` | |
| `BRANDORA_LOGISTICS_RATE` | `0.08` | |
| `BRANDORA_DELIVERY_FLAT` | `3000` | Minor units. For XOF, whole francs |
| `BRANDORA_DELIVERY_PER_KG` | `1200` | |
| `BRANDORA_ROUNDING_STEP` | `100` | Always rounds up |
| `BRANDORA_SOURCING_SMALL_MAX` | `50` | |
| `BRANDORA_SOURCING_MEDIUM_MAX` | `500` | |
| `BRANDORA_SUPPLIER_CACHE_TTL_MINUTES` | `360` | |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | |
| `ALIEXPRESS_ENDPOINT` | `https://api-sg.aliexpress.com/sync` | |
| `PAYSTACK_ENDPOINT` | `https://api.paystack.co` | |

Never put a value for any of the secret ones in a file, a screenshot, a chat
message or a commit. If one has ever appeared in any of those, rotate it in the
provider's console before doing anything else.

---

## Vercel

### The manual step — this cannot be done from code

`vercel.json` at the repository root is **Harmony's**: it sets `outputDirectory`
to `apps/web`. Editing it would take the Harmony site down. Brandora ships its
own `apps/brandora/vercel.json`, which Vercel reads only when a project's **Root
Directory** is set to `apps/brandora`.

In the Vercel dashboard:

1. **Add New → Project**, and import this same repository again.
2. Name it `brandora`.
3. Open **Settings → General → Root Directory**, click **Edit**, and set it to
   `apps/brandora`. Save.
4. Leave **Framework Preset** as **Other**. Build and install commands come from
   `apps/brandora/vercel.json`; do not override them.
5. Open **Settings → Environment Variables** and add, for **Production**,
   **Preview** and **Development**:

   | Name | Value |
   | --- | --- |
   | `BRANDORA_AUTH_SECRET` | a fresh 32-byte base64 string — generate it locally, paste it here, and nowhere else |
   | `BRANDORA_PUBLIC_BASE_URL` | `https://<your-vercel-domain>` |
   | `BRANDORA_DATABASE_PATH` | `/tmp/brandora.db` — the only writable path on Vercel, **and it is discarded** |
   | `ANTHROPIC_API_KEY` | your key, if brand generation should work |
   | `PAYSTACK_SECRET_KEY` | your key, if checkout should take payment |
   | `ALIEXPRESS_APP_KEY` | if live sourcing should work |
   | `ALIEXPRESS_APP_SECRET` | " |
   | `ALIEXPRESS_ACCESS_TOKEN` | " |
   | `ALIEXPRESS_REFRESH_TOKEN` | " |

6. **Deploy.**

Adding a variable is: **Settings → Environment Variables → Add New →** type the
name, paste the value, tick all three environments, **Save**. Then
**Deployments → ⋯ → Redeploy**, because environment changes do not apply to an
existing build.

### What you will get, honestly

The static site — landing, catalogue, every page — will work. `/api/*` will
answer. And the database will be gone by the next cold start, per the table at
the top of this document. **The Vercel path has not been deployed or verified
from this environment**; the configuration is written against Vercel's
documented behaviour, not against a run.

---

## What is separate, and what is shared

**Code.** Brandora has no dependency on Harmony in either direction:

```bash
grep -rn "@harmony/" packages/brandora-*/src packages/brandora-*/package.json apps/brandora
# no matches
```

Either product could move to its own repository by copying `packages/brandora-*`,
`apps/brandora`, its tests and its scripts. Nothing would need rewriting.

**Shared, and harmlessly so:** the pnpm workspace and lockfile, `turbo.json`
(generic task names), `tsconfig.base.json` (compiler settings), and
`.env.example` (documents both, in separate sections; each product reads only
its own variables at runtime).

**Not shared:** `pnpm build:brandora` and `pnpm build:web` build different
package sets. Brandora's tests are `tests/brandora-*.test.ts`. Harmony's are
untouched.

---

## Before the first live supplier call

`signRequest` in `packages/brandora-sourcing/src/aliexpress.ts` implements
HMAC-SHA256 over the sorted `key + value` concatenation, uppercase hex, declared
as `sign_method=hmac-sha256`.

**This has not been verified against AliExpress's own documentation** — the
developer portal is unreachable from the environment this was written in. The
platform has shipped more than one scheme (an MD5 variant wrapping the payload
in the secret, an HMAC-MD5 one, and this one), and the wrong choice fails every
request with "invalid signature".

`signRequest` is exported and pure, so checking it costs one call:

```js
import { signRequest, SIGN_METHOD } from '@brandora/sourcing';
// Compare against a known-good signature from the AliExpress console.
```

Until that check is done, leave the AliExpress variables unset. Brandora serves
its own product layer and makes no supplier call.
