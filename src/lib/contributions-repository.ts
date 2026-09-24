/** D1 access for factual edits, duplicate reports and contribution status. */

import { eq, sql } from "drizzle-orm";
import { database } from "../db";
import { placeDuplicateReports, places } from "../db/schema";
import {
  buildMergePlan,
  editModerationDecision,
  type ContributionStatus,
  type EditableField,
  type ValidatedEditSuggestion,
} from "./contributions";
import { FACT_COLUMNS, type FactKey } from "./place-facts";
import { auditValue, type AuditEntry } from "./moderation";
import { appendObservation } from "./observations-repository";
import { refreshStanding } from "./reputation-repository";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function writeAudit(
  entry: AuditEntry,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<void> {
  const db = await client;
  await db.run(sql`
    INSERT INTO audit_log (
      id, actor_user_id, action, target_type, target_id, reason, source,
      before_value, after_value, created_at
    ) VALUES (
      ${crypto.randomUUID()}, ${entry.actorUserId}, ${entry.action},
      ${entry.targetType}, ${entry.targetId}, ${entry.reason ?? null},
      ${entry.source ?? null}, ${auditValue(entry.before)}, ${auditValue(entry.after)},
      ${Date.now()}
    )
  `);
}

export type ContributorHistory = {
  accepted: number;
  rejected: number;
};

export async function getContributorHistory(
  userId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<ContributorHistory> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT
      SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
    FROM place_edit_suggestions
    WHERE submitted_by_user_id = ${userId}
  `);
  const row = rows[0] ?? {};
  return { accepted: num(row.accepted), rejected: num(row.rejected) };
}

export type EditSubmissionResult = {
  id: string;
  status: ContributionStatus;
  reason: string;
};

/** Columns on `places` that a correction can update once accepted. */
const PLACE_COLUMNS: Partial<Record<EditableField, string>> = {
  name: "name",
  streetAddress: "street_address",
  addressLocality: "address_locality",
  telephone: "telephone",
  website: "website",
};

/** Columns on `place_facts` that a correction can update once accepted. */
const FACTS_COLUMNS: Partial<Record<EditableField, string>> = {
  neighbourhood: "neighbourhood",
  priceBand: "price_band",
  serviceTypes: "service_types",
  meals: "meals",
  menuUrl: "menu_url",
  reservationUrl: "reservation_url",
  deliveryUrl: "delivery_url",
  branchLabel: "branch_label",
  certificationBody: "certification_body",
  ...(Object.fromEntries(
    Object.entries(FACT_COLUMNS).map(([key, column]) => [key as FactKey, column]),
  ) as Partial<Record<EditableField, string>>),
};

async function currentValue(
  db: DatabaseClient,
  placeId: string,
  field: EditableField,
): Promise<string | null> {
  const placeColumn = PLACE_COLUMNS[field];
  if (placeColumn) {
    const rows = await db.all<Record<string, unknown>>(sql`
      SELECT ${sql.raw(placeColumn)} AS value FROM places WHERE id = ${placeId} LIMIT 1
    `);
    const value = rows[0]?.value;
    return value === null || value === undefined ? null : String(value);
  }
  const factsColumn = FACTS_COLUMNS[field];
  if (factsColumn) {
    const rows = await db.all<Record<string, unknown>>(sql`
      SELECT ${sql.raw(factsColumn)} AS value FROM place_facts WHERE place_id = ${placeId} LIMIT 1
    `);
    const value = rows[0]?.value;
    return value === null || value === undefined ? null : String(value);
  }
  return null;
}

export async function submitEditSuggestion(
  placeId: string,
  userId: string,
  input: ValidatedEditSuggestion,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<EditSubmissionResult> {
  const db = await client;
  const history = await getContributorHistory(userId, client);
  const decision = editModerationDecision({
    field: input.field,
    relationship: input.relationship,
    acceptedContributions: history.accepted,
    rejectedContributions: history.rejected,
  });

  const before = await currentValue(db, placeId, input.field);
  const id = crypto.randomUUID();
  const now = Date.now();
  const status: ContributionStatus = decision.autoAccept ? "accepted" : "pending";

  await db.run(sql`
    INSERT INTO place_edit_suggestions (
      id, place_id, submitted_by_user_id, field, current_value, proposed_value,
      source_url, note, relationship, status, status_reason, reviewed_by_user_id,
      created_at, updated_at
    ) VALUES (
      ${id}, ${placeId}, ${userId}, ${input.field}, ${before}, ${input.proposedValue},
      ${input.sourceUrl}, ${input.note}, ${input.relationship}, ${status},
      ${decision.reason}, NULL, ${now}, ${now}
    )
  `);

  if (decision.autoAccept) await applyEdit(id, null, client);

  await writeAudit(
    {
      actorUserId: userId,
      action: decision.autoAccept ? "edit.accepted" : "edit.submitted",
      targetType: "place",
      targetId: placeId,
      reason: decision.reason,
      source: input.sourceUrl,
      before: { field: input.field, value: before },
      after: { field: input.field, value: input.proposedValue },
    },
    client,
  );

  return { id, status, reason: decision.reason };
}

/**
 * Write an accepted correction.
 *
 * The observation is appended first and is the record of what was claimed, by
 * whom and when. The `places` / `place_facts` write that follows is only a
 * projection of the newest reading, kept because the discovery query filters on
 * it — the previous value is never lost, it stays in the observation log.
 */
export async function applyEdit(
  suggestionId: string,
  moderatorUserId: string | null,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<boolean> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT place_id, field, proposed_value, current_value, source_url,
      submitted_by_user_id
    FROM place_edit_suggestions WHERE id = ${suggestionId} LIMIT 1
  `);
  const row = rows[0];
  if (!row) return false;

  const placeId = String(row.place_id);
  const field = String(row.field) as EditableField;
  const value = String(row.proposed_value ?? "");
  const now = Date.now();

  await appendObservation(
    {
      placeId,
      predicate: field,
      value,
      // A cited correction is a claim about that source; an uncited one is the
      // contributor's own observation. Both are recorded as such.
      source: typeof row.source_url === "string" && row.source_url
        ? "contributor-cited source"
        : "community contribution",
      sourceClass: "community",
      sourceUrl: typeof row.source_url === "string" ? row.source_url : null,
      observedAt: now,
      confidence: typeof row.source_url === "string" && row.source_url ? "high" : "medium",
      submittedByUserId:
        typeof row.submitted_by_user_id === "string" ? row.submitted_by_user_id : null,
    },
    client,
  );

  const placeColumn = PLACE_COLUMNS[field];
  const factsColumn = FACTS_COLUMNS[field];

  if (placeColumn) {
    await db.run(sql`
      UPDATE places SET ${sql.raw(placeColumn)} = ${value} WHERE id = ${placeId}
    `);
  } else if (factsColumn) {
    await db.run(sql`
      INSERT INTO place_facts (place_id, updated_at, service_types, meals)
      VALUES (${placeId}, ${now}, '[]', '[]')
      ON CONFLICT(place_id) DO NOTHING
    `);
    await db.run(sql`
      UPDATE place_facts
      SET ${sql.raw(factsColumn)} = ${value}, updated_at = ${now},
        updated_by_user_id = ${moderatorUserId}
      WHERE place_id = ${placeId}
    `);
  } else if (field === "permanentlyClosed") {
    await db.run(sql`
      UPDATE places SET halal_confirmed = 0 WHERE id = ${placeId}
    `);
  }

  await db.run(sql`
    UPDATE place_edit_suggestions
    SET status = 'accepted', reviewed_by_user_id = ${moderatorUserId}, updated_at = ${now}
    WHERE id = ${suggestionId}
  `);
  return true;
}

export async function resolveEdit(
  suggestionId: string,
  moderatorUserId: string,
  status: Extract<ContributionStatus, "accepted" | "rejected" | "needs-evidence">,
  reason: string | null,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<boolean> {
  const db = await client;
  if (status === "accepted") {
    const applied = await applyEdit(suggestionId, moderatorUserId, client);
    if (!applied) return false;
  } else {
    const rows = await db.all<{ id: string }>(sql`
      UPDATE place_edit_suggestions
      SET status = ${status}, status_reason = ${reason},
        reviewed_by_user_id = ${moderatorUserId}, updated_at = ${Date.now()}
      WHERE id = ${suggestionId}
      RETURNING id
    `);
    if (!rows.length) return false;
  }
  await writeAudit(
    {
      actorUserId: moderatorUserId,
      action: status === "accepted" ? "edit.accepted" : "edit.rejected",
      targetType: "edit",
      targetId: suggestionId,
      reason,
    },
    client,
  );

  // A decision changes the contributor's accuracy, so their standing is
  // recomputed from source rather than nudged.
  const db2 = await client;
  const owner = await db2.all<{ submitted_by_user_id?: unknown }>(sql`
    SELECT submitted_by_user_id FROM place_edit_suggestions WHERE id = ${suggestionId} LIMIT 1
  `);
  const ownerId = owner[0]?.submitted_by_user_id;
  if (typeof ownerId === "string" && ownerId)
    await refreshStanding(ownerId, client);

  return true;
}

export type ContributionRow = {
  id: string;
  kind: "edit" | "evidence" | "dish" | "duplicate";
  placeId: string;
  placeName: string;
  summary: string;
  status: string;
  statusReason: string | null;
  createdAt: number;
};

/** Everything one contributor has submitted, with its current status. */
export async function listContributions(
  userId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<ContributionRow[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT 'edit' AS kind, e.id, e.place_id, p.name AS place_name,
      e.field AS summary, e.status, e.status_reason, e.created_at
    FROM place_edit_suggestions AS e
    INNER JOIN places AS p ON p.id = e.place_id
    WHERE e.submitted_by_user_id = ${userId}
    UNION ALL
    SELECT 'evidence' AS kind, v.id, v.place_id, p.name AS place_name,
      v.evidence_kind AS summary, v.status, v.review_reason AS status_reason, v.created_at
    FROM place_halal_verifications AS v
    INNER JOIN places AS p ON p.id = v.place_id
    WHERE v.submitted_by_user_id = ${userId}
    UNION ALL
    SELECT 'dish' AS kind, d.id, d.place_id, p.name AS place_name,
      d.name AS summary, d.status, NULL AS status_reason, d.created_at
    FROM place_dishes AS d
    INNER JOIN places AS p ON p.id = d.place_id
    WHERE d.submitted_by_user_id = ${userId}
    UNION ALL
    SELECT 'duplicate' AS kind, r.id, r.place_id, p.name AS place_name,
      'duplicate report' AS summary, r.status, r.status_reason, r.created_at
    FROM place_duplicate_reports AS r
    INNER JOIN places AS p ON p.id = r.place_id
    WHERE r.submitted_by_user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 200
  `);

  return rows.map((row) => ({
    id: String(row.id),
    kind: row.kind as ContributionRow["kind"],
    placeId: String(row.place_id),
    placeName: String(row.place_name ?? ""),
    summary: String(row.summary ?? ""),
    status: String(row.status ?? "pending"),
    statusReason:
      typeof row.status_reason === "string" ? row.status_reason : null,
    createdAt: num(row.created_at),
  }));
}

/* -------------------------------------------------------------- duplicates -- */

export async function submitDuplicateReport(
  placeId: string,
  duplicateOfPlaceId: string,
  userId: string,
  note: string | null,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<{ ok: true; id: string } | { ok: false; reason: "not-found" }> {
  const db = await client;
  const rows = await db.all<{ count: number }>(sql`
    SELECT COUNT(*) AS count FROM places
    WHERE id IN (${placeId}, ${duplicateOfPlaceId}) AND halal_confirmed = 1
  `);
  if (num(rows[0]?.count) !== 2) return { ok: false, reason: "not-found" };

  const id = crypto.randomUUID();
  const now = Date.now();
  await db.run(sql`
    INSERT INTO place_duplicate_reports (
      id, place_id, duplicate_of_place_id, submitted_by_user_id, note, status,
      created_at, updated_at
    ) VALUES (
      ${id}, ${placeId}, ${duplicateOfPlaceId}, ${userId}, ${note}, 'pending',
      ${now}, ${now}
    )
  `);
  await writeAudit(
    {
      actorUserId: userId,
      action: "duplicate.reported",
      targetType: "place",
      targetId: placeId,
      after: { duplicateOfPlaceId },
    },
    client,
  );
  return { ok: true, id };
}

/**
 * Merge a duplicate into the place that is kept. Visits, evidence, dishes,
 * photos, saves and list memberships all move first; only then is the duplicate
 * retired, so nothing is lost.
 */
export async function mergeDuplicate(
  reportId: string,
  moderatorUserId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<boolean> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT place_id, duplicate_of_place_id FROM place_duplicate_reports
    WHERE id = ${reportId} AND status = 'pending' LIMIT 1
  `);
  const row = rows[0];
  if (!row) return false;

  const mergePlaceId = String(row.place_id);
  const keepPlaceId = String(row.duplicate_of_place_id);
  const plan = buildMergePlan(keepPlaceId, mergePlaceId);
  const now = Date.now();

  // D1 rejects SQL `BEGIN`, and these statements name their tables
  // dynamically from the merge plan, so they cannot be expressed as the
  // drizzle builders `db.batch()` requires. They run sequentially instead.
  //
  // That is safe here because every statement is idempotent: the DELETEs
  // remove rows that would collide on a composite key, and the UPDATEs move
  // `place_id` from the merged place to the kept one, so re-running finds
  // nothing left to move. An interrupted merge can simply be run again — and
  // the report stays `pending` until the last statement, so a half-finished
  // merge is still visible in the queue rather than silently marked done.
  for (const move of plan.moves) {
    if (move.table === "saved_places")
      await db.run(sql`
        DELETE FROM saved_places WHERE place_id = ${mergePlaceId}
          AND user_id IN (SELECT user_id FROM saved_places WHERE place_id = ${keepPlaceId})
      `);
    if (move.table === "place_ratings")
      await db.run(sql`
        DELETE FROM place_ratings WHERE place_id = ${mergePlaceId}
          AND user_id IN (SELECT user_id FROM place_ratings WHERE place_id = ${keepPlaceId})
      `);
    if (move.table === "place_reviews")
      await db.run(sql`
        DELETE FROM place_reviews WHERE place_id = ${mergePlaceId}
          AND user_id IN (SELECT user_id FROM place_reviews WHERE place_id = ${keepPlaceId})
      `);
    if (move.table === "place_list_items")
      await db.run(sql`
        DELETE FROM place_list_items WHERE place_id = ${mergePlaceId}
          AND list_id IN (SELECT list_id FROM place_list_items WHERE place_id = ${keepPlaceId})
      `);
    await db.run(sql`
      UPDATE ${sql.raw(move.table)} SET ${sql.raw(move.column)} = ${keepPlaceId}
      WHERE ${sql.raw(move.column)} = ${mergePlaceId}
    `);
  }

  // Retiring the duplicate and closing the report go last and together, so the
  // report is only marked accepted once every move above has landed.
  await db.batch([
    db.update(places).set({ halalConfirmed: false }).where(eq(places.id, mergePlaceId)),
    db
      .update(placeDuplicateReports)
      .set({
        status: "accepted",
        reviewedByUserId: moderatorUserId,
        updatedAt: new Date(now),
      })
      .where(eq(placeDuplicateReports.id, reportId)),
  ]);

  await writeAudit(
    {
      actorUserId: moderatorUserId,
      action: "duplicate.merged",
      targetType: "place",
      targetId: keepPlaceId,
      reason: `Merged ${mergePlaceId} into ${keepPlaceId}`,
      before: { mergePlaceId },
      after: { keepPlaceId, moves: plan.moves.length },
    },
    client,
  );
  return true;
}
