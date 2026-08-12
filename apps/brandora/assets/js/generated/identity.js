/**
 * Visual identity: palette, typography and the logo brief (§18).
 *
 * This is deliberately deterministic rather than generated. Three reasons.
 *
 * A palette has hard constraints — contrast, print legibility, a working
 * surface/ink pair — that a language model satisfies by luck. Second, "regenerate
 * this element" (§16) has to give a *different* result on purpose, not a random
 * one by accident, so the variation is a seed the user controls. Third, this runs
 * with no API key and no network, which means the brand loop keeps working when
 * the AI provider is down, and the tests are honest.
 *
 * The AI still writes the words — name, story, tone. It does not pick the hex.
 */
import { AA_CONTRAST, contrastRatio, ensureContrast, hslToHex, meanHue } from "./color.js";
/**
 * Where each personality trait sits on the colour wheel. Conventional
 * associations, not universal truths — they are a starting point the founder can
 * override, which is why the palette is regenerable.
 */
export const TRAIT_HUE = {
    warm: 25,
    elegant: 285,
    bold: 355,
    natural: 95,
    playful: 40,
    trustworthy: 215,
    modern: 200,
    traditional: 15,
};
export const POSITIONING_TONE = {
    affordable: { saturation: 0.62, lightness: 0.46, accentSpread: 150 },
    "accessible-premium": { saturation: 0.5, lightness: 0.38, accentSpread: 165 },
    premium: { saturation: 0.42, lightness: 0.3, accentSpread: 180 },
    luxury: { saturation: 0.34, lightness: 0.2, accentSpread: 195 },
    contemporary: { saturation: 0.68, lightness: 0.48, accentSpread: 140 },
    "mass-market": { saturation: 0.66, lightness: 0.5, accentSpread: 145 },
};
/** Regenerating nudges the hue by a fixed step, so each press is a real change. */
const REGENERATION_STEP_DEGREES = 47;
export function derivePalette(brief, options = {}) {
    const variation = options.variation ?? 0;
    const hues = brief.personality.map((trait) => TRAIT_HUE[trait]).filter((h) => h !== undefined);
    const baseHue = (hues.length > 0 ? meanHue(hues) : 265) + variation * REGENERATION_STEP_DEGREES;
    const tone = POSITIONING_TONE[brief.positioning];
    const primary = { h: baseHue, s: tone.saturation, l: tone.lightness };
    const secondary = { h: baseHue + 28, s: tone.saturation * 0.75, l: tone.lightness + 0.18 };
    const accent = { h: baseHue + tone.accentSpread, s: tone.saturation * 0.9, l: 0.52 };
    // Surface and ink carry a trace of the brand hue so pages feel of a piece
    // rather than "the brand colour, on grey".
    const surface = { h: baseHue, s: 0.06, l: 0.97 };
    const surfaceHex = hslToHex(surface);
    const ink = ensureContrast({ h: baseHue, s: 0.22, l: 0.14 }, surfaceHex, 7);
    const traits = brief.personality.length > 0 ? brief.personality.join(", ") : "your brand";
    return [
        {
            name: "Primary",
            hex: hslToHex(ensureContrast(primary, surfaceHex, AA_CONTRAST)),
            role: "primary",
            rationale: `Carries the ${brief.positioning.replace("-", " ")} positioning and the ${traits} feeling. Use it for your logo, headings and anything you want remembered.`,
        },
        {
            name: "Secondary",
            hex: hslToHex(secondary),
            role: "secondary",
            rationale: "Supports the primary without competing. Backgrounds, panels, secondary packaging.",
        },
        {
            name: "Accent",
            hex: hslToHex(accent),
            role: "accent",
            rationale: "Used sparingly — a price, a badge, one call to action per page. Overuse kills it.",
        },
        {
            name: "Surface",
            hex: surfaceHex,
            role: "surface",
            rationale: "The paper. Keeps packaging cheap to print and text easy to read.",
        },
        {
            name: "Ink",
            hex: hslToHex(ink),
            role: "ink",
            rationale: "Body text. Tinted toward your primary rather than pure black, which reads warmer.",
        },
    ];
}
const PAIRINGS = {
    serifDisplay: {
        primary: "Cormorant Garamond",
        secondary: "Inter",
        primaryFallback: "Georgia, 'Times New Roman', serif",
        secondaryFallback: "system-ui, -apple-system, sans-serif",
        rationale: "A high-contrast serif for the name and headings reads as considered and expensive; a plain sans keeps the small print legible.",
    },
    editorialSerif: {
        primary: "Playfair Display",
        secondary: "Inter",
        primaryFallback: "Georgia, serif",
        secondaryFallback: "system-ui, -apple-system, sans-serif",
        rationale: "Editorial and elegant without tipping into formality.",
    },
    geometricSans: {
        primary: "Space Grotesk",
        secondary: "Inter",
        primaryFallback: "'Helvetica Neue', Arial, sans-serif",
        secondaryFallback: "system-ui, -apple-system, sans-serif",
        rationale: "Geometric and current. Reads modern at any size and prints cleanly on packaging.",
    },
    friendlySans: {
        primary: "Poppins",
        secondary: "Inter",
        primaryFallback: "Verdana, sans-serif",
        secondaryFallback: "system-ui, -apple-system, sans-serif",
        rationale: "Rounded and approachable — friendly without being childish.",
    },
    groundedSerif: {
        primary: "Lora",
        secondary: "Inter",
        primaryFallback: "Georgia, serif",
        secondaryFallback: "system-ui, -apple-system, sans-serif",
        rationale: "Warm and rooted. Suits brands whose story is craft, origin or family.",
    },
    workhorseSans: {
        primary: "Inter",
        secondary: "Inter",
        primaryFallback: "system-ui, -apple-system, sans-serif",
        secondaryFallback: "system-ui, -apple-system, sans-serif",
        rationale: "One family, two weights. Cheapest to load, impossible to get wrong, and clear on a small screen.",
    },
};
export function deriveTypography(brief) {
    const has = (trait) => brief.personality.includes(trait);
    const key = brief.positioning === "luxury"
        ? "serifDisplay"
        : has("elegant")
            ? "editorialSerif"
            : has("natural") || has("traditional")
                ? "groundedSerif"
                : has("playful")
                    ? "friendlySans"
                    : has("modern") || brief.positioning === "contemporary"
                        ? "geometricSans"
                        : brief.positioning === "premium" || brief.positioning === "accessible-premium"
                            ? "serifDisplay"
                            : "workhorseSans";
    const pairing = PAIRINGS[key] ?? PAIRINGS["workhorseSans"];
    if (!pairing)
        throw new Error("typography pairing table is empty");
    return {
        primary: pairing.primary,
        secondary: pairing.secondary,
        primaryFallback: pairing.primaryFallback,
        secondaryFallback: pairing.secondaryFallback,
        rationale: pairing.rationale,
    };
}
/**
 * The logo brief.
 *
 * This is a *brief*, not a prompt: it is written to be handed to a human
 * designer or to an image model and produce the same thing either way. It names
 * a subject, a treatment and a constraint, because "make a nice logo for a
 * bakery" produces a stock illustration every time.
 */
export function buildLogoBrief(brief, palette, typography, brandName) {
    const primary = palette.find((c) => c.role === "primary")?.hex ?? "#000000";
    const traits = brief.personality.length > 0 ? brief.personality.join(", ") : "confident, clear";
    const subject = brief.differentiation.trim() !== "" ? brief.differentiation.trim() : brief.product;
    return [
        `Minimal geometric mark for ${brandName}, a ${brief.positioning.replace("-", " ")} business selling ${brief.product}.`,
        `It should feel ${traits}.`,
        `Draw on one idea only: ${subject}. Reduce it to a single shape a customer could redraw from memory.`,
        `Finish in ${primary}, with a smooth ${brief.positioning === "luxury" || brief.positioning === "premium" ? "metallic" : "flat"} treatment.`,
        `Pair with the wordmark set in ${typography.primary}.`,
        "Constraints: legible at 16px as a favicon; works in one colour; works reversed out of black; no gradients in the mark itself; no text inside the symbol.",
    ].join(" ");
}
/** True when every swatch pair a customer will actually see passes AA. */
export function paletteIsAccessible(palette) {
    const surface = palette.find((c) => c.role === "surface")?.hex;
    const ink = palette.find((c) => c.role === "ink")?.hex;
    const primary = palette.find((c) => c.role === "primary")?.hex;
    if (!surface || !ink || !primary)
        return false;
    return (contrastRatio(ink, surface) >= AA_CONTRAST && contrastRatio(primary, surface) >= AA_CONTRAST);
}
//# sourceMappingURL=identity.js.map