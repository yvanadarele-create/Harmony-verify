/**
 * Canonical Harmony Verify design tokens.
 *
 * Palette and type are taken verbatim from the Ultimate Build Prompt. Two additions
 * exist because two of the specified values fail WCAG AA in the place they are meant
 * to be used — both are documented inline and neither changes a specified value:
 *
 *   - `destructive #A53030` renders at 2.71:1 on `navy-deep`, so it is unreadable as
 *     text on the page background. It is kept exactly as specified for fills and
 *     borders, and `destructive-text` is added for the label itself.
 *   - `muted-foreground #8595B0` clears AA on `navy-deep` (6.11) and `navy` (5.62)
 *     but lands at 4.16 on `navy-mid`. Use `foreground` for secondary text on
 *     `navy-mid` surfaces.
 *
 * This file is the single source of truth. `pnpm tokens` regenerates the CSS consumed
 * by every app, including the static marketing site.
 */

export interface TokenGroup {
  readonly label: string;
  readonly tokens: ReadonlyArray<readonly [name: string, value: string, note?: string]>;
}

export const tokenGroups: readonly TokenGroup[] = [
  {
    label: "Surfaces",
    tokens: [
      ["navy-deep", "#0A1325"],
      ["navy", "#101B36"],
      ["navy-mid", "#163166"],
      ["navy-light", "#1E3A78"],
      ["paper", "#EDF1F7", "Clinical documents rendered inside the UI — a content surface, not brand chrome."],
    ],
  },
  {
    label: "Brand",
    tokens: [
      ["gold", "#D4AF37"],
      ["gold-light", "#E8C97A"],
      ["gold-dark", "#A8842A"],
      ["gold-grad", "linear-gradient(135deg, #D4AF37 0%, #A8842A 100%)"],
    ],
  },
  {
    label: "Text",
    tokens: [
      ["foreground", "#E9EDF5"],
      ["muted-foreground", "#8595B0", "AA on navy-deep (6.11) and navy (5.62). On navy-mid it is 4.16 — use foreground there."],
      ["text-on-paper", "#101B36"],
      ["text-on-paper-2", "rgba(16, 27, 54, 0.68)"],
    ],
  },
  {
    label: "Lines",
    tokens: [
      ["border", "#172F55"],
      ["border-gold", "rgba(212, 175, 55, 0.22)"],
      ["border-gold-strong", "rgba(212, 175, 55, 0.4)"],
    ],
  },
  {
    label: "Status — gold carries attention, green resolves, red rejects",
    tokens: [
      ["destructive", "#A53030", "Fills and borders only — 2.71:1 on navy-deep, unreadable as text."],
      ["destructive-text", "#FF7B6B", "The readable counterpart for an Unsafe label on a dark surface (6.0:1)."],
      ["success", "#34D27A"],
      ["warning", "#D4AF37"],
    ],
  },
  {
    label: "Charts",
    tokens: [
      ["chart-1", "#D4AF37"],
      ["chart-2", "#34D27A"],
      ["chart-3", "#1E3A78"],
      ["chart-4", "#9B7BD4"],
      ["chart-5", "#FF7B6B"],
    ],
  },
  {
    label: "Type — Cinzel for display, Inter for body and UI",
    tokens: [
      ["font-display", '"Cinzel", "Iowan Old Style", Georgia, "Times New Roman", serif'],
      ["font-sans", '"Inter", ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial, sans-serif'],
      ["font-mono", 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace'],
    ],
  },
  {
    label: "Rhythm",
    tokens: [
      ["gutter", "clamp(20px, 5vw, 64px)"],
      ["section-y", "clamp(64px, 9vw, 132px)"],
      ["measure", "62ch"],
      ["radius", "3px"],
      ["nav-h", "68px"],
    ],
  },
  {
    label: "Motion",
    tokens: [
      ["ease", "cubic-bezier(0.22, 0.61, 0.36, 1)"],
      ["dur", "0.42s"],
    ],
  },
  {
    label: "Aliases — kept so existing rules resolve against the canonical values",
    tokens: [
      ["ink", "var(--navy-deep)"],
      ["navy-900", "var(--navy-deep)"],
      ["navy-800", "var(--navy)"],
      ["navy-700", "var(--navy-mid)"],
      ["navy-600", "var(--navy-light)"],
      ["white", "#FFFFFF"],
      ["off-white", "var(--foreground)"],
      ["text", "var(--foreground)"],
      ["text-2", "var(--muted-foreground)"],
      ["text-3", "var(--muted-foreground)"],
      ["text-muted", "var(--muted-foreground)"],
      ["text-dim", "var(--muted-foreground)"],
      ["gold-bright", "var(--gold-light)"],
      ["gold-dim", "var(--gold-dark)"],
      ["gold-deep", "var(--gold-dark)"],
      ["sig-pending", "var(--gold)"],
      ["sig-review", "var(--gold)"],
      ["sig-verified", "var(--success)"],
      ["sig-flagged", "var(--destructive-text)"],
      ["rule", "var(--border-gold)"],
      ["border-sub", "var(--border)"],
      ["rule-soft", "var(--border)"],
      ["border-strong", "var(--border-gold-strong)"],
      ["rule-strong", "var(--border-gold-strong)"],
      ["paper-dim", "#DCE3EE"],
    ],
  },
] as const;

/** Flat name -> value map, for JS/TS consumers (charts, canvas, emails). */
export const tokens: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(tokenGroups.flatMap((g) => g.tokens.map(([n, v]) => [n, v]))),
);

/** `var(--x)` reference for a token, checked at runtime against the token table. */
export function cssVar(name: keyof typeof tokens & string): string {
  if (!(name in tokens)) throw new Error(`Unknown design token: ${name}`);
  return `var(--${name})`;
}

/** Renders the `:root { … }` block written into every stylesheet. */
export function renderRootBlock(indent = "  "): string {
  const lines: string[] = [":root {"];
  tokenGroups.forEach((group, i) => {
    if (i > 0) lines.push("");
    lines.push(`${indent}/* ${group.label} */`);
    for (const [name, value, note] of group.tokens) {
      if (note) lines.push(`${indent}/* ${note} */`);
      lines.push(`${indent}--${name}: ${value};`);
    }
  });
  lines.push("}");
  return lines.join("\n");
}
