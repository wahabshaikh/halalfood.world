import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../src/components/site-chrome";
import LoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to halalfood.world with a one-time email code.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main auth-main">
        <LoginForm siteKey={process.env.TURNSTILE_SITE_KEY?.trim() || ""} />
      </main>
      <SiteFooter />
      <script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        async
        defer
      />
    </div>
  );
}
