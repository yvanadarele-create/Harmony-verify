/**
 * Canonical Harmony Verify design tokens.
 *
 * Values are taken from the brand reference (harmonyverifyv2). Two rules that the
 * reference encodes and this file preserves:
 *
 *   1. #050F24 is the darkest surface in the system. Nothing is blacker than it.
 *      Emphasis is created by going LIGHTER (navy → navy-mid), never darker.
 *   2. Gold is the accent for pending/attention states. Green and coral are reserved
 *      for resolved outcomes only.
 *
 * This file is the single source of truth. `pnpm tokens` regenerates the CSS consumed
 * by every app, including the static marketing site.
 *
 * Contrast notes on individual values are load-bearing — they record why an alpha is
 * what it is. Changing them without re-running the contrast audit regresses WCAG AA.
 */

export interface TokenGroup {
  readonly label: string;
  readonly tokens: ReadonlyArray<readonly [name: string, value: string, note?: string]>;
}

export const tokenGroups: readonly TokenGroup[] = [
  {
    label: "Surfaces — #050F24 is the floor; emphasis goes lighter, never darker",
    tokens: [
      ["navy-deep", "#050F24"],
      ["navy", "#071A3D"],
      ["navy-mid", "#0B2456"],
      ["navy-light", "#122E6A"],
      [
        "paper",
        "#EDF1F7",
        "Cool white for clinical documents rendered inside the UI — a content surface, not brand chrome.",
      ],
    ],
  },
  {
    label: "Brand",
    tokens: [
      ["gold", "#D4AF37"],
      ["gold-light", "#F0D060"],
      ["gold-dim", "#A88820"],
      [
        "gold-grad",
        "linear-gradient(135deg, #F0D060 0%, #D4AF37 45%, #F0D060 70%, #A88820 100%)",
        "Stops stay within the brand gold range so button label text clears 4.5:1 across the whole face.",
      ],
    ],
  },
  {
    label: "Signal — gold carries attention, green and coral resolve it",
    tokens: [
      ["sig-pending", "#D4AF37"],
      ["sig-verified", "#34D27A"],
      ["sig-flagged", "#FF6450"],
    ],
  },
  {
    label: "Text",
    tokens: [
      ["white", "#FFFFFF"],
      ["off-white", "#E8EDF5"],
      [
        "text-muted",
        "rgba(200, 215, 240, 0.72)",
        "Brand RGB at a raised alpha: the reference's 0.55 renders at 4.0:1 and fails AA.",
      ],
      [
        "text-dim",
        "rgba(200, 215, 240, 0.6)",
        "0.6 is the floor at which meta text still clears 4.5:1 on #050F24.",
      ],
      ["text-on-paper", "#0B2456"],
      ["text-on-paper-2", "rgba(11, 36, 86, 0.68)"],
    ],
  },
  {
    label: "Lines",
    tokens: [
      ["border", "rgba(212, 175, 55, 0.18)"],
      ["border-sub", "rgba(255, 255, 255, 0.07)"],
      ["border-strong", "rgba(212, 175, 55, 0.34)"],
    ],
  },
  {
    label: "Type",
    tokens: [
      ["font-display", '"Newsreader", "Iowan Old Style", Georgia, "Times New Roman", serif'],
      [
        "font-sans",
        '"IBM Plex Sans", ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
      ],
      ["font-mono", '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace'],
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
      ["gold-bright", "var(--gold-light)"],
      ["gold-deep", "var(--gold-dim)"],
      ["text", "var(--off-white)"],
      ["text-2", "var(--text-muted)"],
      ["text-3", "var(--text-dim)"],
      ["sig-review", "var(--sig-pending)"],
      ["rule", "var(--border)"],
      ["rule-soft", "var(--border-sub)"],
      ["rule-strong", "var(--border-strong)"],
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
