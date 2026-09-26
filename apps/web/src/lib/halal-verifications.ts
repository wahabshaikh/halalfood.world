import { sql } from "drizzle-orm";
import { database } from "../db";
import {
  placeHalalVerificationEvidence,
  placeHalalVerifications,
} from "../db/schema";
import {
  HALAL_CHECK_ANSWER_VALUES,
  type HalalCheckAnswers,
  type HalalCheckQuestion,
  type HalalVerificationStatus,
  type ValidatedHalalVerification,
} from "./halal-verification";
import {
  isEvidenceKind,
  isEvidenceScope,
  isHalalTaxonomyStatus,
  isRelationship,
  type EvidenceKind,
  type EvidenceRecord,
  type EvidenceScope,
  type HalalTaxonomyStatus,
  type Relationship,
} from "@halalfood/core/halal-taxonomy";

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
  /** Source attribution and scope, shown in the evidence panel. */
  kind: EvidenceKind;
  claimedStatus: HalalTaxonomyStatus;
  scope: EvidenceScope;
  scopeNote: string | null;
  certificationBody: string | null;
  certificateId: string | null;
  sourceUrl: string | null;
  capturedAt: string | null;
  expiresAt: string | null;
  relationship: Relationship;
  incentivized: boolean;
  /** True once the effective expiry has passed; stale evidence never ranks. */
  stale: boolean;
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

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return null;
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
          v.evidence_kind,
          v.claimed_status,
          v.scope,
          v.scope_note,
          v.certification_body,
          v.certificate_id,
          v.captured_at,
          v.expires_at,
          v.relationship,
          v.incentivized,
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
      const now = Date.now();
      return rows.map((row) => {
        const capturedAt = numberOrNull(row.captured_at) ?? numberOrNull(row.created_at);
        const expiresAt = numberOrNull(row.expires_at);
        return {
          id: String(row.id),
          status: visibleStatus(row.status),
          note: typeof row.note === "string" ? row.note : null,
          createdAt: isoDate(row.created_at),
          evidence: mapEvidence(row.evidence),
          answers: mapCheckAnswers(row),
          kind: isEvidenceKind(row.evidence_kind) ? row.evidence_kind : "first-hand",
          claimedStatus: isHalalTaxonomyStatus(row.claimed_status)
            ? row.claimed_status
            : "self-declared",
          scope: isEvidenceScope(row.scope) ? row.scope : "venue",
          scopeNote: typeof row.scope_note === "string" ? row.scope_note : null,
          certificationBody:
            typeof row.certification_body === "string" ? row.certification_body : null,
          certificateId: typeof row.certificate_id === "string" ? row.certificate_id : null,
          sourceUrl: null,
          capturedAt: capturedAt === null ? null : new Date(capturedAt).toISOString(),
          expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
          relationship: isRelationship(row.relationship) ? row.relationship : "none",
          incentivized: row.incentivized === 1 || row.incentivized === true,
          stale: expiresAt !== null && expiresAt <= now,
        } satisfies PublicHalalVerification;
      });
    },

    async create(userId, placeId, input) {
      const db = await client;
      const verificationId = crypto.randomUUID();
      const now = Date.now();
      const attributes = input.attributes;
      // D1 rejects SQL `BEGIN`, so this is a batch: the submission and its
      // evidence rows land together or not at all. A verification with no
      // evidence would sit in the moderation queue with nothing to review.
      await db.batch([
        db.insert(placeHalalVerifications).values({
          id: verificationId,
          placeId,
          submittedByUserId: userId,
          status: "pending",
          note: input.note,
          createdAt: new Date(now),
          updatedAt: new Date(now),
          evidenceKind: attributes.kind,
          claimedStatus: attributes.claimedStatus,
          scope: attributes.scope,
          scopeNote: attributes.scopeNote,
          certificationBody: attributes.certificationBody,
          certificateId: attributes.certificateId,
          capturedAt: new Date(attributes.capturedAt),
          expiresAt: new Date(attributes.expiresAt),
          relationship: attributes.relationship,
          incentivized: attributes.incentivized,
          visibility: attributes.visibility,
        }),
        // The declared source is stored as a link so the evidence panel can
        // show it alongside the uploads.
        ...(attributes.sourceUrl
          ? [
              db.insert(placeHalalVerificationEvidence).values({
                id: crypto.randomUUID(),
                verificationId,
                kind: "link",
                url: attributes.sourceUrl,
                r2Key: null,
                contentType: null,
                fileName: null,
                sizeBytes: null,
                createdAt: new Date(now),
              }),
            ]
          : []),
        ...input.evidence.map((item) =>
          item.kind === "link"
            ? db.insert(placeHalalVerificationEvidence).values({
                id: crypto.randomUUID(),
                verificationId,
                kind: "link",
                url: item.url,
                r2Key: null,
                contentType: null,
                fileName: null,
                sizeBytes: null,
                createdAt: new Date(now),
              })
            : db.insert(placeHalalVerificationEvidence).values({
                id: crypto.randomUUID(),
                verificationId,
                kind: "upload",
                url: null,
                r2Key: item.key,
                contentType: item.contentType,
                fileName: item.fileName,
                sizeBytes: item.sizeBytes,
                createdAt: new Date(now),
              }),
        ),
        // Step-by-step answers ride in the same batch as the submission.
        ...(Object.values(input.answers).some((value) => value !== null)
          ? [
              db.run(sql`
                INSERT INTO place_halal_check_answers (
                  verification_id, certificate, alcohol, meat, created_at
                ) VALUES (
                  ${verificationId}, ${input.answers.certificate}, ${input.answers.alcohol},
                  ${input.answers.meat}, ${now}
                )
              `),
            ]
          : []),
      ] as unknown as Parameters<typeof db.batch>[0]);
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

/* ------------------------------------------------- assessment source rows -- */

/**
 * Approved evidence for one place, shaped for `deriveHalalAssessment`.
 *
 * The query is keyed on `place_id` alone, which is what keeps branch scoping
 * honest: every branch is its own `places` row, so evidence for one location
 * can never reach another.
 */
export async function listApprovedEvidenceRecords(
  placeId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<EvidenceRecord[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT
      v.id,
      v.evidence_kind,
      v.claimed_status,
      v.scope,
      v.scope_note,
      v.captured_at,
      v.expires_at,
      v.created_at,
      v.submitted_by_user_id,
      v.relationship,
      v.incentivized,
      v.certification_body
    FROM place_halal_verifications AS v
    INNER JOIN places AS p ON p.id = v.place_id
    WHERE v.place_id = ${placeId}
      AND v.status = 'approved'
      AND v.superseded_by_id IS NULL
      AND p.halal_confirmed = 1
    ORDER BY v.created_at DESC
    LIMIT 200
  `);

  return rows.flatMap((row): EvidenceRecord[] => {
    const capturedAt = numberOrNull(row.captured_at) ?? numberOrNull(row.created_at);
    if (capturedAt === null || typeof row.id !== "string") return [];
    return [
      {
        id: row.id,
        kind: isEvidenceKind(row.evidence_kind) ? row.evidence_kind : "first-hand",
        claimedStatus: isHalalTaxonomyStatus(row.claimed_status)
          ? row.claimed_status
          : "self-declared",
        scope: isEvidenceScope(row.scope) ? row.scope : "venue",
        scopeNote: typeof row.scope_note === "string" ? row.scope_note : null,
        capturedAt,
        expiresAt: numberOrNull(row.expires_at),
        submittedByUserId:
          typeof row.submitted_by_user_id === "string" ? row.submitted_by_user_id : "",
        relationship: isRelationship(row.relationship) ? row.relationship : "none",
        incentivized: row.incentivized === 1 || row.incentivized === true,
        certificationBody:
          typeof row.certification_body === "string" ? row.certification_body : null,
      },
    ];
  });
}
