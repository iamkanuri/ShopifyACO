// ===========================================================================
// THE ATTACK TEMPLATIZER — command line.
//
//   node --import tsx standards/attack/cli.ts <vocabulary.json> [options]
//
//     --context <id>     a file in standards/attack/contexts/ (default: generic)
//     --seed <string>    deterministic selection key (default: als-standards-s3)
//     --limit <n>        attacks per term per class (default: 3)
//     --classes a,b,c    restrict the run. ANY restriction forces INCOMPLETE
//     --no-controls      hostile sentences only. See the warning it prints
//     --json             machine-readable output
//
// Exit code is 0 for a run that COMPLETED, whatever it found — a coverage gap is
// a result, not a crash. It is 2 when the run did not complete, so a shell that
// only checks the exit status cannot read INCOMPLETE as clean.
//
// Pure: reads two files, writes stdout. No network, no database, no clock.
// ===========================================================================

import { readFileSync } from "node:fs";
import { loadContext } from "./context.js";
import { generateAttacks } from "./generate.js";
import { attackSetToJson, renderAttackSet } from "./render.js";
import { ATTACK_CLASSES, type AttackClass } from "./types.js";

function main(argv: string[]): number {
  const args = argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    process.stdout.write("usage: node --import tsx standards/attack/cli.ts <vocabulary.json> [--context id] [--seed s] [--limit n] [--classes a,b] [--no-controls] [--json]\n");
    return 2;
  }
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const { context, problems } = flag("context") ? loadContext(flag("context")!) : { context: undefined, problems: [] };
  for (const p of problems) process.stdout.write(`context: ${p}\n`);

  const classArg = flag("classes");
  let classes: AttackClass[] | undefined;
  if (classArg) {
    const wanted = classArg.split(",").map((s) => s.trim());
    const unknown = wanted.filter((w) => !(ATTACK_CLASSES as readonly string[]).includes(w));
    if (unknown.length) {
      process.stdout.write(`unknown class(es): ${unknown.join(", ")}\nknown: ${ATTACK_CLASSES.join(", ")}\n`);
      return 2;
    }
    classes = wanted as AttackClass[];
  }

  let vocab: unknown;
  try {
    vocab = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    process.stdout.write(`INCOMPLETE — cannot read ${file}: ${(e as Error).message}\nNothing was generated, which is NOT a clean result.\n`);
    return 2;
  }

  const includeControls = !args.includes("--no-controls");
  if (!includeControls) {
    process.stdout.write(
      "⚠️  --no-controls: this set measures ONE DIRECTION. v2.6 built a negation-scope rewrite,\n" +
      "    measured 16/16 on its own hostile set, and an independent pass then measured it as a\n" +
      "    NET REGRESSION — 7 false passes it stopped catching and 46 false fails.\n\n",
    );
  }

  const set = generateAttacks(vocab, {
    context,
    seed: flag("seed"),
    perCellLimit: flag("limit") ? Number(flag("limit")) : undefined,
    classes,
    includeControls,
  });

  process.stdout.write(args.includes("--json") ? `${attackSetToJson(set)}\n` : `${renderAttackSet(set)}\n`);
  return set.state === "incomplete" ? 2 : 0;
}

process.exitCode = main(process.argv);
