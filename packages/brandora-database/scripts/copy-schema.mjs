/**
 * Copy schema.sql next to the compiled output.
 *
 * `tsc` moves .ts files and ignores everything else, so without this the built
 * package reads its schema from a path that does not exist — a failure that
 * only appears once someone runs the built artefact rather than the source.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, "..", "dist"), { recursive: true });
copyFileSync(join(here, "..", "src", "schema.sql"), join(here, "..", "dist", "schema.sql"));
process.stdout.write("database: copied schema.sql to dist\n");
