/**
 * The admin MCP endpoint (`/api/mcp`, Halal Food Scout) takes
 * `Authorization: Bearer <MCP_ADMIN_SECRET>` on every request. Without a long
 * enough secret on the Worker the endpoint is off (503), never open. The token
 * is compared in constant time and never logged or echoed.
 */

export const ADMIN_SECRET_MIN = 32;

export type AdminAuth =
  | { ok: true; tokenId: string }
  | { ok: false; error: "unauthorized" | "not_configured"; message: string };

/** The configured secret, or undefined when it is missing or too short to trust. */
export function adminSecret(value: unknown): string | undefined {
  const secret = typeof value === "string" ? value.trim() : "";
  return secret.length >= ADMIN_SECRET_MIN ? secret : undefined;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/** Constant time for any two strings: both are hashed first, so length leaks nothing either. */
export async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

/** First 16 hex of SHA-256: a rate-limit key that identifies the token without revealing it. */
async function tokenId(token: string): Promise<string> {
  return [...(await sha256(token)).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function checkAdminToken(request: Request, configured: unknown): Promise<AdminAuth> {
  const secret = adminSecret(configured);
  if (!secret)
    return { ok: false, error: "not_configured", message: "The Scout endpoint is off: MCP_ADMIN_SECRET is not set on this Worker." };
  const token = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token)
    return { ok: false, error: "unauthorized", message: "Missing bearer token. Send the header `Authorization: Bearer <MCP_ADMIN_SECRET>`." };
  if (!(await timingSafeEqualString(token, secret))) return { ok: false, error: "unauthorized", message: "Invalid bearer token." };
  return { ok: true, tokenId: await tokenId(token) };
}
