import type { Metadata } from "next";
import {
  Page,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../../src/components/site-chrome";
import LoginForm from "./login-form";

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

  const reason = typeof params.reason === "string" ? params.reason : "";
  const heading =
    reason === "save"
      ? "Save it for later"
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
          siteKey={process.env.TURNSTILE_SITE_KEY?.trim() || ""}
          returnTo={returnTo}
          heading={heading}
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
