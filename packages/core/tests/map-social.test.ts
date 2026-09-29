import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PIN_FRIENDS, pinFriends, socialLabel, type FriendVisit } from "../src/map-social";

const visit = (
  handle: string,
  verdict: FriendVisit["verdict"],
  visitedAt: number,
  displayName: string | null = null,
): FriendVisit => ({ handle, displayName, avatarUrl: null, verdict, visitedAt });

test("one friend's verdict sets the label", () => {
  assert.equal(socialLabel([visit("zaid", "favourite", 1, "Zaid Khan")]), "Zaid's favourite");
  assert.equal(socialLabel([visit("zaid", "liked", 1, "Zaid Khan")]), "Zaid loved this");
  assert.equal(socialLabel([visit("zaid", "okay", 1)]), "@zaid has been");
  assert.equal(socialLabel([visit("zaid", "disliked", 1, "Zaid")]), "Zaid has been");
});

test("several friends read as a count, newest first", () => {
  const friends = [
    visit("a", "liked", 1, "Aisha"),
    visit("z", "liked", 3, "Zaid"),
    visit("h", "liked", 2, "Hafsa"),
  ];
  assert.equal(socialLabel([friends[0], friends[2]]), "Hafsa and Aisha have been");
  assert.equal(socialLabel(friends), "Zaid, Hafsa and 1 friend have been");
});

test("a want-to-try with no friends says so, and nothing else says nothing", () => {
  assert.equal(socialLabel([], true), "On your want-to-try");
  assert.equal(socialLabel([]), null);
});

test("pins show a few faces, favourites first", () => {
  const friends = ["a", "b", "c", "d", "e"].map((h, i) =>
    visit(h, i === 4 ? "favourite" : "okay", i),
  );
  const pins = pinFriends(friends);
  assert.equal(pins.length, MAX_PIN_FRIENDS);
  assert.equal(pins[0].handle, "e");
});
