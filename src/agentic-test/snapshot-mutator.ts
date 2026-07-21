import type {
  EvidenceReference,
  EvidenceSurface,
  SnapshotMutation,
  StoreSnapshot,
} from "./types.js";
import { buildSnapshot } from "./snapshot-service.js";
import { canonicalJson, deepClone, matchingTermsIn, normalizeForMatch, sha256Hex, splitSentences } from "./util.js";

// ===========================================================================
// Fault injection (spec 4.4). Removes every trace of one attribute from an
// immutably-cloned snapshot: whole sentences on text surfaces (so no partial
// term survives), attribute-keyed metafields, and any metafield whose VALUE
// matches a term (belt-and-braces so the FAULTY zero-match assertion holds).
// The base snapshot object is never modified. Ground truth is a separate,
// frozen module this file never imports.
// ===========================================================================

export interface MutationResult {
  snapshot: StoreSnapshot;
  mutation: SnapshotMutation;
}

const keyMatchesAttribute = (key: string, attribute: string): boolean =>
  normalizeForMatch(key.replace(/[._]/g, " ")) === normalizeForMatch(attribute.replace(/[._]/g, " "));

export function removeAttributeEvidence(
  snapshot: StoreSnapshot,
  attribute: string,
  matchingTerms: string[],
): MutationResult {
  const removedEvidence: EvidenceReference[] = [];
  const restoreHints: SnapshotMutation["restoreHints"] = [];
  const products = deepClone(snapshot.products);
  const pages = deepClone(snapshot.pages);
  const policies = deepClone(snapshot.policies);

  const evidenceIndex = new Map(snapshot.evidence.map((e) => [`${e.surface}|${e.sourceObjectId}|${e.exactText ?? canonicalJson(e.structuredValue)}`, e]));
  const refFor = (surface: EvidenceSurface, sourceObjectId: string, exactText?: string, structuredValue?: unknown): EvidenceReference => {
    const found = evidenceIndex.get(`${surface}|${sourceObjectId}|${exactText ?? canonicalJson(structuredValue)}`);
    return {
      evidenceId: found?.evidenceId ?? "ev-unknown",
      surface,
      sourceObjectId,
      exactText,
      structuredValue,
      snapshotId: snapshot.id,
    };
  };

  for (const p of products) {
    // Text surfaces: remove the ENTIRE sentence containing a match.
    for (const field of ["title", "description"] as const) {
      const text = p[field];
      if (!text) continue;
      const sentences = splitSentences(text);
      const kept: string[] = [];
      sentences.forEach((sentence, sentenceIndex) => {
        if (matchingTermsIn(sentence, matchingTerms).length > 0) {
          removedEvidence.push(refFor(field === "title" ? "product_title" : "product_description", p.productId, sentence));
          restoreHints.push({ kind: "sentence", productId: p.productId, field, sentenceIndex, sentence });
        } else {
          kept.push(sentence);
        }
      });
      p[field] = kept.length ? kept.join(" ") : null;
    }

    // Metafields: remove when keyed to the attribute OR when the value matches a term.
    const keptMetafields: typeof p.metafields = [];
    p.metafields.forEach((m, metafieldIndex) => {
      const keyed = keyMatchesAttribute(m.key, attribute);
      const valueMatch = matchingTermsIn(m.value, matchingTerms).length > 0;
      if (keyed || valueMatch) {
        removedEvidence.push(refFor("product_metafields", `${p.productId}#${m.namespace}.${m.key}`, m.value, m));
        restoreHints.push({ kind: "metafield", productId: p.productId, metafieldIndex, metafield: { ...m } });
      } else {
        keptMetafields.push(m);
      }
    });
    p.metafields = keptMetafields;
  }

  // Pages / policies (structured_data, faq, shipping/returns): sentence removal.
  for (const page of pages) {
    const kept: string[] = [];
    splitSentences(page.text).forEach((sentence, sentenceIndex) => {
      if (matchingTermsIn(sentence, matchingTerms).length > 0) {
        removedEvidence.push(refFor(page.surface, page.pageId, sentence));
        restoreHints.push({ kind: "page_sentence", pageId: page.pageId, sentenceIndex, sentence });
      } else kept.push(sentence);
    });
    page.text = kept.join(" ");
  }
  for (const pol of policies) {
    const kept: string[] = [];
    splitSentences(pol.text).forEach((sentence, sentenceIndex) => {
      if (matchingTermsIn(sentence, matchingTerms).length > 0) {
        removedEvidence.push(refFor(pol.surface, pol.policyId, sentence));
        restoreHints.push({ kind: "policy_sentence", policyId: pol.policyId, sentenceIndex, sentence });
      } else kept.push(sentence);
    });
    pol.text = kept.join(" ");
  }

  const mutated = buildSnapshot(
    snapshot.shopId,
    snapshot.sourceVersion,
    products,
    pages,
    policies,
    snapshot.id, // parent — yields a fresh id + recomputed content hash
  );

  const mutation: SnapshotMutation = {
    mutationId: `mut-${sha256Hex(`${snapshot.id}|${attribute}|${canonicalJson(removedEvidence)}`).slice(0, 16)}`,
    type: "REMOVE_ATTRIBUTE_EVIDENCE",
    attribute,
    removedEvidence,
    restoreHints,
    originalSnapshotId: snapshot.id,
    mutatedSnapshotId: mutated.id,
  };
  return { snapshot: mutated, mutation };
}

/** RESTORED (Stage 1 shortcut, marked per spec 4.4): re-insert the exact removed
 *  sentences/metafields from the manifest into a COPY of the faulty snapshot.
 *  Applying a Fix Studio correction to a dev store is Stage 2, not now. */
export function restoreEvidence(faulty: StoreSnapshot, mutation: SnapshotMutation): StoreSnapshot {
  const products = deepClone(faulty.products);
  const pages = deepClone(faulty.pages);
  const policies = deepClone(faulty.policies);

  // Group sentence restores per (object, field) so indices apply onto the ORIGINAL
  // ordering: rebuild sentence arrays by inserting at the recorded positions.
  const sentenceHints = mutation.restoreHints.filter((h) => h.kind === "sentence");
  for (const p of products) {
    for (const field of ["title", "description"] as const) {
      const hints = sentenceHints
        .filter((h) => h.kind === "sentence" && h.productId === p.productId && h.field === field)
        .sort((a, b) => (a as { sentenceIndex: number }).sentenceIndex - (b as { sentenceIndex: number }).sentenceIndex);
      if (!hints.length) continue;
      const sentences = p[field] ? splitSentences(p[field]!) : [];
      for (const h of hints) {
        if (h.kind !== "sentence") continue;
        const at = Math.min(h.sentenceIndex, sentences.length);
        sentences.splice(at, 0, h.sentence);
      }
      p[field] = sentences.join(" ");
    }
    const mfHints = mutation.restoreHints
      .filter((h) => h.kind === "metafield" && h.productId === p.productId)
      .sort((a, b) => (a as { metafieldIndex: number }).metafieldIndex - (b as { metafieldIndex: number }).metafieldIndex);
    for (const h of mfHints) {
      if (h.kind !== "metafield") continue;
      const at = Math.min(h.metafieldIndex, p.metafields.length);
      p.metafields.splice(at, 0, { ...h.metafield });
    }
  }
  for (const page of pages) {
    const hints = mutation.restoreHints
      .filter((h) => h.kind === "page_sentence" && h.pageId === page.pageId)
      .sort((a, b) => (a as { sentenceIndex: number }).sentenceIndex - (b as { sentenceIndex: number }).sentenceIndex);
    if (!hints.length) continue;
    const sentences = splitSentences(page.text);
    for (const h of hints) {
      if (h.kind !== "page_sentence") continue;
      sentences.splice(Math.min(h.sentenceIndex, sentences.length), 0, h.sentence);
    }
    page.text = sentences.join(" ");
  }
  for (const pol of policies) {
    const hints = mutation.restoreHints
      .filter((h) => h.kind === "policy_sentence" && h.policyId === pol.policyId)
      .sort((a, b) => (a as { sentenceIndex: number }).sentenceIndex - (b as { sentenceIndex: number }).sentenceIndex);
    if (!hints.length) continue;
    const sentences = splitSentences(pol.text);
    for (const h of hints) {
      if (h.kind !== "policy_sentence") continue;
      sentences.splice(Math.min(h.sentenceIndex, sentences.length), 0, h.sentence);
    }
    pol.text = sentences.join(" ");
  }

  return buildSnapshot(faulty.shopId, faulty.sourceVersion, products, pages, policies, faulty.id);
}

// ---- pre-run assertions (spec 4.4 — invalid experiment ⇒ abort) ------------

/** Evidence items on `surfaces` whose text matches any term (negation NOT
 *  considered here — presence/absence only, which is what fault injection cares about). */
export function evidenceMatches(
  snapshot: StoreSnapshot,
  surfaces: EvidenceSurface[],
  matchingTerms: string[],
  attribute?: string,
): number {
  let n = 0;
  for (const e of snapshot.evidence) {
    if (!surfaces.includes(e.surface)) continue;
    const textMatch = e.exactText ? matchingTermsIn(e.exactText, matchingTerms).length > 0 : false;
    const mf = e.structuredValue as { key?: string; value?: string } | undefined;
    const keyed =
      attribute && e.surface === "product_metafields" && typeof mf?.key === "string"
        ? keyMatchesAttribute(mf.key, attribute)
        : false;
    if (textMatch || keyed) n++;
  }
  return n;
}

export function assertPreRunInvariants(opts: {
  base: StoreSnapshot;
  faulty: StoreSnapshot;
  acceptableSurfaces: EvidenceSurface[];
  matchingTerms: string[];
  attribute: string;
  groundTruthValue: unknown;
}): void {
  const baseHits = evidenceMatches(opts.base, opts.acceptableSurfaces, opts.matchingTerms, opts.attribute);
  if (baseHits < 1) {
    throw new Error("EXPERIMENT INVALID: BASE snapshot has no explicit attribute evidence on any acceptable surface");
  }
  const faultyHits = evidenceMatches(opts.faulty, opts.acceptableSurfaces, opts.matchingTerms, opts.attribute);
  if (faultyHits !== 0) {
    throw new Error(`EXPERIMENT INVALID: FAULTY snapshot still matches on acceptable surfaces (${faultyHits} hits)`);
  }
  if (opts.groundTruthValue !== true) {
    throw new Error("EXPERIMENT INVALID: ground truth aluminum_free is not true / was altered");
  }
}
