/**
 * The four sourced attributes `upsert_place` takes, and writing them as web
 * claims (`place_claims`, source "scout"). The merge rule lives in
 * lib/core/place-claims.ts: Scout fills facts nobody has answered and replaces
 * its own older claims, and never overrides community checks or approved
 * certificates and menus. Every write recomputes `place_status` through the
 * same path as checks and evidence, so the filter chips follow.
 */
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { parseDefinite, parseSources, type Fact } from "@/lib/core/halal";
import {
  ATTRIBUTE_FACT,
  ATTRIBUTE_VALUES,
  CLAIM_ATTRIBUTES,
  MAX_CERTIFIER,
  attributeFactValue,
  factIsProtected,
  httpsSourceUrl,
  parseStoredClaim,
  planClaim,
  type ClaimAttribute,
  type ClaimOutcome,
  type StoredClaim,
} from "@/lib/core/place-claims";
import { recomputePlaceStatus, runBatch } from "@/lib/checks-repository";
import type { ScoutDeps } from "./deps";

const sourceUrl = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => httpsSourceUrl(value) !== null, "Source URLs must be https URLs.")
  .describe("The https page that says this (the place's site, a certifier's register, a menu).");

const VALUE_HELP: Record<ClaimAttribute, string> = {
  halal_certified: "Is it halal certified? yes, no, or unknown.",
  muslim_owned: "Is it Muslim-owned? yes, no, or unknown.",
  no_pork: "Is it pork-free? yes (no pork served), no (serves pork), or unknown.",
  no_alcohol: "Is it alcohol-free? yes (no alcohol served), no (serves alcohol), or unknown.",
};

const needsSource = (value: { value: string; source_url?: string }) => value.value === "unknown" || value.source_url !== undefined;
const NEEDS_SOURCE = { message: "A yes or no needs a source_url.", path: ["source_url"] };

function attribute(name: ClaimAttribute) {
  return z
    .object({ value: z.enum(ATTRIBUTE_VALUES).describe(VALUE_HELP[name]), source_url: sourceUrl.optional() })
    .refine(needsSource, NEEDS_SOURCE)
    .optional();
}

/** The attribute fields of `upsert_place`. Omit one to leave it alone; "unknown" withdraws Scout's earlier claim. */
export const claimAttributesInput = {
  halal_certified: z
    .object({
      value: z.enum(ATTRIBUTE_VALUES).describe(VALUE_HELP.halal_certified),
      source_url: sourceUrl.optional(),
      certifier_name: z.string().trim().min(1).max(MAX_CERTIFIER).optional().describe("The certifying body, e.g. HMC. Only with value yes."),
    })
    .refine(needsSource, NEEDS_SOURCE)
    .refine((value) => value.certifier_name === undefined || value.value === "yes", {
      message: "certifier_name only goes with value yes.",
      path: ["certifier_name"],
    })
    .optional(),
  muslim_owned: attribute("muslim_owned"),
  no_pork: attribute("no_pork"),
  no_alcohol: attribute("no_alcohol"),
};

export type ClaimAttributesInput = { [K in keyof typeof claimAttributesInput]?: z.infer<(typeof claimAttributesInput)[K]> };

/** Per attribute sent, what happened to it. Attributes left out are left out here too. */
export type ClaimOutcomes = Partial<Record<ClaimAttribute, ClaimOutcome>>;

/**
 * Write the attributes for one place and recompute its status when anything
 * changed. `changed` says whether listings need refreshing.
 */
export async function applyClaims(deps: ScoutDeps, placeId: string, input: ClaimAttributesInput): Promise<{ outcomes: ClaimOutcomes; changed: boolean }> {
  const sent = CLAIM_ATTRIBUTES.filter((name) => input[name] !== undefined);
  if (!sent.length) return { outcomes: {}, changed: false };
  const now = deps.now();
  const [existingRows, [status]] = await Promise.all([
    deps.db.all<Record<string, unknown>>(sql`SELECT fact, value, source_url, certifier FROM place_claims WHERE place_id = ${placeId} AND source = 'scout'`),
    deps.db.all<Record<string, unknown>>(sql`SELECT * FROM place_status WHERE place_id = ${placeId}`),
  ]);
  const existing = new Map<Fact, StoredClaim>();
  for (const row of existingRows) {
    const claim = parseStoredClaim(row);
    if (claim) existing.set(claim.fact, claim);
  }
  const disputed = new Set(String(status?.disputed_facts ?? "").split(","));

  const outcomes: ClaimOutcomes = {};
  const statements: SQL[] = [];
  for (const name of sent) {
    const attr = input[name]!;
    const fact = ATTRIBUTE_FACT[name];
    // Scout's own claim is part of the current value; protection asks about everything else.
    const current = {
      value: parseDefinite(status?.[`${fact}_value`]),
      sources: parseSources(status?.[`${fact}_sources`]),
      disputed: disputed.has(fact),
    };
    const plan = planClaim(
      {
        fact,
        value: attributeFactValue(name, attr.value),
        sourceUrl: attr.source_url ? httpsSourceUrl(attr.source_url) : null,
        certifier: name === "halal_certified" ? (input.halal_certified?.certifier_name ?? null) : null,
      },
      existing.get(fact) ?? null,
      factIsProtected(current),
    );
    outcomes[name] = plan.outcome;
    if (plan.write === "delete") statements.push(sql`DELETE FROM place_claims WHERE place_id = ${placeId} AND fact = ${fact} AND source = 'scout'`);
    else if (plan.write)
      statements.push(sql`INSERT INTO place_claims (id, place_id, source, fact, value, source_url, certifier, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${placeId}, 'scout', ${fact}, ${plan.write.value}, ${plan.write.sourceUrl}, ${plan.write.certifier}, ${now}, ${now})
        ON CONFLICT (place_id, fact, source) DO UPDATE SET
          value = excluded.value, source_url = excluded.source_url, certifier = excluded.certifier, updated_at = excluded.updated_at`);
  }
  if (!statements.length) return { outcomes, changed: false };
  await runBatch(deps.db, statements);
  await recomputePlaceStatus(placeId, deps.db, now);
  return { outcomes, changed: true };
}
