# The halal model

How halalfood.world decides what to show about a place. The code is
[`lib/core/halal.ts`](../../lib/core/halal.ts); the full
product spec is [`simplified-community-spec.md`](simplified-community-spec.md).
Where the two differ, this page and the code are current: community checks are
one source of evidence among several, and "Community verified" is now "Verified".

## Four facts

| Fact | Question | Favourable |
| --- | --- | --- |
| `owned` | Is it Muslim-owned? | Yes |
| `certified` | Is it halal certified? | Yes |
| `pork` | Does it serve pork? | No |
| `alcohol` | Does it serve alcohol? | No |

## Sources of evidence

| Source | Answers | Counts when | Settles a fact? |
| --- | --- | --- | --- |
| Community checks | all four | the check is eligible (below) | yes, at 3 or more matching answers |
| Halal certificate | `certified` = yes | a moderator approves the photo, and it hasn't expired | yes |
| Menu | `pork`, `alcohol` | a moderator approves the photo | yes, for the answers it shows |
| Map listing (OpenStreetMap via Overpass, Geoapify) | `pork` = no when the listing says halal "only" | imported by `pnpm signals:listings` | no, context only |
| Web source (Halal Food Scout) | any of the four, each with the https page that says it | written by `upsert_place` | no, context only |

Certificates and menus live in `place_signals`. People send them from the place
page: the photo goes through the normal photo upload, then
`POST /api/places/[id]/evidence` queues it. Moderators approve or reject it on
`/admin` (the Evidence tab), which audits the decision and recomputes the place.

Web sources live in `place_claims` (source `scout`): one claim per place and fact, with its URL, certifier (for
certified = yes) and date. Halal Food Scout writes them through `upsert_place`'s attributes. "Unknown" is never stored.
Scout only writes a claim when no community check or approved document answers the fact, and a newer Scout claim
replaces its older one ([architecture](../architecture.md#scout-attributes)). The place page links "Web source" on each
fact a claim backs.

Map listings are imported per city by
[`scripts/import-listing-signals.ts`](../../scripts/import-listing-signals.ts).
It reads OpenStreetMap's `diet:halal` tag (`only`, `yes`, `limited`, `no`)
through Overpass, plus Geoapify's `halal` and `halal.only` places when
`GEOAPIFY_API_KEY` is set, and matches each one to a listed place by name
within 80 m. The place page shows what listings say as a line under the facts.

## Which checks count

A check counts the moment it is sent, with no moderator approval, when:

- its author's account was at least 24 hours old when they sent it,
- it is the author's latest check at that place,
- a moderator hasn't excluded it, and
- the author isn't suspended.

## From evidence to a status

For each fact, take the counted checks that answered `yes` or `no`, newest first.

- The **community value** is the newest definite answer.
- The **streak** is how many of the newest answers in a row match it. It isn't capped: three is the minimum to settle, and every matching check after that keeps counting. `unsure` and skipped answers never break a streak.

Then combine the sources. The settling sources are a community streak of 3 or
more and any approved, unexpired certificate or menu that answers the fact.

- If they all agree, the fact is **settled** on that value.
- If they disagree, the fact is **disputed**: it shows the newest settling answer but isn't settled until they agree again.
- If nothing settles it, the value is the community value, or else a web source's, or else the map listing's. A web source cites a page for that very fact, so it outranks a listing.

Each fact records which sources back its value, so the place page can say how
it is known: "7 people · Halal certificate", or "Sources disagree".

A place is:

- **Verified** when all four facts are settled;
- **n of 3 checks** when anyone has checked it or a document settled a fact: n is the lowest streak among facts that have a value (a settled fact counts as 3), no more than the number of people who checked, clamped to 1–2;
- **Not checked yet** otherwise. A map listing or web source alone never moves a place off this. It never means "not halal".

Filters match a fact's current value, settled or not; a place with no value for that fact is left out. The Verified filter needs all four settled.

## What can't change a status

Likes, follows, lists, recs, RSVPs, points, creator videos, creator verifications ("Verified by <creator> in a
video", recorded by Halal Food Scout), "How was it?" verdicts and dishes are context. They help people choose where to eat and never touch the status. Nobody can pay to change a status or a ranking.

## Provenance

Where a listing came from is separate from its halal status. About 7.7k places were imported from the public
directory halalfoodnear.me (scraped Sep 13, 2026, carried into production at the Oct 5 cutover). They are marked
`places.import_source = 'halalfoodnear.me'` by migration 0007, which identifies them by the bulk insert's exact
`created_at` (1789282699475, 2026-09-13T06:58:19.475Z) and no submitter. Every other place has no import source and is
never labelled. The rule is [`lib/core/provenance.ts`](../../lib/core/provenance.ts).

An imported place counts as **seen and verified to exist** while any of these exists:

| Evidence | Counts when |
| --- | --- |
| A community check | it counts toward status (the same rule as [Which checks count](#which-checks-count)) |
| A certificate or menu | a moderator approved it (an expired certificate still shows the place exists) |
| A creator video verification | Halal Food Scout recorded it (`creator_verifications`) |
| A web source | a Scout claim of Halal certified = yes, with its source page |

A map listing never counts: it comes from a directory too. Until a place has evidence it shows **Unverified**
("Imported from a public directory and not yet checked by our community or a certifier."), its page is `noindex`
and it is left out of the sitemap. It stays listed on its city page, in search and on the map.

`places.import_verified_at` is recomputed from the evidence after every status recompute and every creator
verification write, so it goes back to unverified when the last piece is removed (a check excluded, a verification
removed, a claim withdrawn). Certifier data from PR #112 will count once it lands.

This never feeds the status. A creator video verification is context and still can't change a status ([What can't
change a status](#what-cant-change-a-status)), but it does show the place is real, so it lifts the Unverified label.
A place can be verified to exist and still be "Not checked yet"; "Unverified" is never a halal verdict.

## The safety net

People report places, checks, comments, people and lists. Moderators act on reports: reset a place's checks, mark it closed, merge a duplicate, fix its details, exclude a check, remove a comment, suspend an account, or dismiss the report. They also review certificates and menus before those count. Every action is audited, and any action that touches checks or evidence recomputes the place.
