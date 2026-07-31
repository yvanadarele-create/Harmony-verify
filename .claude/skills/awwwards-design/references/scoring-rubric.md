# Scoring rubric — concrete signals

Rate each criterion 0–10. Start from the baseline, then move it with observed evidence.
Every adjustment needs something you actually saw in the code or the rendered page.

---

## DESIGN — 40%

*Visual aesthetics, layout, typographic hierarchy, grid discipline.*

**Baseline 7.0** — competent, unremarkable, nothing broken.

Moves it up:

- **+1.0 Grid is legible.** A consistent column/gutter system you could draw on top of the
  page. Elements align to it across sections, not just within one.
- **+0.8 Typographic hierarchy is unambiguous.** Three to five distinct levels, each earned by
  scale/weight/space rather than colour tricks. Reading order is obvious at a squint.
- **+0.7 Mathematical spacing.** A visible scale (a ratio or a token ramp) instead of hand-picked
  pixel values. Vertical rhythm survives across breakpoints.
- **+0.5 Deliberate density.** Whitespace distributed with intent — generous where the eye rests,
  tight where things belong together. Uniform padding everywhere is a 7.
- **+0.5 Restrained palette with one clear accent** carrying attention where it matters.
- **+0.4 Detail craft.** Optical alignment, hanging punctuation, tuned tracking on display sizes,
  no orphaned line endings in headlines.

Moves it down:

- **−1.0 Broken alignment** — items off-grid with no compensating logic.
- **−0.8 Flat hierarchy** — everything roughly the same size and weight.
- **−0.6 Accent inflation** — the accent colour on five unrelated things, so it marks nothing.
- **−0.5 Default-y type** — system-stack body at 16/1.5 with no measure control, lines running
  past ~75 characters.
- **−0.5 Divider soup** — boxes and rules doing the work type should do.

---

## USABILITY — 30%

*Navigation, clarity, functional efficiency, accessibility.*

**Baseline 7.5** — it works; nothing surprising.

Moves it up:

- **+1.0 Orientation is never in question.** Current location, available paths and the way back
  are all visible without hunting.
- **+0.8 Scannability.** Left-aligned text, meaningful headings, front-loaded link labels. The
  page yields its structure in a three-second skim.
- **+0.7 Accessible by construction.** Semantic landmarks, visible focus rings, AA contrast on
  every text/background pair, ≥44px targets, `prefers-reduced-motion` honoured.
- **+0.5 Responsive without degradation** — the mobile layout is a designed state, not a
  collapsed desktop one.
- **+0.5 States are handled** — loading, empty, error, disabled all designed rather than default.
- **+0.4 Fast.** No layout shift, no blocking font swap flash, interaction feedback under 100ms.

Moves it down:

- **−1.5 Any AA contrast failure on body text.** Non-negotiable; it caps Usability at ~6.
- **−1.0 Keyboard traps or suppressed focus outlines** (`outline: none` with no replacement).
- **−0.8 Motion that blocks reading** — scroll-jacking, long entrance delays before content.
- **−0.6 Mystery-meat navigation** — icon-only controls without labels or accessible names.
- **−0.5 Cumulative layout shift** on load.

---

## CREATIVITY — 20%

*Innovation, originality, a point of view.*

**Baseline 8.0** when a coherent system is visibly applied — systematic thinking is itself
creative work. **Baseline 6.5** when the page is assembled from defaults.

Moves it up:

- **+1.0 A memorable idea** you could describe in one sentence to someone who hasn't seen it,
  and that idea shapes the layout rather than decorating it.
- **+0.7 Signature detail** — a transition, a cursor state, a reveal, one thing that is *this*
  site's and not a library default.
- **+0.5 Content-derived form.** The layout comes from what the content is, not from a template
  the content was poured into.
- **+0.5 Constraint pushed further than expected** — an unusually narrow measure, an extreme
  scale jump, a near-monochrome field — held consistently.

Moves it down:

- **−1.5 Template smell** — a recognisable hero/three-cards/CTA skeleton with the copy swapped.
- **−1.0 Trend cosplay** — this year's effect applied without reason (see the anti-pattern list
  in `premium-patterns.md`).
- **−0.5 Novelty that fights the content** — clever at the cost of comprehension. It also costs
  Usability twice over, at 30% weight.

---

## CONTENT — 10%

*Information quality, meaningful organisation.*

**Baseline 7.5.**

Moves it up:

- **+1.0 Specific over generic.** Real numbers, real names, real claims. "Verification in 4
  hours, 312 clinicians" beats "fast and trusted".
- **+0.5 Ordering reflects reader priority**, not internal org structure.
- **+0.5 Copy carries voice** consistent with the visual register.
- **+0.4 Nothing decorative** — no lorem, no filler section existing only to fill a grid slot.

Moves it down:

- **−1.0 Placeholder or unfalsifiable marketing copy** ("world-class", "seamless", "innovative").
- **−0.5 Redundant sections** restating the same claim in new packaging.

---

## Reporting

Report the four sub-scores with a one-line justification each, then run
`scripts/score.mjs` for the weighted total and level. Rank fixes by **weighted** gain:

| Criterion  | +1.0 raw is worth |
|------------|-------------------|
| Design     | +0.40 overall |
| Usability  | +0.30 overall |
| Creativity | +0.20 overall |
| Content    | +0.10 overall |

Fixing a 6.5 Usability to 8.5 (+0.60 overall) beats polishing a 9.0 Design to 9.5 (+0.20).
Always attack the weakest weighted criterion first.
