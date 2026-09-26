import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins";
import { database } from "../db";
import { authSchema } from "../db/schema";
import { sendEmail } from "./email";

function environmentValue(name: string): string {
  return process.env[name]?.trim() || "";
}

function authBaseUrl(): string {
  const configured = environmentValue("BETTER_AUTH_URL");
  if (!configured) throw new Error("BETTER_AUTH_URL is not configured");
  return configured.replace(/\/$/, "");
}

function isSecureEnvironment(baseURL: string): boolean {
  return (
    environmentValue("NODE_ENV") === "production" ||
    baseURL.startsWith("https://")
  );
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
 * request time and the D1/Drizzle connection stays request-scoped.
 */
export async function createAuth() {
  const baseURL = authBaseUrl();
  const secret = environmentValue("BETTER_AUTH_SECRET");
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not configured");
  if (secret.length < 32)
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  if (
    environmentValue("NODE_ENV") === "production" &&
    !baseURL.startsWith("https://")
  )
    throw new Error("BETTER_AUTH_URL must use HTTPS in production");
  const secureCookies = isSecureEnvironment(baseURL);

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
      // UI session checks (`/api/auth/get-session`) are answered from a signed
      // cookie instead of a D1 read. Routes that change data still resolve the
      // session from the database via `getRequestAuth` (disableCookieCache),
      // so a revoked session can never write.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
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
        async sendVerificationOTP({ email, otp, type }) {
          // This PR exposes sign-in only. Keep all future OTP mail on the same
          // transactional sender if another Better Auth flow is enabled later.
          if (type !== "sign-in")
            throw new Error("Only sign-in email OTP is enabled");
          await sendEmail({ to: email, ...otpEmail(otp) });
        },
      }),
    ],
  });
}
