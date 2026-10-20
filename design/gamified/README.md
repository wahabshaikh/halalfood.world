# Gamified Halalfood — design canvas source

Three design directions for a community-verified, gamified halalfood.world,
as 27 mobile screens (390×844) plus an overview artboard.

Published canvas: https://claude.ai/code/artifact/ef884d0d-823b-4642-896b-21d91b384831

## Directions

| Prefix | Name    | Character |
| ------ | ------- | --------- |
| `A`    | Mizan   | Warm paper, Instrument Serif over DM Sans. Trust-first and understated; evolves the current site's leaf/paper palette. |
| `B`    | Suhoor  | Near-black with lantern amber and mint, Archivo over Space Grotesk. Leagues, seasons, streak multipliers, live city feed. |
| `C`    | Zellige | Cream, teal and saffron, Syne over Karla, 2px ink borders. Verification as four tiles you turn; city passports and stamps. |

## Screens (same nine per direction)

`Home` discovery · `Place` detail · `Rate` three-way rating and review ·
`Proof` submit a verification proof · `Submit` add a new place ·
`Lists` saved and followed lists · `Board` leaderboard · `Profile` rank and
badges · `City` crawlable city page.

## Shared product model

- **Ratings** — Mashallah (loved it) / Alhamdulillah (good) / Astaghfirullah (avoid).
- **Trust ladder** — Unverified → Certified → Zabiha confirmed, plus Lapsed.
  Modelled on how Zabihah separates hand-slaughtered from machine-slaughtered,
  but each step here is earned by a proof a member photographed.
- **Proofs** — certificate, meat supplier, menu, staff answer. Two other
  members confirm each one before it counts.
- **Points** — proof accepted +75, new place +50, rating with a note +25,
  menu photo +15, confirming someone's proof +5, rejected proof −25.
- **Ranks** — Newcomer → Taster → Regular → Scout → Guide → Muhtasib.

All place names, member names, counts and ratings in the screens are sample
content. City and road names are real; the businesses are not.

## Files

- `*.dc.html` — one artboard each; static mockups, no interaction wired up.
- `canvas.json` — artboard positions, titles and sticky notes.
- `halalfood-community.html` — the seeded canvas that gets published.

To change a screen, edit its `.dc.html`, then re-seed a fresh copy and
republish to the same artifact URL. Never hand-edit `halalfood-community.html`.
