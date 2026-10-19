/**
 * Member API keys (docs/community-roadmap.md §7): a member's own AI acts under their account.
 *
 * The key is returned once by `createMemberKey` and never stored: only its SHA-256 and first 8 characters are
 * kept. Verification hashes the presented key and looks the hash up, so no secret is ever compared in code.
 */
import { sql } from "drizzle-orm";
import { database } from "@/lib/db";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export const KEY_SCOPES = ["read", "write"] as const;
export type KeyScope = (typeof KEY_SCOPES)[number];

export const KEY_PREFIX = "hfw_";
export const MAX_ACTIVE_KEYS = 3;
export const KEY_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const NAME_MAX = 40;
/** "hfw_" + 32 random bytes in base64url (43 characters). */
const KEY_PATTERN = /^hfw_[A-Za-z0-9_-]{43}$/;

export type MemberKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: KeyScope[];
  lastUsedAt: number | null;
  createdAt: number;
};

export type KeyFields = { name: string; scopes: KeyScope[] };

/** Validate `{name, scopes?}`. Scopes default to read and write; write always includes read. */
export function parseKeyFields(body: unknown): { ok: true; fields: KeyFields } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send a valid JSON object." };
  const { name, scopes } = body as { name?: unknown; scopes?: unknown };
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return { ok: false, error: "Give the key a name, like the app you will use it in." };
  if (trimmed.length > NAME_MAX) return { ok: false, error: `Keep the name to ${NAME_MAX} characters.` };
  if (scopes === undefined) return { ok: true, fields: { name: trimmed, scopes: ["read", "write"] } };
  if (!Array.isArray(scopes) || !scopes.every((scope) => KEY_SCOPES.includes(scope as KeyScope)))
    return { ok: false, error: "Scopes are read, or read and write." };
  return { ok: true, fields: { name: trimmed, scopes: scopes.includes("write") ? ["read", "write"] : ["read"] } };
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return KEY_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Hex SHA-256 of a key: the only form a key is stored in. */
export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toScopes(value: unknown): KeyScope[] {
  return String(value).split(",").filter((scope): scope is KeyScope => KEY_SCOPES.includes(scope as KeyScope));
}

/** A member's active keys, newest first. Never includes the hash. */
export async function listMemberKeys(userId: string, client: Client = database()): Promise<MemberKey[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT id, name, prefix, scopes, last_used_at, created_at FROM member_api_keys
    WHERE user_id = ${userId} AND revoked_at IS NULL ORDER BY created_at DESC`);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    prefix: String(row.prefix),
    scopes: toScopes(row.scopes),
    lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
    createdAt: Number(row.created_at),
  }));
}

export type CreateKeyResult =
  | { ok: true; key: string; record: MemberKey }
  | { ok: false; status: 403 | 409; error: string };

/** Make a key for an account at least 7 days old with fewer than 3 active keys. `key` is shown once. */
export async function createMemberKey(
  userId: string,
  fields: KeyFields,
  client: Client = database(),
  now = Date.now(),
): Promise<CreateKeyResult> {
  const db = await client;
  const [user] = await db.all<{ created_at: number }>(sql`SELECT created_at FROM "user" WHERE id = ${userId} LIMIT 1`);
  if (!user || now - Number(user.created_at) < KEY_ACCOUNT_AGE_MS)
    return { ok: false, status: 403, error: "API keys open up once your account is 7 days old." };
  const key = randomKey();
  const record: MemberKey = { id: crypto.randomUUID(), name: fields.name, prefix: key.slice(0, 8), scopes: fields.scopes, lastUsedAt: null, createdAt: now };
  // One statement, so two requests at once can't both slip past the limit.
  await db.run(sql`
    INSERT INTO member_api_keys (id, user_id, name, prefix, key_hash, scopes, created_at)
    SELECT ${record.id}, ${userId}, ${record.name}, ${record.prefix}, ${await hashKey(key)}, ${record.scopes.join(",")}, ${now}
    WHERE (SELECT count(*) FROM member_api_keys WHERE user_id = ${userId} AND revoked_at IS NULL) < ${MAX_ACTIVE_KEYS}`);
  const [made] = await db.all<{ id: string }>(sql`SELECT id FROM member_api_keys WHERE id = ${record.id}`);
  if (!made)
    return { ok: false, status: 409, error: `You can have up to ${MAX_ACTIVE_KEYS} keys. Revoke one to make another.` };
  return { ok: true, key, record };
}

/** Revoke one of the member's own keys. False when there is no such active key. */
export async function revokeMemberKey(userId: string, keyId: string, client: Client = database(), now = Date.now()): Promise<boolean> {
  const db = await client;
  const rows = await db.all<{ id: string }>(sql`
    UPDATE member_api_keys SET revoked_at = ${now}
    WHERE id = ${keyId} AND user_id = ${userId} AND revoked_at IS NULL RETURNING id`);
  return rows.length > 0;
}

export type VerifiedKey = { userId: string; keyId: string; scopes: KeyScope[] };

/** The account behind an `Authorization: Bearer hfw_…` value (or a bare key), or null. Marks the key used. */
export async function verifyMemberKey(bearer: string | null | undefined, client: Client = database(), now = Date.now()): Promise<VerifiedKey | null> {
  const key = (bearer ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!KEY_PATTERN.test(key)) return null;
  const db = await client;
  const [row] = await db.all<{ id: string; user_id: string; scopes: string }>(sql`
    UPDATE member_api_keys SET last_used_at = ${now}
    WHERE key_hash = ${await hashKey(key)} AND revoked_at IS NULL RETURNING id, user_id, scopes`);
  return row ? { userId: String(row.user_id), keyId: String(row.id), scopes: toScopes(row.scopes) } : null;
}
