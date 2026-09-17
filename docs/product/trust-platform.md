# The trust-first platform

This document records the product rules that the code enforces, so that a
future change which breaks one of them is visible as a change to this file.

It implements the MVP band of the halalfood.world Product Feature Catalogue —
the "Phase 1 launch scope" the catalogue itself recommends building first.

## Decision hierarchy

The restaurant profile answers four questions in order, and the code keeps them
separate rather than fusing them into one score:

1. **What is the halal status, and what does it cover?**
   `deriveHalalAssessment` in `src/lib/halal-taxonomy.ts`.
2. **What is the evidence, how old is it, and who submitted it?**
   `src/components/evidence-panel.tsx`.
3. **Would verified diners return, and what did they order?**
   `summarizeCheckIns` and `summarizeDishes` in `src/lib/check-in.ts`.
4. **Does it meet *this* person's standards?**
   `evaluateSuitability` in `src/lib/user-preferences.ts`.

## The halal taxonomy

| Status | Minimum evidence the derivation requires |
| --- | --- |
| Verified halal | A certification with a named body, or a supplier invoice, current and in scope. |
| Community verified | Two or more consistent current submissions from two or more distinct contributors. |
| Halal options | Evidence that explicitly claims options-only, with a scope note. |
| Self declared halal | An owner statement, website, sign or single uncorroborated submission. |
| Unverified | The default when evidence is missing, stale, ambiguous **or conflicting**. |
| Not halal | Direct current evidence contradicting a halal claim. Never inferred from absence. |

Five rules are enforced in code and pinned by `tests/halal-taxonomy.test.ts`:

1. **Unknown is not non-halal.** No evidence produces `unverified`, and the
   profile says so in words: *"no evidence yet. That is not the same as not
   halal."*
2. **Evidence expires.** Every item has an effective expiry — explicit, or the
   per-kind default in `DEFAULT_EVIDENCE_TTL_DAYS`. Expired items stop
   supporting a status and set `needsReverification`.
3. **Conflicts block confidence.** Contradictory current evidence forces
   `unverified` with `confidence: "none"` until a moderator resolves it, and the
   conflicting items are marked in the evidence panel.
4. **Kind ceilings.** An official website can never support more than
   `self-declared`; a menu photo can never support more than
   `community-verified`. A certificate with no named body drops to
   `self-declared`.
5. **Interested parties cannot self-verify.** Evidence from an owner, employee,
   agency, family member or paid creator — or any incentivized submission — is
   capped at `self-declared`, and the cap is stated in the reasons.

### Branch scoping

Each branch is its own `places` row, and `listApprovedEvidenceRecords` keys on
`place_id` alone. Evidence for one location therefore cannot reach another. The
`branch` scope and the `branch_label` fact exist to say so on the page.

### Two derivations, one rule set

The profile derives status in TypeScript; the map and list derive it in SQL
(`EVIDENCE_AGGREGATE` / `STATUS_EXPRESSION` in `src/lib/discovery.ts`) so a whole
viewport can be filtered in one query. **The two must agree.** When changing one,
change the other, and re-check the kind ceilings, the expiry rule, the
interested-party cap and the conflict branch.

## No star ratings

The quality signal is return intent, not stars. `place_ratings` and
`place_reviews` predate this work and still render; nothing new writes a numeric
score.

Two aggregation safeguards live in `summarizeCheckIns`:

- **Verified and unverified experience never merge.** They are two buckets with
  two counts, presented as two rows.
- **No percentage from a thin sample.** Below `MIN_PUBLISHABLE_SAMPLE` (5) the
  bucket reports `wouldReturnPercent: null` and `insufficientData: true`, and
  the UI shows counts instead. The same floor applies per dish
  (`MIN_DISH_SAMPLE`, 3).

## Privacy of verification

`src/lib/visit-verification.ts` returns a *derived* result — method, confidence
and a short detail string — and nothing else. Raw coordinates live only for the
duration of one request; `place_visits` stores no lat/lng at all. Receipts go to
R2 behind the owner-scoped download route and are never exposed by a public
query. A failed location proof is never an error: it downgrades the visit to a
clearly labelled manual one.

## Anti-manipulation

`src/lib/anti-manipulation.ts`:

- **No direct review links.** `safeMerchantTarget` accepts only the factual
  profile, a city page or the home page; anything matching a feedback path, and
  anything off-platform, is refused.
- **Incentive disclosure.** The check-in asks whether the visit was rewarded.
  Rewarded feedback is labelled and excluded from every aggregate.
- **Relationship disclosure.** Owners, staff, agencies, family and paid
  creators declare the relationship; the same exclusion applies, and a known
  but undisclosed affiliation is routed to moderation.
- **Weight caps.** `contributorWeight` bounds new, inaccurate and bursty
  accounts to a multiplier in [0, 1]. `detectAnomalies` flags bursts, single
  account dominance and tight groups for review — it never deletes silently.
- **Trust recovery.** A restriction is proportionate and recoverable through
  accurate contributions.

## Moderation and audit

- The evidence queue is ordered by an **explainable** score
  (`prioritizeQueue`): conflicts, open reports, declared interest, expiry, claim
  impact, blast radius and waiting time. Each row carries its own rationale
  strings, shown in the console.
- Halal-sensitive edits (alcohol, pork, kitchen, certification body, name,
  closure) **always** queue, whatever the contributor's history.
- Every consequential decision writes an `audit_log` row with actor, action,
  target, reason and source. `place_halal_status_history` records each status
  transition and what caused it.
- A duplicate merge moves visits, evidence, dishes, photos, saves, ratings,
  reviews and list entries onto the kept place *before* retiring the duplicate,
  so nothing is lost.
- Every decided report can be appealed exactly once.

## No universal reviewer score

The diner profile shows cities, cuisines, verified visits and lists — and
deliberately no single reputation number, with the reason printed on the page.

**Known tension with an existing feature:** `/leaderboard` ranks contributors by
a single weighted score. The catalogue lists "universal reviewer leaderboard"
under *Avoid*. This change does not remove the page — that is a product call for
the owner — but it adds no reputation number anywhere else, and nothing on the
new surfaces reads from that score.

## What is deliberately not built here

The catalogue's `Next`, `Later` and `Avoid` bands. Most notably: pairwise
comparisons, the taste graph and personal match, follows and trusted-person
weighting, merchant claiming and analytics, group shortlists, travel mode, and
the AI concierge. The catalogue's own gate applies — those wait for real usage
data rather than being simulated at launch.
