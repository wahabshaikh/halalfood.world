/** D1 access for the evidence queue, reports, appeals and the audit log. */

import { sql } from "drizzle-orm";
import { database } from "../db";
import {
  canAppeal,
  prioritizeQueue,
  type PrioritizedQueueItem,
  type QueueItem,
  type ReportReason,
  type ReportStatus,
  type ReportTarget,
} from "./moderation";
import {
  isEvidenceKind,
  isHalalTaxonomyStatus,
  isRelationship,
  deriveHalalAssessment,
} from "./halal-taxonomy";
import { listApprovedEvidenceRecords } from "./halal-verifications";
import { recordStatusChange } from "./place-decision";
import { writeAudit } from "./contributions-repository";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

export type QueueEntry = PrioritizedQueueItem & {
  placeName: string;
  citySlug: string;
  note: string | null;
  submittedByUserId: string;
};

/** Pending evidence, ordered by the explainable priority score. */
export async function listEvidenceQueue(
  limit = 50,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<QueueEntry[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT
      v.id, v.place_id, v.evidence_kind, v.claimed_status, v.relationship,
      v.incentivized, v.created_at, v.expires_at, v.note, v.submitted_by_user_id,
      p.name AS place_name, p.city_slug,
      (SELECT COUNT(*) FROM saved_places AS s WHERE s.place_id = v.place_id) AS saved_count,
      (SELECT COUNT(*) FROM content_reports AS r
        WHERE r.status = 'open'
          AND ((r.target_type = 'place' AND r.target_id = v.place_id)
            OR (r.target_type = 'verification' AND r.target_id = v.id))
      ) AS open_reports,
      (SELECT COUNT(DISTINCT a.claimed_status) FROM place_halal_verifications AS a
        WHERE a.place_id = v.place_id AND a.status = 'approved'
          AND (a.claimed_status = 'not-halal') <> (v.claimed_status = 'not-halal')
      ) AS conflicting
    FROM place_halal_verifications AS v
    INNER JOIN places AS p ON p.id = v.place_id
    WHERE v.status = 'pending'
    ORDER BY v.created_at ASC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `);

  const items: QueueItem[] = rows.map((row) => ({
    id: String(row.id),
    placeId: String(row.place_id),
    kind: isEvidenceKind(row.evidence_kind) ? row.evidence_kind : "first-hand",
    claimedStatus: isHalalTaxonomyStatus(row.claimed_status)
      ? row.claimed_status
      : "self-declared",
    relationship: isRelationship(row.relationship) ? row.relationship : "none",
    incentivized: row.incentivized === 1 || row.incentivized === true,
    createdAt: num(row.created_at),
    expiresAt: row.expires_at === null ? null : num(row.expires_at),
    conflicting: num(row.conflicting) > 0,
    savedCount: num(row.saved_count),
    openReports: num(row.open_reports),
  }));

  const prioritized = prioritizeQueue(items);
  const detail = new Map(rows.map((row) => [String(row.id), row]));
  return prioritized.map((item) => {
    const row = detail.get(item.id) ?? {};
    return {
      ...item,
      placeName: String(row.place_name ?? ""),
      citySlug: String(row.city_slug ?? ""),
      note: typeof row.note === "string" ? row.note : null,
      submittedByUserId: String(row.submitted_by_user_id ?? ""),
    };
  });
}

/**
 * Approve or reject one evidence submission, then re-derive the place status
 * and record any change. Every decision is audited.
 */
export async function reviewEvidence(
  verificationId: string,
  moderatorUserId: string,
  decision: "approved" | "rejected",
  reason: string | null,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<{ ok: true; placeId: string } | { ok: false }> {
  const db = await client;
  const rows = await db.all<{ id: string; place_id: string }>(sql`
    UPDATE place_halal_verifications
    SET status = ${decision}, reviewed_by_user_id = ${moderatorUserId},
      review_reason = ${reason}, updated_at = ${Date.now()}
    WHERE id = ${verificationId} AND status = 'pending'
    RETURNING id, place_id
  `);
  const row = rows[0];
  if (!row) return { ok: false };

  const placeId = String(row.place_id);
  await writeAudit(
    {
      actorUserId: moderatorUserId,
      action: decision === "approved" ? "evidence.approved" : "evidence.rejected",
      targetType: "verification",
      targetId: verificationId,
      reason,
    },
    client,
  );

  const evidence = await listApprovedEvidenceRecords(placeId, client);
  const assessment = deriveHalalAssessment(evidence);
  const changed = await recordStatusChange(
    placeId,
    assessment,
    { verificationId, reason },
    client,
  );
  if (changed)
    await writeAudit(
      {
        actorUserId: moderatorUserId,
        action: "status.changed",
        targetType: "place",
        targetId: placeId,
        reason: assessment.reasons[0] ?? null,
        after: { status: assessment.status, confidence: assessment.confidence },
      },
      client,
    );

  return { ok: true, placeId };
}

/* --------------------------------------------------------------- reports -- */

export async function createReport(
  input: {
    targetType: ReportTarget;
    targetId: string;
    reason: ReportReason;
    detail: string | null;
  },
  reportedByUserId: string | null,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<string> {
  const db = await client;
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.run(sql`
    INSERT INTO content_reports (
      id, target_type, target_id, reported_by_user_id, reason, detail, status,
      created_at, updated_at
    ) VALUES (
      ${id}, ${input.targetType}, ${input.targetId}, ${reportedByUserId},
      ${input.reason}, ${input.detail}, 'open', ${now}, ${now}
    )
  `);
  await writeAudit(
    {
      actorUserId: reportedByUserId,
      action: "report.opened",
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
    },
    client,
  );
  return id;
}

export type ReportRow = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  detail: string | null;
  status: ReportStatus;
  resolution: string | null;
  createdAt: number;
  appealable: boolean;
};

export async function listReports(
  options: { status?: ReportStatus; reportedByUserId?: string; limit?: number },
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<ReportRow[]> {
  const db = await client;
  const filters = [sql`1 = 1`];
  if (options.status) filters.push(sql`status = ${options.status}`);
  if (options.reportedByUserId)
    filters.push(sql`reported_by_user_id = ${options.reportedByUserId}`);

  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT id, target_type, target_id, reason, detail, status, resolution, created_at
    FROM content_reports
    WHERE ${sql.join(filters, sql` AND `)}
    ORDER BY status = 'open' DESC, created_at ASC
    LIMIT ${Math.min(Math.max(options.limit ?? 50, 1), 200)}
  `);
  return rows.map((row) => {
    const status = String(row.status ?? "open") as ReportStatus;
    return {
      id: String(row.id),
      targetType: String(row.target_type ?? ""),
      targetId: String(row.target_id ?? ""),
      reason: String(row.reason ?? ""),
      detail: typeof row.detail === "string" ? row.detail : null,
      status,
      resolution: typeof row.resolution === "string" ? row.resolution : null,
      createdAt: num(row.created_at),
      appealable: canAppeal(status),
    };
  });
}

export async function resolveReport(
  reportId: string,
  moderatorUserId: string,
  status: Extract<ReportStatus, "upheld" | "dismissed">,
  resolution: string | null,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<boolean> {
  const db = await client;
  const rows = await db.all<{ id: string }>(sql`
    UPDATE content_reports
    SET status = ${status}, resolution = ${resolution},
      reviewed_by_user_id = ${moderatorUserId}, updated_at = ${Date.now()}
    WHERE id = ${reportId} AND status IN ('open', 'appealed')
    RETURNING id
  `);
  if (!rows.length) return false;
  await writeAudit(
    {
      actorUserId: moderatorUserId,
      action: "report.resolved",
      targetType: "report",
      targetId: reportId,
      reason: resolution,
      after: { status },
    },
    client,
  );
  return true;
}

/* --------------------------------------------------------------- appeals -- */

export async function createAppeal(
  reportId: string,
  userId: string,
  reason: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<{ ok: true; id: string } | { ok: false; reason: "not-appealable" }> {
  const db = await client;
  const rows = await db.all<{ status?: unknown }>(sql`
    SELECT status FROM content_reports WHERE id = ${reportId} LIMIT 1
  `);
  const status = rows[0]?.status;
  if (typeof status !== "string" || !canAppeal(status as ReportStatus))
    return { ok: false, reason: "not-appealable" };

  const id = crypto.randomUUID();
  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.run(sql`
      INSERT INTO report_appeals (
        id, report_id, submitted_by_user_id, reason, status, created_at, updated_at
      ) VALUES (${id}, ${reportId}, ${userId}, ${reason}, 'open', ${now}, ${now})
    `);
    await tx.run(sql`
      UPDATE content_reports SET status = 'appealed', updated_at = ${now}
      WHERE id = ${reportId}
    `);
  });
  await writeAudit(
    {
      actorUserId: userId,
      action: "appeal.opened",
      targetType: "report",
      targetId: reportId,
    },
    client,
  );
  return { ok: true, id };
}

export async function resolveAppeal(
  appealId: string,
  moderatorUserId: string,
  status: "upheld" | "dismissed",
  outcome: string | null,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<boolean> {
  const db = await client;
  const now = Date.now();
  const rows = await db.all<{ report_id: string }>(sql`
    UPDATE report_appeals
    SET status = ${status}, outcome = ${outcome},
      reviewed_by_user_id = ${moderatorUserId}, updated_at = ${now}
    WHERE id = ${appealId} AND status = 'open'
    RETURNING report_id
  `);
  const row = rows[0];
  if (!row) return false;

  await db.run(sql`
    UPDATE content_reports
    SET status = ${status === "upheld" ? "appeal-upheld" : "appeal-dismissed"},
      updated_at = ${now}
    WHERE id = ${row.report_id}
  `);
  await writeAudit(
    {
      actorUserId: moderatorUserId,
      action: "appeal.resolved",
      targetType: "appeal",
      targetId: appealId,
      reason: outcome,
      after: { status },
    },
    client,
  );
  return true;
}

/* ----------------------------------------------------------------- audit -- */

export type AuditRow = {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  source: string | null;
  createdAt: number;
};

export async function listAuditLog(
  options: { targetType?: string; targetId?: string; limit?: number },
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<AuditRow[]> {
  const db = await client;
  const filters = [sql`1 = 1`];
  if (options.targetType) filters.push(sql`target_type = ${options.targetType}`);
  if (options.targetId) filters.push(sql`target_id = ${options.targetId}`);
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT id, actor_user_id, action, target_type, target_id, reason, source, created_at
    FROM audit_log
    WHERE ${sql.join(filters, sql` AND `)}
    ORDER BY created_at DESC
    LIMIT ${Math.min(Math.max(options.limit ?? 100, 1), 500)}
  `);
  return rows.map((row) => ({
    id: String(row.id),
    actorUserId: typeof row.actor_user_id === "string" ? row.actor_user_id : null,
    action: String(row.action ?? ""),
    targetType: String(row.target_type ?? ""),
    targetId: String(row.target_id ?? ""),
    reason: typeof row.reason === "string" ? row.reason : null,
    source: typeof row.source === "string" ? row.source : null,
    createdAt: num(row.created_at),
  }));
}

/** Pending factual edits and duplicate reports, for the moderation console. */
export async function listPendingEdits(
  limit = 50,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
) {
  const db = await client;
  return db.all<Record<string, unknown>>(sql`
    SELECT e.id, e.place_id, p.name AS place_name, e.field, e.current_value,
      e.proposed_value, e.source_url, e.note, e.relationship, e.created_at
    FROM place_edit_suggestions AS e
    INNER JOIN places AS p ON p.id = e.place_id
    WHERE e.status = 'pending'
    ORDER BY e.created_at ASC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `);
}

export async function listPendingDuplicates(
  limit = 50,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
) {
  const db = await client;
  return db.all<Record<string, unknown>>(sql`
    SELECT r.id, r.place_id, r.duplicate_of_place_id, r.note, r.created_at,
      a.name AS place_name, b.name AS duplicate_of_name
    FROM place_duplicate_reports AS r
    INNER JOIN places AS a ON a.id = r.place_id
    INNER JOIN places AS b ON b.id = r.duplicate_of_place_id
    WHERE r.status = 'pending'
    ORDER BY r.created_at ASC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `);
}
