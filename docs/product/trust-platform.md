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

---

# The data expansion strategy

A second document — the product data expansion and monetization strategy — sets
out how this becomes a global provenance network rather than one city's guide.
What it adds to the rules above, and what this codebase now enforces:

## Provenance is structural, not a field

The strategy's non-negotiables include *every important fact has provenance and
an observation date* and *historical values are appended, not overwritten*.
`place_observations` is append-only: there is no code path that updates an
observation's value. A change is a new row with a later `observedAt`, and
`projectFacts` in `src/lib/observations.ts` collapses the log into what is
published today while keeping the history, the staleness and the disagreement
attached.

When two current observations conflict, the stronger **source class** wins — a
government record outranks an official API, which outranks the restaurant's own
page, which outranks a web extraction — then declared confidence, then recency.
The losing reading is not discarded: it is published as a disagreement, because
*conflicting sources are represented rather than averaged away*.

An accepted community correction appends an observation **before** the
`places` / `place_facts` projection is written. Those columns are a cache the
discovery query filters on; the observation log is the record.

## Independent dimensions

The strategy separates food, dish, value, service, hygiene and halal, each with
its own preferred evidence. This codebase keeps them apart:

| Dimension | Where it lives |
| --- | --- |
| Food | Return intent from verified visits (`summarizeCheckIns`) |
| Dish | Per-dish verdicts (`summarizeDishes`) |
| Value | `valueVerdict` and spend, reported separately |
| Service | `serviceVerdict`, asked and reported as its own question |
| Hygiene | `place_inspections`, its own panel, never mixed into a diner figure |
| Halal | The evidence taxonomy above |

An official record carries its authority, grade, inspection date, licence status
and a link, plus an explicit **match confidence** — matching a government
register to a restaurant is error-prone, and a low-confidence match says so on
the page rather than presenting a possibly-wrong record as fact.

## Coverage is stated honestly

Places carry a coverage level — indexed, enriched, intelligent, trusted —
derived in `coverageLevel()` from what is actually attached, never from intent.
The place page recomputes it and writes the projection back, so the city
aggregate and the place badge cannot show a visitor two different answers.

City pages publish the real counts and never round up: a city with nothing
enriched says so, and an unindexed city says *"not indexed yet"*. Both offer the
request action, which is the point — launch traffic arrives from everywhere at
once, and a "coming soon" page throws away the most valuable signal of the
launch. Requests are de-duplicated by a salted hash rather than a visitor log,
and feed `cityDemandScore`.

## The reputation ladder

`src/lib/reputation.ts` implements new → contributor → trusted → city expert →
city moderator. Promotion needs accepted volume, **accuracy** and verified
visits together, so a prolific but frequently-rejected contributor does not
advance while a careful one does. Standing is recomputed from the contributions
themselves on every decision, so a reversal actually costs standing. City
moderator is never automatic — it carries the power to overrule other
contributors, so a human grants it.

This controls privileges only. There is still no public reviewer score.

## Money cannot reach a ranking

`sponsored_placements` is a separate table that **no discovery query joins**.
`attachSponsored` returns sponsored slots as a distinct list from the organic
order, so a caller cannot splice them into the ranking, and every slot carries
its disclosure. `stripCommercialSignals` drops anything commercial before a
ranking input is read — the unit tests assert that the organic order comes back
unchanged and that no commercial key survives.

Transaction handoffs name the provider and disclose a possible commission. They
are recorded in `transaction_handoffs`, which likewise joins nothing in scoring.

## Deliberately not built here

The strategy is a multi-quarter plan; this branch implements the parts that are
product rules rather than data operations. Not built: source adapters and
ingestion (Overture, OSM, commercial platforms, FSSAI matching), the CityPack
configuration and global shell import, dish canonicalisation across restaurants,
Restaurant Pro and the claim flow, the derived-intelligence API, and consumer
Pro. The schema is shaped so those attach without rewriting the product model —
which is the strategy's own first instruction: *freeze the evidence model before
adding more source-specific fields.*

Nothing here is legal advice, and no scraping adapter is included. The
strategy's acquisition posture — open and licensed data as the durable base,
commercial extraction as a replaceable adapter reviewed by counsel — is recorded
in `place_source_records`, which stores the licence and attribution alongside
every retrieval so an export cannot silently redistribute something the terms
did not permit.
