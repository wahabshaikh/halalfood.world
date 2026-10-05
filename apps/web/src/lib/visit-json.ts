import type { Visit } from "./feed";
import { avatarUrl } from "./profiles";
import { photoUrl } from "./place-view";

/** The wire shape of a visit for the feed and visit APIs. */
export function visitJson(visit: Visit) {
  return {
    ...visit,
    author: { ...visit.author, avatarUrl: visit.author.handle ? avatarUrl(visit.author.avatarKey, visit.author.handle) : null },
    photos: visit.photoKeys.map((key) => photoUrl(key)),
  };
}
