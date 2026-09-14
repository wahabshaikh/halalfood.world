import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Create a request-scoped Neon HTTP client. Neon HTTP does not keep a Node
 * pool alive between Worker requests, which keeps this safe for Cloudflare.
 */
export function neonSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Database is not configured");
  return neon(url);
}

export function database() {
  return drizzle(neonSql(), { schema });
}
