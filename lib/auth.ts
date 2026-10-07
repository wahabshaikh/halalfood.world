import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins";
import { database } from "@/lib/db";
import { authSchema } from "@/lib/db/schema";
import { sendEmail } from "./email";
import { hostFromRequest, requestHostname } from "./request-host";
import { isNonProductionRequest } from "./worker-env";
import {
  SESSION_COOKIE_CACHE_SECONDS,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "./session-lifetime";

function environmentValue(name: string): string {
  return process.env[name]?.trim() || "";
}

/**
 * Used only on non-production hosts (localhost and Worker Previews) when no BETTER_AUTH_SECRET is set,
 * so sign-in works there without secrets. Production refuses to start without its own secret.
 */
export const DEVELOPMENT_AUTH_SECRET = "halalfood-world-development-only-auth-secret-0000";

/** `https://host` for a deployed host, `http://` for localhost. */
export function originFromHost(host: string): string {
  const name = requestHostname(host);
  const local = name === "localhost" || name === "127.0.0.1" || name === "::1";
  return `${local ? "http" : "https"}://${host}`;
}

export type AuthSettings = { baseURL: string; secret: string; secureCookies: boolean };

/**
 * Production uses BETTER_AUTH_URL and BETTER_AUTH_SECRET and refuses to start without them. A
 * non-production host (lib/environment.ts) uses its own origin, so a Preview's cookies and origin checks
 * match the Preview URL, and falls back to a development secret.
 */
export async function authSettings(origin?: string | null): Promise<AuthSettings> {
  const nonProduction = origin ? await isNonProductionRequest(origin) : false;
  const configuredSecret = environmentValue("BETTER_AUTH_SECRET");
  if (nonProduction && origin) {
    const baseURL = new URL(origin).origin;
    return { baseURL, secret: configuredSecret || DEVELOPMENT_AUTH_SECRET, secureCookies: baseURL.startsWith("https://") };
  }

  const configured = environmentValue("BETTER_AUTH_URL");
  if (!configured) throw new Error("BETTER_AUTH_URL is not configured");
  const baseURL = configured.replace(/\/$/, "");
  if (!configuredSecret) throw new Error("BETTER_AUTH_SECRET is not configured");
  if (configuredSecret.length < 32) throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  if (environmentValue("NODE_ENV") === "production" && !baseURL.startsWith("https://"))
    throw new Error("BETTER_AUTH_URL must use HTTPS in production");
  const secureCookies = environmentValue("NODE_ENV") === "production" || baseURL.startsWith("https://");
  return { baseURL, secret: configuredSecret, secureCookies };
}

function otpEmail(otp: string) {
  return {
    subject: "Your halalfood.world sign-in code",
    text: [
      `Your halalfood.world sign-in code is ${otp}.`,
      "",
      "It expires in 5 minutes and can only be used once.",
      "If you did not request this code, you can ignore this email.",
    ].join("\n"),
    html: [
      "<p>Use this code to sign in to halalfood.world:</p>",
      `<p style="font-size: 28px; font-weight: 700; letter-spacing: 5px">${otp}</p>`,
      "<p>This code expires in 5 minutes and can only be used once.</p>",
      "<p>If you did not request this code, you can ignore this email.</p>",
    ].join(""),
  };
}

/**
 * Build Better Auth per request so Worker environment bindings are read at
 * request time and the D1/Drizzle connection stays request-scoped. Pass the
 * request's origin so non-production hosts get their own base URL.
 */
export async function createAuth(origin?: string | null) {
  const { baseURL, secret, secureCookies } = await authSettings(origin);

  return betterAuth({
    database: drizzleAdapter(await database(), {
      provider: "sqlite",
      schema: authSchema,
      transaction: false,
    }),
    baseURL,
    basePath: "/api/auth",
    secret,
    trustedOrigins: [baseURL],
    advanced: {
      useSecureCookies: secureCookies,
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: secureCookies,
      },
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    session: {
      // 30 days, rolled forward once a day while the session is used.
      // The session cookie Max-Age follows expiresIn.
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      // UI session checks (`/api/auth/get-session`) are answered from a signed
      // cookie instead of a D1 read. This maxAge is the cache cookie only.
      // Routes that change data still resolve the session from the database
      // via `getRequestAuth` (disableCookieCache), so a revoked session can
      // never write.
      cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 30,
      customRules: {
        // Read-only and called on every page that shows personal state. With
        // database storage each call would cost a D1 read and write, and a
        // few quick page views would 429 a signed-in visitor.
        "/get-session": false,
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 5 * 60,
        allowedAttempts: 3,
        resendStrategy: "rotate",
        storeOTP: "hashed",
        rateLimit: { window: 60, max: 3 },
        async sendVerificationOTP({ email, otp, type }, ctx) {
          // This PR exposes sign-in only. Keep all future OTP mail on the same
          // transactional sender if another Better Auth flow is enabled later.
          if (type !== "sign-in")
            throw new Error("Only sign-in email OTP is enabled");
          const host = ctx?.request ? hostFromRequest(ctx.request) : "";
          await sendEmail({ to: email, ...otpEmail(otp) }, { host });
        },
      }),
    ],
  });
}
