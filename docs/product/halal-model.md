# The halal model

How halalfood.world decides what to show about a place. The code is
[`packages/core/src/halal.ts`](../../packages/core/src/halal.ts); the full
product spec is [`simplified-community-spec.md`](simplified-community-spec.md).

## Four facts

| Fact | Question | Favourable |
| --- | --- | --- |
| `owned` | Is it Muslim-owned? | Yes |
| `certified` | Is it halal certified? | Yes |
| `pork` | Does it serve pork? | No |
| `alcohol` | Does it serve alcohol? | No |

Each answer is `yes`, `no` or `unsure`, or skipped. Nothing else feeds the status.

## Which checks count

A check counts the moment it is sent, with no moderator approval, when:

- its author's account was at least 24 hours old when they sent it,
- it is the author's latest check at that place,
- a moderator hasn't excluded it, and
- the author isn't suspended.

## From answers to a status

For each fact, take the counted checks that answered `yes` or `no`, newest first.

- **Value** is the newest definite answer.
- **Streak** is how many of the newest answers in a row match it, capped at 3. `unsure` and skipped answers never break a streak.
- The fact is **settled** at a streak of 3.

A place is:

- **Community verified** when all four facts are settled;
- **n of 3 checks** when anyone has checked it: n is the lowest streak among facts that have a value, clamped to 1–2;
- **Not checked yet** otherwise. This never means "not halal".

Filters match a fact's current value, settled or not; a place with no answer for that fact is left out. The Verified filter needs all four settled.

## What can't change a status

Likes, follows, lists, recs, RSVPs, points, creator videos, "How was it?" verdicts and dishes are context. They help people choose where to eat and never touch the status. Nobody can pay to change a status or a ranking.

## The safety net

People report places, checks, comments, people and lists. Moderators act on reports and nothing else: reset a place's checks, mark it closed, merge a duplicate, fix its details, exclude a check, remove a comment, suspend an account, or dismiss the report. Every action is audited, and any action that touches checks recomputes the place.
