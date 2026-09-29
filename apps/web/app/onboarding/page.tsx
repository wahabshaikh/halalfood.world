import type { Metadata } from "next";
import { Page, PageMain, SiteHeader } from "../../src/components/site-chrome";
import { listCities } from "../../src/lib/places";
import OnboardingFlow from "./onboarding-flow";

export const metadata: Metadata = {
  title: "Set up your profile",
  description: "Choose a name, a handle and your halal standard, then pick places to try.",
  alternates: { canonical: "/onboarding" },
  robots: { index: false, follow: false },
};

const HANDLE = /^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/;

/** Only same-site paths, so the redirect after onboarding can never leave the site. */
function safePath(value: unknown, fallback: string): string {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
    ? value
    : fallback;
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ref =
    typeof params.ref === "string" && HANDLE.test(params.ref.toLowerCase())
      ? params.ref.toLowerCase()
      : null;
  const returnTo = safePath(params.returnTo, "/");

  // The city list is a nicety; the step still works without it.
  let cities: string[] = [];
  try {
    cities = (await listCities({ limit: 24 })).map((city) => city.city_slug);
  } catch {
    cities = [];
  }

  return (
    <Page>
      <SiteHeader hideSearch />
      <PageMain narrow>
        <OnboardingFlow invitedBy={ref} returnTo={returnTo} citySlugs={cities} />
      </PageMain>
    </Page>
  );
}
