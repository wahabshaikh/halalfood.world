/**
 * Social labels for map pins and place sheets.
 *
 * A friend's visit is taste, so these strings only ever describe what a person
 * did ("Zaid loved this", "Zaid and Hafsa have been"). They never say anything
 * about the place's halal status, which pins still tint from approved evidence.
 */

import type { Verdict } from "./check-in";

export type FriendVisit = {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  verdict: Verdict | null;
  visitedAt: number;
};

/** Cap on faces per pin, so a busy place does not bury its neighbours. */
export const MAX_PIN_FRIENDS = 3;

function firstName(person: { handle: string; displayName: string | null }): string {
  const name = person.displayName?.trim().split(/\s+/)[0];
  return name || `@${person.handle}`;
}

/**
 * One line for a pin: the newest friend visit decides the wording, so a single
 * friend who loved a place reads "Zaid loved this" and a group reads as a count.
 */
export function socialLabel(friends: readonly FriendVisit[], wantsToTry = false): string | null {
  if (!friends.length) return wantsToTry ? "On your want-to-try" : null;
  const ordered = [...friends].sort((a, b) => b.visitedAt - a.visitedAt);
  const [latest] = ordered;
  if (ordered.length === 1) {
    const name = firstName(latest);
    if (latest.verdict === "favourite") return `${name}'s favourite`;
    if (latest.verdict === "liked") return `${name} loved this`;
    return `${name} has been`;
  }
  const names = ordered.slice(0, 2).map(firstName);
  const rest = ordered.length - names.length;
  if (rest <= 0) return `${names[0]} and ${names[1]} have been`;
  return `${names.join(", ")} and ${rest} ${rest === 1 ? "friend" : "friends"} have been`;
}

/** Pin faces: the most recent visitors, favourite and liked visits first. */
export function pinFriends(friends: readonly FriendVisit[]): FriendVisit[] {
  const weight = (verdict: Verdict | null) =>
    verdict === "favourite" ? 3 : verdict === "liked" ? 2 : verdict === "okay" ? 1 : 0;
  return [...friends]
    .sort((a, b) => weight(b.verdict) - weight(a.verdict) || b.visitedAt - a.visitedAt)
    .slice(0, MAX_PIN_FRIENDS);
}
