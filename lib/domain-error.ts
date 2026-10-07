/**
 * A failed read or write, named for the part of the product that failed.
 *
 * Callers pass the caught error so a missing table or column is logged with a
 * short reference. The response tells the diner which area failed and gives
 * them that reference; it does not include the SQL.
 */

import { json } from "./api";

export function isSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /no such (table|column)/i.test(message);
}

export function isUniqueConstraint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /unique constraint failed/i.test(message);
}

export function domainFailure(domain: string, error: unknown): Response {
  const reference = crypto.randomUUID().slice(0, 8);
  const message = error instanceof Error ? error.message : String(error ?? "");
  console.error(JSON.stringify({ domain, reference, message }));
  const schema = isSchemaError(error);
  return json(
    {
      error: schema
        ? `${domain} is unavailable until the database schema is updated. Reference ${reference}.`
        : `${domain} is temporarily unavailable. Please try again. Reference ${reference}.`,
      reference,
      code: schema ? "schema" : "unavailable",
    },
    { status: 503 },
  );
}
