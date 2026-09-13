import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function database() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Database is not configured");
  return drizzle(neon(url), { schema });
}
