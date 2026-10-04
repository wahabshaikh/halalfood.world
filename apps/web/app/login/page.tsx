import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  Page,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../../src/components/site-chrome";
import { readWorkerEnv } from "../../src/lib/worker-env";
import { SIGNED_OUT_COPY, signInCopyFor } from "../../src/lib/signed-out";
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
  const returnTo =
    typeof rawReturnTo === "string" &&
    rawReturnTo.startsWith("/") &&
    !rawReturnTo.startsWith("//") &&
    !rawReturnTo.includes("\\")
      ? rawReturnTo
      : "/";

  const host = (await headers()).get("host");
  const reason = typeof params.reason === "string" ? params.reason : "";
  const heading =
    reason === "save"
      ? "Save it for later"
      : returnTo.startsWith("/feed")
        ? "See what your friends ate"
        : returnTo.startsWith("/log")
          ? "Log a visit"
          : returnTo.startsWith("/add")
        ? "Add a place"
        : returnTo.includes("/check")
          ? "Share what you saw"
          : reason === "join"
            ? "Join halalfood.world"
            : "Log in or sign up";

  return (
    <Page>
      <SiteHeader />
      <PageMain>
        <LoginForm
          siteKey={await readWorkerEnv("TURNSTILE_SITE_KEY", host)}
          returnTo={returnTo}
          heading={heading}
          notice={
            reason === "signed-out"
              ? SIGNED_OUT_COPY
              : reason === "sign-in"
                ? signInCopyFor(returnTo)
                : undefined
          }
        />
      </PageMain>
      <SiteFooter />
      <script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        async
        defer
      />
    </Page>
  );
}
