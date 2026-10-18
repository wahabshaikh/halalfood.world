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
| Menu (photo) | `pork`, `alcohol` | a moderator approves the photo | yes, for the answers it shows |
| Map listing (OpenStreetMap via Overpass, Geoapify) | `pork` = no when the listing says halal "only" | imported by `pnpm signals:listings` | no, context only |
| Web source (Halal Food Scout) | any of the four, each with the https page that says it | written by `upsert_place`, or by a flagged menu check (below) | no, context only |
| Published menu (Halal Food Scout) | nothing by itself; a flagged menu check can write a web source | written by `upsert_menu` / `set_menu_check` | no, context only |

Certificates and menus live in `place_signals`. People send them from the place
page: the photo goes through the normal photo upload, then
`POST /api/places/[id]/evidence` queues it. Moderators approve or reject it on
`/admin` (the Evidence tab), which audits the decision and recomputes the place.

Web sources live in `place_claims` (source `scout`): one claim per place and fact, with its URL, certifier (for
certified = yes) and date. Halal Food Scout writes them through `upsert_place`'s attributes. "Unknown" is never stored.
Scout only writes a claim when no community check or approved document answers the fact, and a newer Scout claim
replaces its older one ([architecture](../architecture.md#scout-attributes)). The place page links "Web source" on each
fact a claim backs.

### Published menus and the menu check

Halal Food Scout also stores the menu a restaurant publishes (its website or a delivery listing) as data: items with
prices by section, the https pages it was read from and the date (`place_menus` and friends,
[architecture](../architecture.md#scout-menus)). It is the same kind of evidence as a web source, not the menu
*photo* above: nobody reviews it, it settles nothing, and it never reaches `resolveFact` on its own. The place page
shows it under **Menu**, citing its sources and read date, with "A menu isn't a halal check."

Scout then records a **menu check**, its automated read of that menu for alcohol and pork, one per place
([`lib/core/menus.ts`](../../lib/core/menus.ts)):

| Status | What it does |
| --- | --- |
| `clean` | Shows the badge **Menu checked: no alcohol · no pork** in Halal facts, with a tooltip: an automated read of the published menu, not halal certification and not a community check. It never changes a status, never sets or settles a fact, never writes a claim (not even "no") and never clears an earlier one. The filters ignore it. |
| `flagged` | Each flag names a menu item or something else on the menu, with a reason. A flag with reason `alcohol` or `pork` writes a web source (`place_claims`, source `scout`) that the place serves it, `alcohol = yes` / `pork = yes`, citing the menu's source URL, under the usual Scout rule: only when no community check or approved document answers the fact, and a newer Scout claim replaces the older one. Reason `other` writes nothing. No badge. |
| `no_menu` | Records that Scout looked and found no menu online. Nothing else; no badge. |

Why the asymmetry: a menu that lists beer is good evidence the place serves alcohol, but a menu that doesn't list it
says little (drinks lists go missing, menus go stale), so a clean read only earns a labelled badge. The badge is
never shown for flagged or `no_menu`, and the community and moderators still decide every fact and the status.
Withdrawing a claim a flagged check wrote is `upsert_place` with that attribute `unknown`.

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
video", recorded by Halal Food Scout), published menus, clean menu checks and logos, "How was it?" verdicts and dishes are context. They help people choose where to eat and never touch the status. Nobody can pay to change a status or a ranking.

## The safety net

People report places, checks, comments, people and lists. Moderators act on reports: reset a place's checks, mark it closed, merge a duplicate, fix its details, exclude a check, remove a comment, suspend an account, or dismiss the report. They also review certificates and menus before those count. Every action is audited, and any action that touches checks or evidence recomputes the place.
