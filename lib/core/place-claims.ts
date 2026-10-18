/**
 * Sourced web claims about a place's four facts, as Halal Food Scout sends
 * them (`upsert_place`), and the rule for writing them.
 *
 * A claim is evidence of the same kind as a map listing: a value, the https
 * page that says it, and when it was written (source "scout",
 * docs/spec/halal-model.md). It never settles a fact and never moves a place
 * off "Not checked yet"; it only fills a fact's value when no community check
 * or approved certificate or menu answers it (`resolveFact`).
 *
 * The merge rule (`planClaim`), per fact:
 *
 * - Attribute omitted: nothing changes.
 * - "unknown": no claim. An earlier Scout claim for the fact is deleted
 *   ("cleared"); "unknown" is never stored, and never stored as "no".
 * - "yes" / "no" while community checks or an approved certificate or menu
 *   answer the fact: nothing is written ("kept_existing"). Scout never
 *   overrides people or moderator-reviewed documents.
 * - Otherwise the claim is written: "set" when there was no Scout claim,
 *   "updated" when it replaces an older one with a different value, source or
 *   certifier, "unchanged" when it says the same thing. A map listing is not
 *   protected: a claim that cites a page outranks it.
 */
import { FACTS, type Definite, type Fact, type Source } from "./halal";

/** The `upsert_place` attributes, in the words Scout uses. */
export const CLAIM_ATTRIBUTES = ["halal_certified", "muslim_owned", "no_pork", "no_alcohol"] as const;
export type ClaimAttribute = (typeof CLAIM_ATTRIBUTES)[number];

export const ATTRIBUTE_VALUES = ["yes", "no", "unknown"] as const;
export type AttributeValue = (typeof ATTRIBUTE_VALUES)[number];

export const ATTRIBUTE_FACT: Record<ClaimAttribute, Fact> = {
  halal_certified: "certified",
  muslim_owned: "owned",
  no_pork: "pork",
  no_alcohol: "alcohol",
};

/** "No pork: yes" is "Serves pork: no". The other two read the same way round. */
export function attributeFactValue(attribute: ClaimAttribute, value: AttributeValue): Definite | null {
  if (value === "unknown") return null;
  const fact = ATTRIBUTE_FACT[attribute];
  if (fact === "pork" || fact === "alcohol") return value === "yes" ? "no" : "yes";
  return value;
}

export const MAX_SOURCE_URL = 500;
export const MAX_CERTIFIER = 120;

/** An https URL without credentials, normalised; null for anything else. */
export function httpsSourceUrl(value: string): string | null {
  if (value.length > MAX_SOURCE_URL) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href.length <= MAX_SOURCE_URL ? url.href : null;
  } catch {
    return null;
  }
}

/** One stored Scout claim. */
export type StoredClaim = { fact: Fact; value: Definite; sourceUrl: string; certifier: string | null };

/** What Scout sent for one fact, already mapped onto it. Null value means "unknown". */
export type IncomingClaim = { fact: Fact; value: Definite | null; sourceUrl: string | null; certifier: string | null };

export type ClaimOutcome = "set" | "updated" | "unchanged" | "kept_existing" | "cleared";

export type ClaimPlan =
  | { outcome: ClaimOutcome; write: null }
  | { outcome: "cleared"; write: "delete" }
  | { outcome: "set" | "updated"; write: StoredClaim };

/** Sources that a Scout claim must never override: people and moderator-reviewed documents. */
export const PROTECTED_SOURCES: readonly Source[] = ["community", "certificate", "menu"];

/** The fact's current value comes from (or is contested by) checks or reviewed documents. */
export function factIsProtected(current: { value: Definite | null; sources: readonly Source[]; disputed?: boolean }): boolean {
  if (current.disputed) return true;
  return current.value !== null && current.sources.some((source) => PROTECTED_SOURCES.includes(source));
}

/** Apply the merge rule above to one fact. */
export function planClaim(incoming: IncomingClaim, existing: StoredClaim | null, isProtected: boolean): ClaimPlan {
  if (incoming.value === null) return existing ? { outcome: "cleared", write: "delete" } : { outcome: "unchanged", write: null };
  if (isProtected) return { outcome: "kept_existing", write: null };
  const next: StoredClaim = {
    fact: incoming.fact,
    value: incoming.value,
    sourceUrl: incoming.sourceUrl ?? existing?.sourceUrl ?? "",
    // A certifier only goes with "certified: yes".
    certifier: incoming.fact === "certified" && incoming.value === "yes" ? incoming.certifier : null,
  };
  if (!existing) return { outcome: "set", write: next };
  if (existing.value === next.value && existing.sourceUrl === next.sourceUrl && existing.certifier === next.certifier)
    return { outcome: "unchanged", write: null };
  return { outcome: "updated", write: next };
}

/** Read a stored row leniently: anything that isn't one of the four facts with yes/no is skipped. */
export function parseStoredClaim(row: Record<string, unknown>): StoredClaim | null {
  const fact = FACTS.find((name) => name === row.fact);
  if (!fact || (row.value !== "yes" && row.value !== "no") || typeof row.source_url !== "string") return null;
  return { fact, value: row.value, sourceUrl: row.source_url, certifier: typeof row.certifier === "string" ? row.certifier : null };
}
