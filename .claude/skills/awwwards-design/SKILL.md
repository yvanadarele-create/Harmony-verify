---
name: awwwards-design
description: Judge or generate premium, award-grade web design using the Awwwards weighting (40% Design, 30% Usability, 20% Creativity, 10% Content) plus Swiss-grid and typographic-hierarchy principles. Use when asked for "premium website ideas", an award-level or high-end redesign, a design score/scorecard, "is this Site of the Day quality", or when building/reviewing a page in apps/web and the bar is craft rather than correctness.
---

# Awwwards-grade design

Two jobs: **score** an existing interface against the Awwwards rubric, and **generate**
premium direction that would survive that scoring. Both run against the same rubric, so
ideas and judgement never drift apart.

Ported from the evaluation engine in
[brookcs3/mcp-awwwards-todo-system](https://github.com/brookcs3/mcp-awwwards-todo-system)
— the weights, achievement thresholds and design lineage (Müller-Brockmann's grid,
Lupton's *Thinking with Type*) are that project's; the web-facing application is this repo's.

## The rubric

| Criterion  | Weight | What it actually measures |
|------------|--------|---------------------------|
| Design     | 40%    | Visual aesthetics, layout, typographic hierarchy, grid discipline |
| Usability  | 30%    | Navigation, clarity, functional efficiency, accessibility |
| Creativity | 20%    | Innovation, originality, a point of view |
| Content    | 10%    | Information quality, meaningful organisation |

`overall = 0.40·design + 0.30·usability + 0.20·creativity + 0.10·content`

| Score  | Level |
|--------|-------|
| ≥ 9.0  | Site of the Day 🏆 |
| ≥ 8.5  | Developer Award 🥇 |
| ≥ 6.5  | Honorable Mention 🎖️ |
| < 6.5  | Keep Improving 📈 |

**Never invent an overall score.** Rate the four criteria from evidence you have actually
looked at, then compute:

```bash
node .claude/skills/awwwards-design/scripts/score.mjs \
  --design 9.1 --usability 8.4 --creativity 8.0 --content 8.5 \
  --label "apps/web/platform.html"
```

It prints the weighted total, the achievement level, and a Swiss-grid scorecard. Sub-scores
must be justified in one line each — "9.1 because X" — or the number is decoration.

## Scoring an interface

1. Look at the real thing (read the HTML/CSS, or run the page — see the `run` skill). Do not
   score from a description.
2. Rate each criterion against `references/scoring-rubric.md`, which lists the concrete
   signals that move each number up or down.
3. Compute with the script. Report the scorecard, then the three highest-leverage fixes
   ranked by weighted point gain — a +1.0 on Design is worth 4× the same gain on Content.
4. Weakest criterion first. A 9.5 Design behind a 6.0 Usability is a losing submission.

## Generating premium direction

`references/premium-patterns.md` is the idea bank: the compositional, typographic, motion and
interaction patterns that actually win, plus the tells that mark a page as generic.

Working rules:

- **Commit to one strong idea**, executed precisely, over four hedged ones. Awwwards rewards a
  point of view; "tasteful and safe" scores ~7.5 forever.
- **Earn the grid before breaking it.** Asymmetry reads as intent only when the underlying
  system is visible. Ad-hoc asymmetry reads as a bug.
- **Restraint is the accent.** One dominant gesture per viewport. If everything moves,
  nothing does.
- **Motion serves orientation.** Every transition should answer "where did that come from" or
  "what changed". Decorative-only motion costs Usability more than it gains Creativity.
- **Type carries the hierarchy**, not boxes and dividers. Scale, weight and space first;
  borders only when they separate genuinely different things.

## This repo's constraints

`apps/web` is a hand-written static site; `packages/design-system/src/tokens.ts` is the single
source of truth and `pnpm tokens` regenerates the CSS. Premium ideas here must land as tokens
and CSS, not a framework.

Non-negotiables when proposing anything for this repo:

- **Use the tokens.** Navy field (`--navy-deep` … `--navy-light`), gold as a *rare* accent
  (`--gold`, `--gold-grad`), Cinzel display over Inter body. New raw hex values are a defect —
  add a token or use an existing one.
- **Gold is scarce by design.** It marks the single most important thing in a view. Spreading
  it destroys the hierarchy the palette is built on.
- **Respect the documented contrast traps** in `tokens.ts`: `--destructive` is fills/borders
  only (2.71:1 on navy-deep); use `--destructive-text` for labels. `--muted-foreground` fails
  AA on `--navy-mid` — use `--foreground` on those surfaces.
- **Rhythm tokens over magic numbers**: `--gutter`, `--section-y`, `--measure` (62ch),
  `--radius` (3px), `--nav-h`. Motion uses `--ease` and `--dur`.
- **This is clinical infrastructure for healthcare AI.** Premium here means *institutional
  authority* — precision, restraint, evidentiary calm. Playful or hyper-kinetic direction
  scores well on Creativity and destroys the product's credibility. Weight trust over novelty.
- Accessibility is scored inside Usability, not traded against Design. Honour
  `prefers-reduced-motion`, keep visible focus, keep tap targets ≥44px.

## Output

Lead with the scorecard when scoring, or with the single strongest idea when generating. Then
concrete, buildable specifics — token names, selectors, files. No mood-board adjectives without
a corresponding change someone could implement.
