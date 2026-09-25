import { sql } from "drizzle-orm";
import { database } from "../db";
import {
  HALAL_CHECK_ANSWER_VALUES,
  type HalalCheckAnswers,
  type HalalCheckQuestion,
  type HalalVerificationStatus,
  type ValidatedHalalVerification,
} from "./halal-verification";

export type PublicHalalEvidence =
  | { kind: "link"; url: string }
  | {
      kind: "upload";
      url: string;
      contentType: string;
      fileName: string;
    };

export type PublicHalalVerification = {
  id: string;
  status: Extract<HalalVerificationStatus, "pending" | "approved">;
  note: string | null;
  createdAt: string;
  evidence: PublicHalalEvidence[];
  /** Structured answers from a step-by-step check, when the submitter gave any. */
  answers: HalalCheckAnswers | null;
};

export type UploadAccess = {
  status: Extract<HalalVerificationStatus, "pending" | "approved">;
  contentType: string;
  fileName: string;
};

export type HalalVerificationCreateResult = {
  id: string;
  status: "pending";
};

export interface HalalVerificationRepository {
  hasPlace(placeId: string): Promise<boolean>;
  list(
    placeId: string,
    userId: string | null,
  ): Promise<PublicHalalVerification[]>;
  create(
    userId: string,
    placeId: string,
    input: ValidatedHalalVerification,
  ): Promise<HalalVerificationCreateResult>;
  getUploadAccess(key: string, userId: string | null): Promise<UploadAccess | null>;
}

type DatabaseClient = Awaited<ReturnType<typeof database>>;

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") return value;
  return new Date(0).toISOString();
}

function visibleStatus(value: unknown): Extract<HalalVerificationStatus, "pending" | "approved"> {
  return value === "approved" ? "approved" : "pending";
}

function uploadUrl(key: string): string {
  return `/api/uploads/r2?key=${encodeURIComponent(key)}`;
}

function answerValue<Question extends HalalCheckQuestion>(
  question: Question,
  value: unknown,
): HalalCheckAnswers[Question] {
  const allowed = HALAL_CHECK_ANSWER_VALUES[question] as readonly unknown[];
  return (allowed.includes(value) ? value : null) as HalalCheckAnswers[Question];
}

/** Map the LEFT JOINed answer columns; a missing row means no structured check. */
export function mapCheckAnswers(row: Record<string, unknown>): HalalCheckAnswers | null {
  if (typeof row.answers_id !== "string") return null;
  return {
    certificate: answerValue("certificate", row.certificate),
    alcohol: answerValue("alcohol", row.alcohol),
    meat: answerValue("meat", row.meat),
  };
}

function mapEvidence(value: unknown): PublicHalalEvidence[] {
  let entries = value;
  if (typeof value === "string") {
    try {
      entries = JSON.parse(value);
    } catch {
      entries = [];
    }
  }
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((raw): PublicHalalEvidence[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    if (item.kind === "link" && typeof item.url === "string")
      return [{ kind: "link", url: item.url }];
    if (
      item.kind === "upload" &&
      typeof item.r2_key === "string" &&
      typeof item.content_type === "string" &&
      typeof item.file_name === "string"
    )
      return [
        {
          kind: "upload",
          url: uploadUrl(item.r2_key),
          contentType: item.content_type,
          fileName: item.file_name,
        },
      ];
    return [];
  });
}

export function d1HalalVerificationRepository(
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): HalalVerificationRepository {
  return {
    async hasPlace(placeId) {
      const db = await client;
      const rows = await db.all(sql`
        SELECT 1
        FROM places
        WHERE id = ${placeId} AND halal_confirmed = 1
        LIMIT 1
      `);
      return rows.length > 0;
    },

    async list(placeId, userId) {
      const db = await client;
      const visibility = userId
        ? sql`(v.status = 'approved' OR (v.status = 'pending' AND v.submitted_by_user_id = ${userId}))`
        : sql`v.status = 'approved'`;
      const rows = await db.all<Record<string, unknown>>(sql`
        SELECT
          v.id AS id,
          v.status,
          v.note,
          v.created_at,
          a.verification_id AS answers_id,
          a.certificate,
          a.alcohol,
          a.meat,
          COALESCE(
            (
              SELECT json_group_array(json_object(
                'kind', e.kind, 'url', e.url, 'r2_key', e.r2_key,
                'content_type', e.content_type, 'file_name', e.file_name
              ))
              FROM (
                SELECT * FROM place_halal_verification_evidence
                WHERE verification_id = v.id
                ORDER BY created_at, id
              ) AS e
            ),
            '[]'
          ) AS evidence
        FROM place_halal_verifications AS v
        INNER JOIN places AS p ON p.id = v.place_id
        LEFT JOIN place_halal_check_answers AS a ON a.verification_id = v.id
        WHERE v.place_id = ${placeId}
          AND p.halal_confirmed = 1
          AND ${visibility}
        ORDER BY v.created_at DESC, v.id DESC
        LIMIT 25
      `);
      return rows.map((row) => ({
        id: String(row.id),
        status: visibleStatus(row.status),
        note: typeof row.note === "string" ? row.note : null,
        createdAt: isoDate(row.created_at),
        evidence: mapEvidence(row.evidence),
        answers: mapCheckAnswers(row),
      }));
    },

    async create(userId, placeId, input) {
      const db = await client;
      const verificationId = crypto.randomUUID();
      const now = Date.now();
      // D1 rejects SQL BEGIN, so the rows are written as one atomic batch.
      const statements = [
        db.run(sql`
          INSERT INTO place_halal_verifications (
            id, place_id, submitted_by_user_id, status, note, created_at, updated_at
          ) VALUES (
            ${verificationId}, ${placeId}, ${userId}, 'pending', ${input.note}, ${now}, ${now}
          )
        `),
        ...input.evidence.map((item) =>
          item.kind === "link"
            ? db.run(sql`
                INSERT INTO place_halal_verification_evidence (
                  id, verification_id, kind, url, r2_key, content_type, file_name,
                  size_bytes, created_at
                ) VALUES (
                  ${crypto.randomUUID()}, ${verificationId}, 'link', ${item.url},
                  NULL, NULL, NULL, NULL, ${now}
                )
              `)
            : db.run(sql`
                INSERT INTO place_halal_verification_evidence (
                  id, verification_id, kind, url, r2_key, content_type, file_name,
                  size_bytes, created_at
                ) VALUES (
                  ${crypto.randomUUID()}, ${verificationId}, 'upload', NULL,
                  ${item.key}, ${item.contentType}, ${item.fileName}, ${item.sizeBytes}, ${now}
                )
              `),
        ),
      ];
      const answers = input.answers;
      if (answers && Object.values(answers).some((value) => value !== null))
        statements.push(
          db.run(sql`
            INSERT INTO place_halal_check_answers (
              verification_id, certificate, alcohol, meat, created_at
            ) VALUES (
              ${verificationId}, ${answers.certificate}, ${answers.alcohol}, ${answers.meat}, ${now}
            )
          `),
        );
      await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
      return { id: verificationId, status: "pending" };
    },

    async getUploadAccess(key, userId) {
      const db = await client;
      const visibility = userId
        ? sql`(v.status = 'approved' OR (v.status = 'pending' AND v.submitted_by_user_id = ${userId}))`
        : sql`v.status = 'approved'`;
      const rows = await db.all<{ status?: unknown; content_type?: unknown; file_name?: unknown }>(sql`
        SELECT v.status, e.content_type, e.file_name
        FROM place_halal_verification_evidence AS e
        INNER JOIN place_halal_verifications AS v
          ON v.id = e.verification_id
        INNER JOIN places AS p ON p.id = v.place_id
        WHERE e.kind = 'upload'
          AND e.r2_key = ${key}
          AND p.halal_confirmed = 1
          AND ${visibility}
        LIMIT 1
      `);
      const row = rows[0];
      if (
        !row ||
        typeof row.content_type !== "string" ||
        typeof row.file_name !== "string"
      )
        return null;
      return {
        status: visibleStatus(row.status),
        contentType: row.content_type,
        fileName: row.file_name,
      };
    },
  };
}

export type HalalVerificationMutationResult =
  | { ok: true; verification: HalalVerificationCreateResult }
  | { ok: false; reason: "not-found" };

export async function submitHalalVerification(
  repository: HalalVerificationRepository,
  userId: string,
  placeId: string,
  input: ValidatedHalalVerification,
): Promise<HalalVerificationMutationResult> {
  if (!(await repository.hasPlace(placeId)))
    return { ok: false, reason: "not-found" };
  return {
    ok: true,
    verification: await repository.create(userId, placeId, input),
  };
}

export type HalalGlanceItem<Value> = { value: Value; reviewedAt: string } | null;

export type HalalCheckGlance = {
  [Question in HalalCheckQuestion]: HalalGlanceItem<
    Exclude<HalalCheckAnswers[Question], "unsure" | null>
  >;
};

export type ApprovedCheckRow = {
  certificate: unknown;
  alcohol: unknown;
  meat: unknown;
  reviewedAt: unknown;
};

/**
 * Reduce approved checks to the most recent definite answer per question.
 * "Not sure" never overrides an earlier definite answer.
 */
export function summarizeHalalChecks(rows: ApprovedCheckRow[]): HalalCheckGlance {
  const glance: HalalCheckGlance = { certificate: null, alcohol: null, meat: null };
  const sorted = rows
    .map((row) => ({ row, at: new Date(isoDate(row.reviewedAt)).getTime() }))
    .filter((entry) => Number.isFinite(entry.at) && entry.at > 0)
    .sort((left, right) => right.at - left.at);
  for (const { row, at } of sorted) {
    for (const question of Object.keys(glance) as HalalCheckQuestion[]) {
      if (glance[question]) continue;
      const value = answerValue(question, row[question]);
      if (value === null || value === "unsure") continue;
      (glance as Record<HalalCheckQuestion, HalalGlanceItem<string>>)[question] = {
        value,
        reviewedAt: new Date(at).toISOString(),
      };
    }
  }
  return glance;
}

/** Latest approved answers for a place page. Pending checks are never shown. */
export async function getHalalCheckGlance(
  placeId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<HalalCheckGlance> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT a.certificate, a.alcohol, a.meat, v.updated_at AS reviewed_at
    FROM place_halal_check_answers AS a
    INNER JOIN place_halal_verifications AS v ON v.id = a.verification_id
    WHERE v.place_id = ${placeId} AND v.status = 'approved'
    ORDER BY v.updated_at DESC
    LIMIT 50
  `);
  return summarizeHalalChecks(
    rows.map((row) => ({
      certificate: row.certificate,
      alcohol: row.alcohol,
      meat: row.meat,
      reviewedAt: row.reviewed_at,
    })),
  );
}
