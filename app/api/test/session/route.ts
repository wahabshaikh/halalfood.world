import { makeSignature } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { createAuth } from "@/lib/auth";
import { database } from "@/lib/db";
import { ensureProfile, markOnboarded } from "@/lib/profiles";
import { hostFromRequest } from "@/lib/request-host";
import { parseTestSessionInput } from "@/lib/test-session";
import { isNonProductionRequest } from "@/lib/worker-env";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Localhost and Worker Previews only (404 in production): signs a person in with one request.
 * Creates the account if it doesn't exist, applies the fixture fields, opens a real Better Auth
 * session and sets its signed cookie. The sign-in UI keeps its own E2E test; everything else uses
 * this to skip the email code.
 */
export async function POST(request: Request) {
  if (!(await isNonProductionRequest(hostFromRequest(request)))) return Response.json({ error: "Not found" }, { status: 404 });
  const input = parseTestSessionInput(await request.json().catch(() => null));
  if ("error" in input) return Response.json({ error: input.error }, { status: 400 });

  const db = await database();
  const now = Date.now();
  const createdAt = now - (input.ageDays ?? 2) * DAY;
  let [user] = await db.all<{ id: string }>(sql`SELECT id FROM "user" WHERE email = ${input.email} LIMIT 1`);
  if (!user) {
    user = { id: crypto.randomUUID() };
    const name = input.name ?? input.email.split("@")[0] ?? "Tester";
    await db.run(sql`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${user.id}, ${name}, ${input.email}, 1, ${createdAt}, ${now})
    `);
  } else if (input.ageDays !== undefined) {
    await db.run(sql`UPDATE "user" SET created_at = ${createdAt} WHERE id = ${user.id}`);
  }
  if (input.name) await db.run(sql`UPDATE "user" SET name = ${input.name}, updated_at = ${now} WHERE id = ${user.id}`);

  const profile = await ensureProfile(user.id, db, now);
  if (input.onboarded) await markOnboarded(user.id, db, now);
  if (input.moderator) {
    await db.run(sql`INSERT INTO moderators (user_id, role, created_at) VALUES (${user.id}, 'moderator', ${now}) ON CONFLICT (user_id) DO NOTHING`);
  }

  const context = await (await createAuth(new URL(request.url).origin)).$context;
  const session = await context.internalAdapter.createSession(user.id);
  const cookie = context.authCookies.sessionToken;
  const value = `${session.token}.${await makeSignature(session.token, context.secret)}`;
  const attributes = [
    `Path=${cookie.attributes.path ?? "/"}`,
    "HttpOnly",
    `SameSite=${cookie.attributes.sameSite ?? "Lax"}`,
    `Max-Age=${cookie.attributes.maxAge ?? 60 * 60 * 24 * 30}`,
    ...(cookie.attributes.secure ? ["Secure"] : []),
  ];
  return Response.json(
    {
      ok: true,
      user: { id: user.id, email: input.email, handle: profile?.handle ?? null },
      cookie: { name: cookie.name, value, secure: Boolean(cookie.attributes.secure) },
    },
    { headers: { "set-cookie": `${cookie.name}=${encodeURIComponent(value)}; ${attributes.join("; ")}`, "cache-control": "no-store" } },
  );
}
