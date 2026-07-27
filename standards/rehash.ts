// Recompute and write `standard_hash.value` for every standard.
//
//   node --import tsx standards/rehash.ts            # report only
//   node --import tsx standards/rehash.ts --write    # rewrite the files
//
// The hash covers the canonical form with the hash object removed, so it changes
// whenever any content changes — which is the point: a citation to
// ALS-COFFEE-1.0-DECAF-002 resolves to a specific text, and "1.0" alone is a
// promise enforced by nothing.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { standardHash } from "./hash.js";
import { vocabularyHash } from "./vocabulary.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = [
  "coffee/v1.0/standard.json",
  "accessory/v0.1-draft/standard.json",
  // Vocabularies hash the same way, omitting their own hash field instead.
  "coffee/v1.0/vocabulary/decaf-method.json",
  "coffee/v1.0/vocabulary/decaf-solvent-disclosure.json",
];

const write = process.argv.includes("--write");
let changed = 0;

for (const rel of FILES) {
  const abs = join(HERE, rel);
  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    console.log(`SKIP  ${rel} — not present`);
    continue;
  }
  const doc = JSON.parse(raw) as { standard_hash?: { value?: string }; vocabulary_hash?: { value?: string } };
  const isVocabulary = "vocabulary_hash" in doc;
  const stored = (isVocabulary ? doc.vocabulary_hash?.value : doc.standard_hash?.value) ?? null;
  const computed = isVocabulary ? vocabularyHash(doc) : standardHash(doc);
  if (stored === computed) {
    console.log(`OK    ${rel}  ${computed}`);
    continue;
  }
  changed++;
  console.log(`STALE ${rel}\n        stored:   ${stored}\n        computed: ${computed}`);
  if (write) {
    // Rewrite only the hash value, byte-for-byte elsewhere, so a rehash never
    // reformats the artifact and never appears in a diff as a content change.
    const next = stored
      ? raw.replace(stored, computed)
      : raw;
    if (next === raw) {
      console.log(`        COULD NOT PATCH — no stored value to replace; add a standard_hash block first.`);
      process.exitCode = 1;
    } else {
      writeFileSync(abs, next, "utf8");
      console.log(`        WRITTEN`);
    }
  }
}

if (!write && changed > 0) {
  console.log(`\n${changed} file(s) stale. Re-run with --write.`);
  process.exitCode = 1;
}
