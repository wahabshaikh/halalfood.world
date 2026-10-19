/**
 * D1, unlike Neon, has no connection string reachable from a plain Node
 * script: the binding only exists inside a Worker. Ops CLIs run outside the
 * Worker, so this talks to Cloudflare's D1 REST API directly with an API
 * token instead of importing `lib/db`.
 */

export type D1RestRow = Record<string, unknown>;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

/** Run one SQL statement against the remote D1 database and return its rows. */
export async function queryD1<T extends D1RestRow = D1RestRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const databaseId = requiredEnv("CLOUDFLARE_D1_DATABASE_ID");
  const token = requiredEnv("CLOUDFLARE_API_TOKEN");

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const raw = await response.text();
  let payload: {
    success?: boolean;
    errors?: { message?: string }[];
    result?: { results?: T[] }[];
  };
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`D1 REST API returned non-JSON: ${raw.slice(0, 500)}`);
  }
  if (!response.ok || payload.success !== true) {
    const message = payload.errors?.[0]?.message ?? raw.slice(0, 500);
    throw new Error(`D1 REST API query failed (${response.status}): ${message}`);
  }
  return payload.result?.[0]?.results ?? [];
}

/** Just enough of the D1 binding for drizzle, over the REST API. A batch runs one statement at a time. */
export function restBinding() {
  const statement = (text: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(text, next),
    all: async () => ({ results: await queryD1(text, params), success: true, meta: {} }),
    run: async () => ({ results: await queryD1(text, params), success: true, meta: {} }),
    first: async () => (await queryD1(text, params))[0] ?? null,
    raw: async () => (await queryD1(text, params)).map((row) => Object.values(row)),
  });
  return {
    prepare: (text: string) => statement(text),
    async batch(statements: ReturnType<typeof statement>[]) {
      const out = [];
      for (const each of statements) out.push(await each.all());
      return out;
    },
  };
}
