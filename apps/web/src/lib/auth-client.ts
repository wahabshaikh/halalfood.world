"use client";

import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  baseURL:
    typeof window === "undefined" ? undefined : window.location.origin,
  plugins: [emailOTPClient()],
});

export class AuthClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AuthClientError";
  }
}
function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return status;
  if (status && typeof status === "object") {
    const nested = (status as { status?: unknown }).status;
    if (typeof nested === "number") return nested;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Sign-in failed";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim()
    ? message
    : "Sign-in failed";
}

function throwClientError(error: unknown): never {
  throw new AuthClientError(errorMessage(error), errorStatus(error));
}

export async function requestLoginOtp(
  email: string,
  turnstileToken: string,
) {
  const result = await authClient.emailOtp.sendVerificationOtp({
    email,
    type: "sign-in",
    fetchOptions: {
      headers: { "X-Turnstile-Token": turnstileToken },
    },
  });
  if (result.error) throwClientError(result.error);
  return result.data;
}

export async function verifyLoginOtp(email: string, otp: string) {
  const result = await authClient.signIn.emailOtp({ email, otp });
  if (result.error) throwClientError(result.error);
  return result.data;
}
