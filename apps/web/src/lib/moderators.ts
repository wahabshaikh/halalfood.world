import { sql } from "drizzle-orm";
import { database } from "../db";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export async function isModerator(userId: string | null, client: Client = database()): Promise<boolean> {
  if (!userId) return false;
  const db = await client;
  const rows = await db.all(sql`SELECT 1 FROM moderators WHERE user_id = ${userId} LIMIT 1`);
  return rows.length > 0;
}

export async function openReportCount(client: Client = database()): Promise<number> {
  const db = await client;
  const [row] = await db.all<{ count: number }>(sql`SELECT count(*) AS count FROM reports WHERE status = 'open'`);
  return Number(row?.count ?? 0);
}
