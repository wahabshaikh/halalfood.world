import type { Metadata } from "next";
import { headers } from "next/headers";
import { AppShell } from "../../src/components/app-shell";
import { readWorkerEnv } from "../../src/lib/worker-env";
import { SIGNED_OUT_COPY, signInCopyFor, safeReturnPath } from "../../src/lib/signed-out";
import LoginForm from "./login-form";

// The site key is a Worker secret. Rendering this page per request is what
// lets that secret reach the widget; a build-time inline would be empty.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to halalfood.world with a one-time email code.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: true },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawReturnTo = params.returnTo;
  const returnTo = safeReturnPath(rawReturnTo, "/");

  const host = (await headers()).get("host");
  const reason = typeof params.reason === "string" ? params.reason : "";

  return (
    <AppShell hideNav footer={false}>
        <LoginForm
          siteKey={await readWorkerEnv("TURNSTILE_SITE_KEY", host)}
          returnTo={returnTo}
          invite={typeof params.invite === "string" ? params.invite : undefined}
          notice={
            reason === "signed-out"
              ? SIGNED_OUT_COPY
              : reason === "sign-in"
                ? signInCopyFor(returnTo)
                : undefined
          }
        />
      <script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        async
        defer
      />
    </AppShell>
  );
}
