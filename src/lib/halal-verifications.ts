import { sql } from "drizzle-orm";
import { database } from "../db";
import type {
  HalalVerificationStatus,
  ValidatedHalalVerification,
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
} from "./halal-taxonomy";

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
      await db.transaction(async (tx) => {
        await tx.run(sql`
          INSERT INTO place_halal_verifications (
            id, place_id, submitted_by_user_id, status, note, created_at, updated_at,
            evidence_kind, claimed_status, scope, scope_note, certification_body,
            certificate_id, captured_at, expires_at, relationship, incentivized, visibility
          ) VALUES (
            ${verificationId},
            ${placeId},
            ${userId},
            'pending',
            ${input.note},
            ${now},
            ${now},
            ${attributes.kind},
            ${attributes.claimedStatus},
            ${attributes.scope},
            ${attributes.scopeNote},
            ${attributes.certificationBody},
            ${attributes.certificateId},
            ${attributes.capturedAt},
            ${attributes.expiresAt},
            ${attributes.relationship},
            ${attributes.incentivized ? 1 : 0},
            ${attributes.visibility}
          )
        `);
        if (attributes.sourceUrl) {
          await tx.run(sql`
            INSERT INTO place_halal_verification_evidence (
              id, verification_id, kind, url, r2_key, content_type, file_name,
              size_bytes, created_at
            ) VALUES (
              ${crypto.randomUUID()}, ${verificationId}, 'link', ${attributes.sourceUrl},
              NULL, NULL, NULL, NULL, ${now}
            )
          `);
        }
        for (const item of input.evidence) {
          const evidenceId = crypto.randomUUID();
          if (item.kind === "link") {
            await tx.run(sql`
              INSERT INTO place_halal_verification_evidence (
                id, verification_id, kind, url, r2_key, content_type, file_name,
                size_bytes, created_at
              ) VALUES (
                ${evidenceId}, ${verificationId}, 'link', ${item.url},
                NULL, NULL, NULL, NULL, ${now}
              )
            `);
          } else {
            await tx.run(sql`
              INSERT INTO place_halal_verification_evidence (
                id, verification_id, kind, url, r2_key, content_type, file_name,
                size_bytes, created_at
              ) VALUES (
                ${evidenceId}, ${verificationId}, 'upload', NULL,
                ${item.key}, ${item.contentType}, ${item.fileName}, ${item.sizeBytes}, ${now}
              )
            `);
          }
        }
      });
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
