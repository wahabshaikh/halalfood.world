import { sql } from "drizzle-orm";
import { database } from "../db";
import type {
  HalalVerificationStatus,
  ValidatedHalalVerification,
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

type DatabaseClient = ReturnType<typeof database>;

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date(0).toISOString();
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

export function neonHalalVerificationRepository(
  client: DatabaseClient = database(),
): HalalVerificationRepository {
  return {
    async hasPlace(placeId) {
      const result = await client.execute(sql`
        SELECT 1
        FROM places
        WHERE id = ${placeId}::uuid AND halal_confirmed IS TRUE
        LIMIT 1
      `);
      return result.rows.length > 0;
    },

    async list(placeId, userId) {
      const visibility = userId
        ? sql`(v.status = 'approved' OR (v.status = 'pending' AND v.submitted_by_user_id = ${userId}))`
        : sql`v.status = 'approved'`;
      const result = await client.execute(sql`
        SELECT
          v.id::text AS id,
          v.status,
          v.note,
          v.created_at,
          COALESCE(
            json_agg(
              json_build_object(
                'kind', e.kind,
                'url', e.url,
                'r2_key', e.r2_key,
                'content_type', e.content_type,
                'file_name', e.file_name
              ) ORDER BY e.created_at, e.id
            ) FILTER (WHERE e.id IS NOT NULL),
            '[]'::json
          ) AS evidence
        FROM place_halal_verifications AS v
        INNER JOIN places AS p ON p.id = v.place_id
        LEFT JOIN place_halal_verification_evidence AS e
          ON e.verification_id = v.id
        WHERE v.place_id = ${placeId}::uuid
          AND p.halal_confirmed IS TRUE
          AND ${visibility}
        GROUP BY v.id, v.status, v.note, v.created_at
        ORDER BY v.created_at DESC, v.id DESC
        LIMIT 25
      `);
      return (result.rows as unknown as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        status: visibleStatus(row.status),
        note: typeof row.note === "string" ? row.note : null,
        createdAt: isoDate(row.created_at),
        evidence: mapEvidence(row.evidence),
      }));
    },

    async create(userId, placeId, input) {
      const verificationId = crypto.randomUUID();
      const now = new Date().toISOString();
      const evidenceValues = sql.join(
        input.evidence.map((item) => {
          const evidenceId = crypto.randomUUID();
          return item.kind === "link"
            ? sql`(
                ${evidenceId}::uuid,
                ${verificationId}::uuid,
                'link',
                ${item.url},
                NULL,
                NULL,
                NULL,
                NULL,
                ${now}::timestamptz
              )`
            : sql`(
                ${evidenceId}::uuid,
                ${verificationId}::uuid,
                'upload',
                NULL,
                ${item.key},
                ${item.contentType},
                ${item.fileName},
                ${item.sizeBytes},
                ${now}::timestamptz
              )`;
        }),
        sql`,`,
      );
      await client.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO place_halal_verifications (
            id, place_id, submitted_by_user_id, status, note, created_at, updated_at
          ) VALUES (
            ${verificationId}::uuid,
            ${placeId}::uuid,
            ${userId},
            'pending',
            ${input.note},
            ${now}::timestamptz,
            ${now}::timestamptz
          )
        `);
        await tx.execute(sql`
          INSERT INTO place_halal_verification_evidence (
            id, verification_id, kind, url, r2_key, content_type, file_name,
            size_bytes, created_at
          ) VALUES ${evidenceValues}
        `);
      });
      return { id: verificationId, status: "pending" };
    },

    async getUploadAccess(key, userId) {
      const visibility = userId
        ? sql`(v.status = 'approved' OR (v.status = 'pending' AND v.submitted_by_user_id = ${userId}))`
        : sql`v.status = 'approved'`;
      const result = await client.execute(sql`
        SELECT v.status, e.content_type, e.file_name
        FROM place_halal_verification_evidence AS e
        INNER JOIN place_halal_verifications AS v
          ON v.id = e.verification_id
        INNER JOIN places AS p ON p.id = v.place_id
        WHERE e.kind = 'upload'
          AND e.r2_key = ${key}
          AND p.halal_confirmed IS TRUE
          AND ${visibility}
        LIMIT 1
      `);
      const row = result.rows[0] as
        | { status?: unknown; content_type?: unknown; file_name?: unknown }
        | undefined;
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
