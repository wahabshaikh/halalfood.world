# The halal model

How halalfood.world decides what to show about a place. The code is
[`packages/core/src/halal.ts`](../../packages/core/src/halal.ts); the full
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
| Map listing (OpenStreetMap via Overpass, Geoapify) | `pork` = no when the listing says halal "only" | imported by `npm run signals:listings` | no, context only |

Certificates and menus live in `place_signals`. People send them from the place
page: the photo goes through the normal photo upload, then
`POST /api/places/[id]/evidence` queues it. Moderators approve or reject it on
`/admin` (the Evidence tab), which audits the decision and recomputes the place.

Map listings are imported per city by
[`scripts/import-listing-signals.ts`](../../apps/web/scripts/import-listing-signals.ts).
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
- If nothing settles it, the value is the community value, or else the map listing's.

Each fact records which sources back its value, so the place page can say how
it is known: "7 people · Halal certificate", or "Sources disagree".

A place is:

- **Verified** when all four facts are settled;
- **n of 3 checks** when anyone has checked it or a document settled a fact: n is the lowest streak among facts that have a value (a settled fact counts as 3), no more than the number of people who checked, clamped to 1–2;
- **Not checked yet** otherwise. A map listing alone never moves a place off this. It never means "not halal".

Filters match a fact's current value, settled or not; a place with no value for that fact is left out. The Verified filter needs all four settled.

## What can't change a status

Likes, follows, lists, recs, RSVPs, points, creator videos, "How was it?" verdicts and dishes are context. They help people choose where to eat and never touch the status. Nobody can pay to change a status or a ranking.

## The safety net

People report places, checks, comments, people and lists. Moderators act on reports: reset a place's checks, mark it closed, merge a duplicate, fix its details, exclude a check, remove a comment, suspend an account, or dismiss the report. They also review certificates and menus before those count. Every action is audited, and any action that touches checks or evidence recomputes the place.
