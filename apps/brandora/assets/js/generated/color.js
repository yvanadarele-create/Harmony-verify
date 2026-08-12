/**
 * Colour maths.
 *
 * Small and self-contained on purpose: a brand generator that pulls in a colour
 * library inherits that library's rounding, and a palette that shifts between
 * versions is a palette a customer has already printed.
 *
 * The contrast function is the one that earns its place. A generated palette
 * that looks handsome in the preview and fails on a phone in daylight is worse
 * than no palette, so every palette this package emits is checked against
 * WCAG AA before it is returned (§72's mobile-first, low-bandwidth reality is
 * also a bright-sunlight reality).
 */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wrapHue = (h) => ((h % 360) + 360) % 360;
export function hslToHex({ h, s, l }) {
    const hue = wrapHue(h);
    const sat = clamp(s, 0, 1);
    const light = clamp(l, 0, 1);
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = light - c / 2;
    const [r, g, b] = hue < 60
        ? [c, x, 0]
        : hue < 120
            ? [x, c, 0]
            : hue < 180
                ? [0, c, x]
                : hue < 240
                    ? [0, x, c]
                    : hue < 300
                        ? [x, 0, c]
                        : [c, 0, x];
    const channel = (v) => Math.round((v + m) * 255)
        .toString(16)
        .padStart(2, "0")
        .toUpperCase();
    return `#${channel(r)}${channel(g)}${channel(b)}`;
}
export function hexToRgb(hex) {
    const clean = hex.replace("#", "");
    const full = clean.length === 3
        ? clean
            .split("")
            .map((c) => c + c)
            .join("")
        : clean;
    return {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16),
    };
}
/** WCAG relative luminance. */
export function relativeLuminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const channel = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
/** WCAG contrast ratio, 1–21. AA body text needs 4.5. */
export function contrastRatio(a, b) {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const [light, dark] = la > lb ? [la, lb] : [lb, la];
    return (light + 0.05) / (dark + 0.05);
}
export const AA_CONTRAST = 4.5;
/**
 * Walk a colour's lightness until it reads against `against`.
 *
 * Adjusts lightness only — hue and saturation are the brand, and a generator
 * that quietly desaturates a founder's colour to pass a check has changed their
 * brand rather than fixed it. Returns the original if no step in range works,
 * so the caller can surface the failure instead of shipping a lie.
 */
export function ensureContrast(colour, against, target = AA_CONTRAST) {
    const startHex = hslToHex(colour);
    if (contrastRatio(startHex, against) >= target)
        return colour;
    const towardsDark = relativeLuminance(against) > 0.5;
    for (let step = 1; step <= 100; step += 1) {
        const l = towardsDark ? colour.l - step / 100 : colour.l + step / 100;
        if (l < 0 || l > 1)
            break;
        const candidate = { ...colour, l };
        if (contrastRatio(hslToHex(candidate), against) >= target)
            return candidate;
    }
    return colour;
}
/**
 * The circular mean of a set of hues.
 *
 * Hue is an angle, so the arithmetic mean is wrong at the wrap point: a brand
 * that is both "warm" (25°) and "traditional" (15°) should land near 20°, but a
 * brand that is "bold" (355°) and "playful" (35°) averages to 195° — a teal —
 * under naive averaging, when the honest answer is 15°, a red-orange. Summing
 * unit vectors and taking the angle back out avoids that.
 */
export function meanHue(hues) {
    if (hues.length === 0)
        return 0;
    const x = hues.reduce((acc, h) => acc + Math.cos((h * Math.PI) / 180), 0);
    const y = hues.reduce((acc, h) => acc + Math.sin((h * Math.PI) / 180), 0);
    if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9)
        return hues[0] ?? 0;
    return wrapHue((Math.atan2(y, x) * 180) / Math.PI);
}
//# sourceMappingURL=color.js.map