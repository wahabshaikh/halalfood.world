# Evidence-first halal status

## Goal

Replace the unconditional “Halal listed” claim on restaurant pages with a truthful status derived from moderated community evidence.

## Public status contract

| Key | Label | Rule | Required explanation |
| --- | --- | --- | --- |
| `evidence-backed` | Evidence-backed | One or more approved halal-verification submissions exist for the place. | Show the approved submission count and the most recent moderation timestamp. State that evidence is community-submitted and reviewed, not a certification. |
| `unverified` | Unverified | No approved halal-verification submissions exist for the place. | State that halal evidence has not been reviewed yet. Explicitly clarify that unverified does not mean non-halal. |

If the status lookup fails, the page must fail closed with “Evidence status unavailable.” It must not silently present the place as evidence-backed or unverified.

## Data rules

- `places.halal_confirmed` remains the publication/listing flag. It is not a public evidence status.
- Only `place_halal_verifications.status = 'approved'` contributes to the public status.
- Pending submissions remain visible only to their submitter.
- Rejected submissions never contribute to the public status.
- The latest reviewed date comes from the maximum `updated_at` among approved submissions.
- No existing migration is changed and no new migration is required.

## Surfaces

- The place-page hero displays the derived label instead of “Halal listed.”
- The community-evidence section displays the same status, approved count, latest reviewed date, and explanatory copy.
- `GET /api/places/:id/verifications` returns a `summary` object alongside the existing `verifications` array.
- Documentation explains the distinction between directory inclusion, reviewed evidence, and certification.

## Non-goals

- Certification-body recognition, certificate expiry, supplier verification, restaurant-wide versus dish-level scope, “halal options,” “not halal,” and confidence scoring.
- Changes to map ranking, imported Google ratings, reactions, or reviews.
- A moderation UI.

## Acceptance criteria

1. Zero approved submissions produces `unverified`, count `0`, and no latest-reviewed timestamp.
2. One or more approved submissions produces `evidence-backed`, the exact approved count, and the latest valid moderation timestamp.
3. Pending and rejected submissions do not affect the summary.
4. The API never counts a signed-in user’s pending submission as approved evidence.
5. The hero and evidence section use truthful, consistent labels and explanations.
6. Repository, API, type, unit, and production-build checks pass on Node 22.
