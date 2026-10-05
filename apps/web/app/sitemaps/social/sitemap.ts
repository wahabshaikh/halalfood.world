import type { MetadataRoute } from "next";
import { sql } from "drizzle-orm";
import { database } from "../../../src/db";
import { SIX_HOURS } from "../../../src/lib/events";
import { canonical } from "../../../src/lib/seo";

export const dynamic = "force-dynamic";

/** Public lists, public profiles with at least one shared check, and upcoming events (spec §11). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const db = await database();
    const now = Date.now();
    const [lists, people, events] = await Promise.all([
      db.all<{ id: string; updated_at: number }>(sql`
        SELECT l.id, l.updated_at FROM lists l LEFT JOIN profiles pr ON pr.user_id = l.owner_id
        WHERE l.visibility = 'public' AND COALESCE(pr.suspended_at, 0) = 0 AND EXISTS (SELECT 1 FROM list_items i WHERE i.list_id = l.id)
        ORDER BY l.updated_at DESC LIMIT 5000
      `),
      // check-visibility: aggregate — only whether a public profile has any shared check.
      db.all<{ handle: string; updated_at: number }>(sql`
        SELECT pr.handle, pr.updated_at FROM profiles pr
        WHERE pr.is_private = 0 AND pr.suspended_at IS NULL
          AND EXISTS (SELECT 1 FROM checks c WHERE c.user_id = pr.user_id AND c.shared = 1 AND c.excluded = 0)
        LIMIT 5000
      `),
      db.all<{ id: string; updated_at: number }>(sql`
        SELECT id, updated_at FROM events WHERE status = 'published' AND COALESCE(ends_at, starts_at + ${SIX_HOURS}) >= ${now} LIMIT 1000
      `),
    ]);
    return [
      ...events.map((event) => ({ url: canonical(`/event/${event.id}`), lastModified: new Date(event.updated_at), changeFrequency: "daily" as const, priority: 0.6 })),
      ...lists.map((list) => ({ url: canonical(`/list/${list.id}`), lastModified: new Date(list.updated_at), changeFrequency: "weekly" as const, priority: 0.5 })),
      ...people.map((person) => ({ url: canonical(`/u/${person.handle}`), lastModified: new Date(person.updated_at), changeFrequency: "weekly" as const, priority: 0.3 })),
    ];
  } catch {
    return [];
  }
}
