# Harmony Verify — website

Marketing site for Harmony Verify, clinical verification infrastructure for healthcare AI.

Static HTML, CSS and vanilla JavaScript. No build step, no dependencies, no framework. Open
`index.html` in a browser and it works.

## Structure

```
index.html          Home
platform.html       How verification works — pipeline, rubric, API, reviewer network, FAQ
solutions.html      Four buyer segments: CDS, documentation, patient-facing, health system/payer
trust.html          Data handling, reviewer integrity, regulatory context, claims discipline
company.html        Thesis, principles, founder, clinician recruitment
contact.html        Access request form
404.html            Not found

assets/css/main.css Design system — tokens, components, responsive, reduced motion
assets/js/main.js   Nav, scroll reveals, verification-record walkthrough, form handling
assets/img/         Logo mark (SVG), favicon, apple touch icon, OG image, original logo

robots.txt
sitemap.xml
```

## Running locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying

Any static host works — Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3. Point it at the
repository root. There is nothing to build.

For GitHub Pages: repository settings → Pages → deploy from branch, root directory.

## Before you launch

These need real values. Each is a placeholder today.

| Item | Where | Notes |
| --- | --- | --- |
| Contact email | `contact.html`, `assets/js/main.js` | Currently `hello@harmonyverify.org` |
| Domain | All pages — `<link rel="canonical">`, OG tags, `sitemap.xml`, `robots.txt` | Currently `harmonyverify.org` |
| Calendly link | `assets/js/calendly.js` — `SCHEDULING_URL` | Set: the "30 Minute Meeting" event. See below |
| Form backend | `contact.html` | See below |
| Legal pages | Footer | Privacy policy and terms are not yet written |

### Wiring up Book a demo

Every "Book a demo" control on the site carries `data-book-demo`, and one file decides what they do:

```js
// assets/js/calendly.js
var SCHEDULING_URL = "https://calendly.com/yvanadarele/30min";
```

That is the account's "30 Minute Meeting" event, hosted on Zoom. Every control opens it — header,
hero, final CTA, the enterprise tier on pricing, and the footer — so there is one link to change,
not nine. Empty it and they fall back to ordinary links to the contact page, which is what ships
before a link is configured: the site never offers a button that opens an empty scheduler.

Nothing about scheduling lives in this repository: no slots, no calendar, no confirmation email.
Calendly owns the booking and the confirmation that follows it. Their script is fetched on the first
click and never again — it is deliberately not a `<script>` tag in the pages, so a visitor who never
asks to book never loads a third party or gets its cookies.

### Wiring up the contact form

The form has no backend. With no endpoint configured it falls back to opening the visitor's mail
client with the fields filled in — functional, but you will lose submissions from anyone without a
configured mail client.

To connect a real backend, add `data-endpoint` to the `<form>` element in `contact.html`:

```html
<form class="form" data-form data-endpoint="https://formspree.io/f/XXXXXXX" ...>
```

Any service accepting a `POST` of `FormData` and returning a 2xx will work — Formspree, Basin,
Netlify Forms, or your own handler.

**Do not accept protected health information through this form.** The form copy says so explicitly,
and it should stay that way unless the endpoint is covered by a business associate agreement.

## A note on claims

The copy deliberately avoids stating security certifications, compliance attestations or accuracy
percentages that Harmony Verify does not currently hold or cannot source. `trust.html` makes that
discipline an explicit, published position.

If you later obtain a real certification (SOC 2, ISO 27001, HITRUST), add it to the data-handling
table in `trust.html` with its actual scope and date. Until then, claiming it is a material
misrepresentation to healthcare buyers — the audience most likely to check.

## Brand

| Token | Value |
| --- | --- |
| Navy (base) | `#050F24` |
| Navy (deep) | `#03081A` |
| Gold | `#D4AF37` |
| Verified | `#48C79A` |
| Review | `#E0A93B` |
| Flagged | `#E8735C` |

Display type is Newsreader, body is IBM Plex Sans, data and labels are IBM Plex Mono, all loaded
from Google Fonts with system fallbacks.

The logo mark in `assets/img/mark.svg` is a vector reconstruction of the Harmony interlocking
infinity mark, so it stays sharp at favicon size. The original supplied artwork is kept at
`assets/img/harmony-logo.jpg`.
