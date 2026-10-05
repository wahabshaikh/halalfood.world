import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveCity } from "../../src/components/explore-screen";
import { AppShell } from "../../src/components/app-shell";
import { getViewerId } from "../../src/lib/auth-session";
import { cityName } from "../../src/lib/place-view";
import { avatarUrl, ensureProfile } from "../../src/lib/profiles";
import { loginHref, safeReturnPath } from "../../src/lib/signed-out";
import { acceptInvite } from "../../src/lib/people";
import { normalizeHandle } from "@halalfood/core/people";
import { WelcomeFlow } from "./welcome-flow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Welcome", robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function WelcomePage({ searchParams }: Props) {
  const params = await searchParams;
  const returnTo = safeReturnPath(typeof params.returnTo === "string" ? params.returnTo : "/");
  const viewerId = await getViewerId();
  if (!viewerId) redirect(loginHref("/welcome"));
  let profile = await ensureProfile(viewerId);
  if (!profile) redirect("/");
  const invite = typeof params.invite === "string" ? normalizeHandle(params.invite) : null;
  if (invite && (await acceptInvite(viewerId, invite).catch(() => false))) profile = (await ensureProfile(viewerId)) ?? profile;
  const citySlug = profile.homeCitySlug ?? (await resolveCity(null).catch(() => ({ city: null }))).city?.city_slug ?? null;
  return (
    <AppShell hideNav footer={false}>
      <WelcomeFlow
        returnTo={returnTo}
        seed={viewerId}
        initial={{
          displayName: profile.displayName === profile.handle ? "" : profile.displayName,
          handle: profile.handle,
          avatarUrl: avatarUrl(profile.avatarKey, profile.handle),
          filters: profile.defaultFilters,
        }}
        city={citySlug ? { slug: citySlug, name: cityName(citySlug) } : null}
      />
    </AppShell>
  );
}
