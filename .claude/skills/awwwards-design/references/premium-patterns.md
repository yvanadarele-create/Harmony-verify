# Premium patterns — the idea bank

Patterns that reliably score at award level, why they work, and what they cost. Pick **one**
structural idea and **one** signature detail per page. Stacking more is how a site drops from
9.0 to 7.5.

---

## 1. Composition

### Editorial asymmetry
A dominant column paired with a narrow satellite column (roughly 8/4 or 7/5), holding across
sections while the *content* of each column changes. Reads as an art-directed magazine spread
rather than a template.
**Wins:** Design +1.0, Creativity +0.5. **Costs:** demands real content — thin copy exposes it.

### Anchored full-bleed against a hard measure
Media breaks to the viewport edge; text stays locked to a strict `--measure`. The tension
between the two is the composition.
**Wins:** Design +0.8. **Costs:** nothing, if the measure never wavers.

### Compressed hero
The hero occupies ~55vh instead of 100vh, so the second element is visible on load. Confidence
reads as premium; a full-screen hero with a scroll hint reads as a template.
**Wins:** Usability +0.7, Creativity +0.5.

### Modular scale, visible
Type and space both derived from one ratio (1.25 / 1.333 / 1.5). When the same ratio governs a
32px gap and a 48px heading, the page feels authored rather than assembled.
**Wins:** Design +1.0 — the single highest-leverage change available to most pages.

### The rule of one gesture
Per viewport: one thing moves, or one thing is coloured, or one thing is oversized. Never two.
**Wins:** Design +0.5, Usability +0.5.

---

## 2. Typography

### Display/text pairing with a real contrast jump
A serif or distinctive display face at 3–6× the body size against a neutral text face. The jump
must be unmistakable — 1.5× reads as an accident, 4× reads as a decision.
*(This repo already has the pairing: Cinzel over Inter. Most pages under-use the scale jump.)*

### Optical tracking
Negative tracking on display sizes (−0.01em to −0.03em), neutral at body, positive on small caps
and eyebrows (+0.08em). Nothing else so cheaply separates crafted type from default type.

### Measure discipline
45–75 characters, always. `--measure` is 62ch here. Long lines are the most common single cause
of a mediocre Usability score.

### Typographic hierarchy over chrome
Establish levels with size, weight and space; reach for a border only when two things are
genuinely different in kind. Every divider you delete and replace with space raises Design.

### The oversized numeral
Statistics set at display scale with tiny labels beneath. Cheap, durable, and it makes claims
feel evidentiary rather than promotional. Ideal for a proof/metrics band.

---

## 3. Colour and surface

### Deep field, rare accent
A dark, slightly-chromatic field (never pure `#000`) with a single warm accent used on under 5%
of the surface. This is exactly the navy/gold system in `tokens.ts` — the discipline is spending
the accent on *one* thing per view.

### Layered surfaces instead of borders
Depth via two or three surface elevations (`--navy-deep` → `--navy` → `--navy-mid`) rather than
outlines. Quieter and more expensive-looking than any border treatment.

### Paper inversion
A light "document" surface (`--paper`) embedded in the dark field, used only for genuinely
document-like content. The register change signals "this is the artefact" without a label.
Powerful *because* it is rare — one per page at most.

### Gradient as a material, not a background
`--gold-grad` on a rule, an underline, a border, a small mark. A gradient across a whole hero is
the most reliable tell of an amateur page.

---

## 4. Motion

### Scroll-linked reveal, ~1 unit
Content enters with a 12–20px translate and a fade, 0.4s on `--ease`, staggered ≤60ms. Any more
travel becomes a distraction and starts costing Usability.

### Continuity transitions
An element that persists between two states animates between its positions rather than
cross-fading. This is the highest-value motion work: it answers "what just changed" and buys
Usability *and* Creativity simultaneously.

### Cursor-aware, restrained
A subtle magnetic pull or state change on interactive elements. Pointer-only, never required for
comprehension, always disabled under `prefers-reduced-motion`.

### Numeric count-up on entry
Statistics animate to value once when scrolled into view. Small, effective, and it directs
attention to the proof.

**Motion budget:** every animation must answer "where did this come from" or "what changed". If
neither, delete it. Honour `prefers-reduced-motion` on all of the above — it is scored under
Usability at 30%.

---

## 5. Interaction and detail

- **State-complete components.** Hover, focus-visible, active, disabled, loading, empty, error —
  all designed. Most sites design one of seven.
- **Focus as a designed state.** A `focus-visible` ring in the accent colour, matching the design
  language. Never `outline: none`.
- **Sticky context, not sticky chrome.** Pin the thing that tells the reader where they are (a
  section label, a progress rule); let the rest scroll away.
- **Progressive disclosure.** Long specifications behind a designed expansion beats a wall or a
  separate page.
- **Micro-copy in the interface voice.** Empty states and errors written by the same person who
  wrote the headline.

---

## 6. Anti-patterns — the tells

These cap a page in the 6–7.5 range regardless of execution quality:

- Purple/blue gradient hero with a centred headline and two pill buttons.
- Three equal cards with an icon, a bold noun and two lines of grey text.
- Inter/Roboto at every level with weight as the only hierarchy.
- Full-viewport hero plus an animated scroll-down chevron.
- Glassmorphism applied to elements that aren't layered over anything.
- Accent colour on every heading, so it marks nothing.
- Stock photography of people pointing at laptops.
- Uniform 24px padding on every element in the page.
- Scroll-jacking, or entrance animations that delay reading.
- Testimonial carousel that auto-advances.
- Copy that could belong to any company in the category.

If a proposed direction contains three or more of these, it is a template. Restart from a
structural idea, not a colour change.

---

## 7. Direction for this repo

Harmony Verify is clinical verification infrastructure for healthcare AI. Premium here is
**institutional authority**: precision, restraint, evidentiary calm. Think central-bank annual
report or a medical journal, not a startup landing page. Every idea below stays inside
`tokens.ts` and lands as CSS in `apps/web/assets/css/main.css`.

**Structural ideas that fit:**

- **The document as hero.** A `--paper` surface holding a real (redacted) verification artefact,
  set against the navy field, with the interface annotating it in gold. The product is
  verification — show the verified thing rather than describing it.
- **Evidence ledger.** Claim, verifier, timestamp, status, set as a strict monospace table with
  gold used only on the status column. Reads as a record, not a marketing block.
- **The chain-of-custody rule.** A single vertical gold hairline running the page's left edge,
  ticking at each section. Cheap to build, unmistakably *this* site, and it doubles as scroll
  orientation — Creativity and Usability from one detail.
- **Oversized proof numerals** in Cinzel at display scale, with `--muted-foreground` labels, for
  clinicians / verifications / turnaround.
- **Status typography.** `--success`, `--gold` and `--destructive-text` as a small, consistent
  status vocabulary reused everywhere a state is shown — a system the reader learns once.

**Explicitly out of register here:** kinetic type, playful cursors, saturated multi-colour,
heavy 3D, meme-adjacent copy. They would score on Creativity and cost the product its
credibility — which the rubric doesn't measure but the business does.
