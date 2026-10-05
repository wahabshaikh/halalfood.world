/**
 * What a new check sets off besides its status: a note to everyone who saved
 * the place when its status changes, and a friend-visit note to followers who
 * want to try it. Failures here never fail the check itself.
 */
import { sql } from "drizzle-orm";
import type { CheckInput } from "@halalfood/core/check";
import { database } from "../db";
import type { Recompute } from "./checks-repository";
import { notify, type NewNotification } from "./notifications";
import type { PlaceDetail } from "./places";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

export async function afterCheck(
  userId: string,
  place: PlaceDetail,
  checkId: string,
  input: CheckInput,
  recompute: Recompute,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
) {
  try {
    const db = await client;
    const notes: NewNotification[] = [];
    if (recompute.changes.length) {
      const savers = await db.all<{ user_id: string }>(sql`SELECT user_id FROM saved_places WHERE place_id = ${place.id}`);
      for (const change of recompute.changes)
        for (const saver of savers)
          notes.push({
            userId: saver.user_id,
            kind: "status-changed",
            placeId: place.id,
            statusChangeId: change.id,
            dedupeKey: `status:${change.id}`,
          });
    }
    if (input.shared) {
      const followers = await db.all<{ follower_id: string }>(sql`
        SELECT f.follower_id FROM follows f JOIN saved_places sp ON sp.user_id = f.follower_id AND sp.place_id = ${place.id}
        WHERE f.followee_id = ${userId} AND f.status = 'accepted'
      `);
      for (const follower of followers)
        notes.push({
          userId: follower.follower_id,
          kind: "friend-visit",
          actorId: userId,
          placeId: place.id,
          checkId,
          dedupeKey: `friend-visit:${userId}:${place.id}:${new Date().toISOString().slice(0, 10)}`,
        });
    }
    await notify(notes, db);
  } catch {
    // The check and its status are already stored; a missed note is not worth a failed request.
  }
}
