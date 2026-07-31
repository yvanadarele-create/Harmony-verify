#!/usr/bin/env node
/**
 * Awwwards scorecard.
 *
 * Weights and achievement thresholds ported from
 * https://github.com/brookcs3/mcp-awwwards-todo-system (MIT), whose evaluation engine
 * applies Awwwards' criteria weighting with Swiss-grid display conventions
 * (Müller-Brockmann) and typographic hierarchy (Lupton).
 *
 * Sub-scores are supplied by the reviewer — this computes the weighted total and renders
 * the card, so the arithmetic and the achievement level are never guessed.
 *
 *   node score.mjs --design 9.1 --usability 8.4 --creativity 8.0 --content 8.5 \
 *                  --label "apps/web/platform.html"
 */

const WEIGHTS = {
  design: 0.4, // Visual aesthetics, layout, typography
  usability: 0.3, // UX, navigation, functional efficiency
  creativity: 0.2, // Innovation, originality, unique approach
  content: 0.1, // Information quality, relevance
};

const NOTES = {
  design: "Grid + typographic hierarchy",
  usability: "Clarity, scanning, a11y",
  creativity: "Originality, point of view",
  content: "Meaningful organisation",
};

const LEVELS = [
  [9.0, "SITE OF THE DAY"],
  [8.5, "DEVELOPER AWARD"],
  [6.5, "HONORABLE MENTION"],
  [0, "KEEP IMPROVING"],
];

const WIDTH = 52;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function readScore(args, key) {
  if (!(key in args)) throw new Error(`Missing required --${key}`);
  const value = Number(args[key]);
  if (!Number.isFinite(value) || value < 0 || value > 10) {
    throw new Error(`--${key} must be a number between 0 and 10 (got "${args[key]}")`);
  }
  return value;
}

function levelFor(overall) {
  return LEVELS.find(([threshold]) => overall >= threshold)[1];
}

/** Swiss-grid card: every line is exactly WIDTH characters. */
function render(scores, overall, label) {
  const rule = "▓".repeat(WIDTH);
  // "▓ " + body + "▓" — body is truncated so a long note can never break the grid.
  const body = WIDTH - 3;
  const row = (text) => `▓ ${text.slice(0, body).padEnd(body)}▓`;
  const lines = [rule];

  if (label) {
    lines.push(row(label.toUpperCase()), row(""));
  }

  for (const key of Object.keys(WEIGHTS)) {
    const name = `${key.toUpperCase()}:`.padEnd(12);
    lines.push(row(`${name}${scores[key].toFixed(1)}/10  ${NOTES[key]}`));
  }

  lines.push(
    row(""),
    row(`${"OVERALL:".padEnd(12)}${overall.toFixed(1)}/10 → ${levelFor(overall)}`),
    rule,
  );
  return lines.join("\n");
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(2);
  }

  let scores;
  try {
    scores = Object.fromEntries(Object.keys(WEIGHTS).map((key) => [key, readScore(args, key)]));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error(
      "\nUsage: node score.mjs --design N --usability N --creativity N --content N [--label TEXT]",
    );
    process.exit(2);
  }

  const overall = Object.entries(WEIGHTS).reduce(
    (total, [key, weight]) => total + scores[key] * weight,
    0,
  );

  console.log(render(scores, overall, args.label));

  // Rank remaining headroom by weighted gain, so the biggest lever is obvious.
  const headroom = Object.entries(WEIGHTS)
    .map(([key, weight]) => ({ key, gain: (10 - scores[key]) * weight }))
    .sort((a, b) => b.gain - a.gain)
    .filter(({ gain }) => gain > 0.01);

  if (headroom.length) {
    console.log("\nHighest-leverage headroom (weighted points to a perfect 10):");
    for (const { key, gain } of headroom) {
      console.log(`  ${key.padEnd(11)} +${gain.toFixed(2)}`);
    }
  }
}

main();
