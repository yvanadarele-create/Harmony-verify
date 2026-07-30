# Configuration and secrets

Every secret the platform needs is read from the environment through
`packages/config`. Nothing else in the codebase touches `process.env` for a
credential, so there is one file to read to answer "what does this need to run?"
and one file to change when something moves.

## Setup

```bash
cp .env.example .env      # then fill in real values
```

`.env` is git-ignored. `.env.example` is committed and must only ever contain
placeholders.

| Variable | Required for | Notes |
| --- | --- | --- |
| `ADMIN_EMAIL` | Admin role assignment | Defaults to `yvanadarele@gmail.com`. Matched case-insensitively. |
| `PAYSTACK_SECRET_KEY` | Taking payment | `sk_test_…` locally, `sk_live_…` only in production. **Server-side only.** |
| `PAYSTACK_PUBLIC_KEY` | Checkout widget | Safe to expose. |
| `PAYSTACK_WEBHOOK_SECRET` | Verifying webhooks | Optional; falls back to the secret key, which is what Paystack signs with. |
| `PAYSTACK_CALLBACK_URL` | Post-payment redirect | Defaults to `${PUBLIC_BASE_URL}/payment/complete`. |
| `ANTHROPIC_API_KEY` | AI triage, site assistant | **Server-side only.** |
| `ANTHROPIC_MODEL` | AI triage, site assistant | Defaults to `claude-sonnet-5`. |
| `PAYOUT_ENCRYPTION_SECRET` | Encrypting expert bank details | 32 bytes, base64. Durable state — see below. |
| `SESSION_SECRET` | Signing sessions | 32+ random bytes. |
| `DATABASE_PATH` | Storage | Defaults to `./data/harmony.db`. |
| `PUBLIC_BASE_URL` | Absolute links | |

Generate the two cryptographic secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`PAYOUT_ENCRYPTION_SECRET` is not a throwaway. Rotating it without re-encrypting
the existing `payout_details` rows makes every stored account number permanently
unreadable. Treat it like a database, not like a session key.

## In production

Set these as **encrypted environment variables** in the Vercel project, not in a
file and not in `vercel.json`. Vercel exposes them to server functions at
runtime; they never reach a browser bundle.

## Rules this codebase enforces

**No secret is ever a literal in the repository.** This repository is public. A
key committed here is a key published to the world, and a `sk_live_` Paystack key
in particular can move real money. `packages/config` is the only place that reads
a credential, and every read goes through a function that fails loudly when the
variable is absent.

**No secret ever reaches the browser.** The Anthropic key is used by a server
route; the site assistant calls that route rather than the Anthropic API. The
Paystack secret key is used by `packages/payments` server-side; the browser only
ever sees a payment page URL. A test asserts that no key-shaped string appears in
any rendered page.

**Nothing is logged that looks like a credential.** `redact()` strips
`sk_live_…`, `sk_test_…`, `pk_…`, `sk-ant-…` and bearer tokens from any string
before it reaches a log. Paystack errors are reported by message only, and a
network failure is re-thrown as a `PaystackError` rather than propagating an
error object that may carry the request's `Authorization` header.

**A missing secret fails at the point of use.** `describeConfig()` reports which
variables are present — never their values — so a gap is visible at startup
rather than discovered by a customer at checkout. The platform still boots with a
gap, deliberately: a missing Anthropic key should not take payments down with it.

## If a key is ever exposed

Treat disclosure as compromise, regardless of where it appeared — a chat message,
a screenshot, a commit, a log. Rotate it immediately:

- **Paystack** — Dashboard → Settings → API Keys & Webhooks → *Generate new secret key*. The
  old key stops working as soon as the new one is issued. Check Transactions for
  anything you do not recognise.
- **Anthropic** — console.anthropic.com → Settings → API Keys → revoke, then create
  a new one. Check usage for calls you did not make.

Then update `.env` locally and the Vercel environment variables, and redeploy.

Rotating is cheap. Assuming a disclosed key was never used is not.
