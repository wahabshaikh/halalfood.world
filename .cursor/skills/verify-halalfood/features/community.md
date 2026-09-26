# Community

The leaderboard ranks people who add places, submit halal checks, write reviews, upload photos, and leave visit signals.

## Sub-features

- Heading `Community` and the lead about people who add places and check them in person.
- Section `Top helpers`. With no contributors the line is `Be the first on the board.`
- A podium list named `Top three` when at least one person has points.
- Empty state `Nobody’s on the board yet.` with a link `Add a place` to `/add`.
- Section `How points work`. The sentence includes the weights 10 (place), 8 (halal check), 5 (review), 3 (photo), and 1 (visit signal).
- Section `Creators people have linked` when creator rows exist, linking to `/creator/<platform>/<handle>`.

## How to get to it (user POV)

Choose `Community` in the `Explore` tabs, the footer column `Community`, or the header menu. On a phone the bottom navigation `Main` has `Community`, which goes to `/leaderboard`.

## Driving it with Playwright

```js
await page.goto(base + "/");
await page.getByRole("navigation", { name: "Explore" }).getByRole("link", { name: "Community" }).click();
await page.waitForURL(/\/leaderboard$/);
await page.getByRole("heading", { level: 1, name: "Community" }).waitFor();
await page.getByRole("heading", { name: "Top helpers" }).waitFor();
await page.getByRole("heading", { name: "How points work" }).waitFor();
```

The same ranking is `GET /api/leaderboard` (`Cache-Control` allows a short public cache). On the seeded server the first contributor is Amina Rahman with score 34 (two places, one halal check, one review, one visit signal) and the second is Yusuf Ali with score 15 (one place, one review). The page shows `Amina Rahman` and `34 pts`, and it does not show the fixture email, a raw user id, or `Nobody’s on the board yet.`

Amina Rahman is `11111111-1111-4111-8111-111111111111` and Yusuf Ali is `22222222-2222-4222-8222-222222222222` in `seed/verify.sql`. Those rows are not a login. The public board does not need a session.

## Gotchas

- Saved places are not scored. A save-only account does not appear.
- The moderation console at `/admin` is not this page. It returns 403 unless the signed-in user is in the `moderators` table.
- `Your contributions` (`/contributions`) needs a session. Without one it sends the visitor toward sign-in. Do not treat that redirect as a leaderboard failure.
