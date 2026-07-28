/**
 * Canonical Harmony Verify design tokens.
 *
 * This file is the single source of truth. `pnpm --filter @harmony/design-system build`
 * regenerates the CSS custom properties consumed by every app, including the static
 * marketing site, so a token can never drift between surfaces.
 *
 * Contrast notes on individual values are load-bearing — they record why a value is
 * what it is. Changing them without re-running the contrast audit will regress WCAG AA.
 */

export interface TokenGroup {
  readonly label: string;
  readonly tokens: ReadonlyArray<readonly [name: string, value: string, note?: string]>;
}

export const tokenGroups: readonly TokenGroup[] = [
  {
    label: "Surfaces",
    tokens: [
      ["ink", "#03081a"],
      ["navy-900", "#050f24"],
      ["navy-800", "#071a3d"],
      ["navy-700", "#0b2350"],
      ["navy-600", "#123066"],
      ["paper", "#f4f2ec"],
      ["paper-dim", "#e4e0d6"],
    ],
  },
  {
    label: "Brand",
    tokens: [
      ["gold", "#d4af37"],
      ["gold-bright", "#f0d374"],
      ["gold-deep", "#96741a"],
      [
        "gold-grad",
        "linear-gradient(135deg, #f8e7a6 0%, #e3c356 28%, #d4af37 55%, #efd374 80%, #b58c1f 100%)",
        "Final stop stays light enough that button label text clears 4.5:1 across the whole face.",
      ],
    ],
  },
  {
    label: "Signal — clinical status",
    tokens: [
      ["sig-verified", "#48c79a"],
      ["sig-review", "#e0a93b"],
      ["sig-flagged", "#e8735c"],
    ],
  },
  {
    label: "Text",
    tokens: [
      ["text", "#e9eefa"],
      ["text-2", "rgba(206, 219, 242, 0.72)"],
      [
        "text-3",
        "rgba(186, 203, 232, 0.64)",
        "0.64 keeps meta text at 4.5:1 or better on every surface we place it on.",
      ],
      ["text-on-paper", "#10203f"],
      ["text-on-paper-2", "rgba(16, 32, 63, 0.66)"],
    ],
  },
  {
    label: "Lines",
    tokens: [
      ["rule", "rgba(212, 175, 55, 0.16)"],
      ["rule-soft", "rgba(180, 205, 245, 0.1)"],
      ["rule-strong", "rgba(212, 175, 55, 0.34)"],
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
