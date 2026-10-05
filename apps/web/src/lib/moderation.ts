/**
 * Moderation (spec §5.5, §6.21): moderators act on reports and nothing else.
 * Every action writes the audit log, and anything that touches checks
 * recomputes the place's status.
 */
import { sql, type SQL } from "drizzle-orm";
import { ACTION_LABEL, primaryAction, type ReportTarget } from "@halalfood/core/moderation";
import { database } from "../db";
import { recomputePlaceStatus, runBatch } from "./checks-repository";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export const ACTIONS = [
  "reset-checks",
  "mark-closed",
  "merge",
  "fix-details",
  "hide-place",
  "hide-comment",
  "exclude-check",
  "suspend-user",
  "hide-list",
  "dismiss",
] as const;
export type Action = (typeof ACTIONS)[number];

export type ReportView = {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  reason: string;
  detail: string | null;
  createdAt: number;
  reporter: string | null;
  target: { title: string; subtitle: string | null; href: string | null };
  primary: string;
  primaryLabel: string;
};

/** Open reports, oldest first, with enough about each target to act on it. */
export async function listOpenReports(client: Client = database()): Promise<ReportView[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT r.id, r.target_type, r.target_id, r.reason, r.detail, r.created_at, rp.handle AS reporter,
      p.name AS place_name, p.street_address AS place_address, p.listing_status AS place_listing,
      cp.id AS check_place_id, cp.name AS check_place_name, cpr.handle AS check_author, ch.note AS check_note,
      cm.body AS comment_body, cm.check_id AS comment_check_id, cmr.handle AS comment_author,
      up.handle AS user_handle, up.display_name AS user_name,
      l.title AS list_title
    FROM reports r
    LEFT JOIN profiles rp ON rp.user_id = r.reporter_id
    LEFT JOIN places p ON r.target_type = 'place' AND p.id = r.target_id
    LEFT JOIN checks ch ON r.target_type = 'check' AND ch.id = r.target_id
    LEFT JOIN places cp ON cp.id = ch.place_id
    LEFT JOIN profiles cpr ON cpr.user_id = ch.user_id
    LEFT JOIN comments cm ON r.target_type = 'comment' AND cm.id = r.target_id
    LEFT JOIN profiles cmr ON cmr.user_id = cm.user_id
    LEFT JOIN profiles up ON r.target_type = 'user' AND up.user_id = r.target_id
    LEFT JOIN lists l ON r.target_type = 'list' AND l.id = r.target_id
    WHERE r.status = 'open'
    ORDER BY r.created_at ASC
    LIMIT 200
  `);
  return rows.map((row) => {
    const targetType = row.target_type as ReportTarget;
    const targetId = String(row.target_id);
    const target =
      targetType === "place"
        ? { title: String(row.place_name ?? "A deleted place"), subtitle: (row.place_address as string | null) ?? null, href: row.place_name ? `/place/${targetId}` : null }
        : targetType === "check"
          ? {
              title: `Check by @${row.check_author ?? "someone"} at ${row.check_place_name ?? "a place"}`,
              subtitle: (row.check_note as string | null) ?? null,
              href: row.check_place_id ? `/visit/${targetId}` : null,
            }
          : targetType === "comment"
            ? { title: `Comment by @${row.comment_author ?? "someone"}`, subtitle: (row.comment_body as string | null) ?? null, href: row.comment_check_id ? `/visit/${row.comment_check_id}` : null }
            : targetType === "user"
              ? { title: `@${row.user_handle ?? "someone"}`, subtitle: (row.user_name as string | null) ?? null, href: row.user_handle ? `/u/${row.user_handle}` : null }
              : { title: String(row.list_title ?? "A deleted list"), subtitle: null, href: row.list_title ? `/list/${targetId}` : null };
    const primary = primaryAction(targetType, String(row.reason));
    return {
      id: String(row.id),
      targetType,
      targetId,
      reason: String(row.reason),
      detail: (row.detail as string | null) ?? null,
      createdAt: Number(row.created_at),
      reporter: (row.reporter as string | null) ?? null,
      target,
      primary,
      primaryLabel: ACTION_LABEL[primary] ?? primary,
    };
  });
}

export type ActionInput = {
  action: Action;
  intoPlaceId?: string;
  details?: { name?: string; telephone?: string | null; website?: string | null; address?: string };
};

export type ActionResult = { ok: true } | { ok: false; status: number; error: string };

function audit(moderatorId: string, action: string, targetType: string, targetId: string, reason: string | null, before: unknown, after: unknown, now: number): SQL {
  return sql`INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, reason, before_value, after_value, created_at)
    VALUES (${crypto.randomUUID()}, ${moderatorId}, ${action}, ${targetType}, ${targetId}, ${reason},
      ${before === undefined ? null : JSON.stringify(before)}, ${after === undefined ? null : JSON.stringify(after)}, ${now})`;
}

function cleanDetail(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

/** Take an action on one report. */
export async function actOnReport(reportId: string, moderatorId: string, input: ActionInput, client: Client = database(), now = Date.now()): Promise<ActionResult> {
  const db = await client;
  const [report] = await db.all<{ target_type: ReportTarget; target_id: string; reason: string; status: string }>(sql`
    SELECT target_type, target_id, reason, status FROM reports WHERE id = ${reportId}
  `);
  if (!report) return { ok: false, status: 404, error: "That report could not be found." };
  if (report.status !== "open") return { ok: false, status: 409, error: "That report was already handled." };
  const { target_type: targetType, target_id: targetId } = report;
  const close = (status: "actioned" | "dismissed") =>
    sql`UPDATE reports SET status = ${status}, action = ${input.action}, reviewed_by = ${moderatorId}, updated_at = ${now}
        WHERE (id = ${reportId}) OR (status = 'open' AND target_type = ${targetType} AND target_id = ${targetId} AND ${status === "actioned" ? 1 : 0} = 1)`;
  const log = (before?: unknown, after?: unknown) => audit(moderatorId, input.action, targetType, targetId, report.reason, before, after, now);
  const recompute: string[] = [];

  switch (input.action) {
    case "dismiss":
      await runBatch(db, [close("dismissed"), log()]);
      return { ok: true };

    case "reset-checks":
    case "mark-closed":
    case "hide-place":
    case "fix-details":
    case "merge": {
      if (targetType !== "place") return { ok: false, status: 400, error: "That action is for places." };
      const [place] = await db.all<Record<string, unknown>>(sql`SELECT id, name, telephone, website, street_address, listing_status FROM places WHERE id = ${targetId}`);
      if (!place) return { ok: false, status: 404, error: "That place is gone." };
      if (input.action === "reset-checks") {
        await runBatch(db, [
          sql`DELETE FROM points WHERE kind = 'check' AND check_id IN (SELECT id FROM checks WHERE place_id = ${targetId} AND created_at <= ${now})`,
          sql`UPDATE checks SET excluded = 1 WHERE place_id = ${targetId} AND created_at <= ${now}`,
          close("actioned"),
          log(),
        ]);
        recompute.push(targetId);
      } else if (input.action === "mark-closed" || input.action === "hide-place") {
        const next = input.action === "mark-closed" ? "closed" : "hidden";
        await runBatch(db, [
          sql`UPDATE places SET listing_status = ${next}, updated_at = ${now} WHERE id = ${targetId}`,
          close("actioned"),
          log({ listing_status: place.listing_status }, { listing_status: next }),
        ]);
      } else if (input.action === "fix-details") {
        const details = input.details ?? {};
        const name = cleanDetail(details.name, 120);
        const address = cleanDetail(details.address, 200);
        const telephone = cleanDetail(details.telephone, 40);
        const website = cleanDetail(details.website, 300);
        if (website && !/^https?:\/\//i.test(website)) return { ok: false, status: 400, error: "Websites start with http:// or https://." };
        const sets: SQL[] = [sql`updated_at = ${now}`];
        if (name) sets.push(sql`name = ${name}`);
        if (address) sets.push(sql`street_address = ${address}`);
        if (telephone !== undefined) sets.push(sql`telephone = ${telephone}`);
        if (website !== undefined) sets.push(sql`website = ${website}`);
        if (sets.length === 1) return { ok: false, status: 400, error: "Change at least one detail." };
        await runBatch(db, [
          sql`UPDATE places SET ${sql.join(sets, sql`, `)} WHERE id = ${targetId}`,
          close("actioned"),
          log(
            { name: place.name, telephone: place.telephone, website: place.website, address: place.street_address },
            { name, telephone, website, address },
          ),
        ]);
      } else {
        const into = input.intoPlaceId;
        if (!into || into === targetId) return { ok: false, status: 400, error: "Pick the place to merge into." };
        const [keep] = await db.all(sql`SELECT 1 FROM places WHERE id = ${into}`);
        if (!keep) return { ok: false, status: 404, error: "The place to merge into is gone." };
        await runBatch(db, [
          sql`UPDATE checks SET place_id = ${into} WHERE place_id = ${targetId}`,
          sql`UPDATE place_photos SET place_id = ${into} WHERE place_id = ${targetId}`,
          sql`UPDATE OR IGNORE saved_places SET place_id = ${into} WHERE place_id = ${targetId}`,
          sql`UPDATE OR IGNORE list_items SET place_id = ${into} WHERE place_id = ${targetId}`,
          sql`UPDATE OR IGNORE place_media_links SET place_id = ${into} WHERE place_id = ${targetId}`,
          sql`UPDATE event_vendors SET place_id = ${into} WHERE place_id = ${targetId}`,
          sql`UPDATE OR IGNORE points SET place_id = ${into} WHERE place_id = ${targetId}`,
          sql`UPDATE recs SET place_id = ${into} WHERE place_id = ${targetId}`,
          close("actioned"),
          log({ place: targetId, name: place.name }, { into }),
          sql`DELETE FROM places WHERE id = ${targetId}`,
        ]);
        recompute.push(into);
      }
      break;
    }

    case "hide-comment": {
      if (targetType !== "comment") return { ok: false, status: 400, error: "That action is for comments." };
      await runBatch(db, [sql`UPDATE comments SET status = 'hidden' WHERE id = ${targetId}`, close("actioned"), log()]);
      break;
    }

    case "exclude-check": {
      if (targetType !== "check") return { ok: false, status: 400, error: "That action is for checks." };
      const [check] = await db.all<{ place_id: string }>(sql`SELECT place_id FROM checks WHERE id = ${targetId}`);
      if (!check) return { ok: false, status: 404, error: "That check is gone." };
      await runBatch(db, [
        sql`UPDATE checks SET excluded = 1 WHERE id = ${targetId}`,
        sql`DELETE FROM points WHERE check_id = ${targetId}`,
        close("actioned"),
        log(),
      ]);
      recompute.push(check.place_id);
      break;
    }

    case "suspend-user": {
      if (targetType !== "user") return { ok: false, status: 400, error: "That action is for people." };
      const places = await db.all<{ place_id: string }>(sql`SELECT DISTINCT place_id FROM checks WHERE user_id = ${targetId}`);
      await runBatch(db, [
        sql`UPDATE profiles SET suspended_at = ${now}, updated_at = ${now} WHERE user_id = ${targetId}`,
        sql`DELETE FROM session WHERE user_id = ${targetId}`,
        close("actioned"),
        log(),
      ]);
      recompute.push(...places.map((row) => row.place_id));
      break;
    }

    case "hide-list": {
      if (targetType !== "list") return { ok: false, status: 400, error: "That action is for lists." };
      await runBatch(db, [sql`UPDATE lists SET visibility = 'private', updated_at = ${now} WHERE id = ${targetId}`, close("actioned"), log()]);
      break;
    }
  }
  for (const placeId of recompute) await recomputePlaceStatus(placeId, db, now);
  return { ok: true };
}
