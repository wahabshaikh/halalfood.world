import { getRequestSessionUser } from "../../../../src/lib/auth-session";

function environmentValue(name: string): string {
  return process.env[name]?.trim() || "";
}

function noStore() {
  return { "Cache-Control": "no-store" };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Signs the signed-in user's email with the Crisp "Verify visitor identity"
 * secret so the client can call `$crisp.push(["set", "user:email", [...]])`
 * with a signature Crisp will accept, instead of a plain, spoofable email.
 */
export async function GET(request: Request) {
  const user = await getRequestSessionUser(request);
  if (user.status === "unauthenticated")
    return Response.json(
      { error: "Sign in to identify with chat support." },
      { status: 401, headers: noStore() },
    );
  if (user.status === "unavailable")
    return Response.json(
      { error: "Chat identity verification is temporarily unavailable." },
      { status: 503, headers: noStore() },
    );

  const secret = environmentValue("CRISP_IDENTITY_SECRET");
  if (!secret)
    return Response.json(
      { error: "Chat identity verification is not configured." },
      { status: 503, headers: noStore() },
    );

  const signature = await hmacSha256Hex(secret, user.email);
  return Response.json(
    { email: user.email, signature, name: user.name },
    { headers: noStore() },
  );
}
