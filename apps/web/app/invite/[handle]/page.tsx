import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button } from "@halalfood/ui/components/button";
import { Card } from "@halalfood/ui/components/card";
import {
  Page,
  PageMain,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../../src/components/site-chrome";
import { PersonAvatar } from "../../../src/components/person";
import { getProfileByHandle } from "../../../src/lib/preferences-repository";
import { loadOrDegrade } from "../../../src/lib/load";
import { avatarUrl, HANDLE_PATTERN, normalizeHandle } from "@halalfood/core/social";
import { cityName } from "../../../src/lib/seo";

/**
 * An invite link names only the diner who shared it: no token, no contact data.
 * Opening it shows who invited you, then hands off to onboarding, which follows
 * them when you finish.
 */
async function load(rawHandle: string) {
  const handle = normalizeHandle(decodeURIComponent(rawHandle));
  if (!handle || !HANDLE_PATTERN.test(handle)) return { status: "missing" as const };
  return loadOrDegrade(() => getProfileByHandle(handle));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const loaded = await load(handle);
  const profile = loaded.status === "ok" ? loaded.data : null;
  const name = profile ? (profile.displayName ?? profile.handle) : null;
  return {
    title: name ? `${name} invited you to halalfood.world` : "Join halalfood.world",
    description: "Find halal food through the people you trust.",
    alternates: { canonical: profile ? `/invite/${profile.handle}` : "/" },
    robots: { index: false, follow: true },
  };
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const loaded = await load(handle);
  if (loaded.status === "missing") notFound();
  if (loaded.status === "error")
    return (
      <Page>
        <SiteHeader hideSearch />
        <PageMain narrow>
          <Unavailable retryPath={`/invite/${encodeURIComponent(handle)}`} />
        </PageMain>
        <SiteFooter />
      </Page>
    );
  const profile = loaded.data;
  if (!profile || profile.onboardedAt === null) {
    return (
      <Page>
        <SiteHeader hideSearch />
        <PageMain narrow>
          <section className="mx-auto my-10 max-w-xl">
            <Card className="items-center gap-4 rounded-3xl px-6 py-9 text-center shadow-lg ring-border sm:px-9">
              <h1 className="text-[26px]">This invite is not active yet</h1>
              <p className="text-base text-muted-foreground">
                The person who shared it still needs to finish their profile. You can look
                through the directory in the meantime.
              </p>
              <Button asChild size="xl">
                <a href="/">Browse places</a>
              </Button>
            </Card>
          </section>
        </PageMain>
        <SiteFooter />
      </Page>
    );
  }
  const name = profile.displayName ?? profile.handle;

  return (
    <Page>
      <SiteHeader hideSearch />
      <PageMain narrow>
        <section aria-labelledby="invite-title" className="mx-auto my-10 max-w-xl">
          <Card className="items-center gap-4 rounded-3xl px-6 py-9 text-center shadow-lg ring-border sm:px-9">
            <PersonAvatar
              name={name}
              avatarUrl={avatarUrl(profile.handle, profile.avatarKey)}
              size={84}
            />
            <h1 id="invite-title" className="text-[26px]">
              {name} invited you to halalfood.world
            </h1>
            <p className="text-base text-muted-foreground">
              Follow friends, see where they eat and keep your own list. Halal status comes only
              from dated, moderated evidence, never from likes or followers.
            </p>
            {profile.homeCitySlug && (
              <p className="text-sm">
                {name} is eating in{" "}
                <a className="font-bold underline" href={`/city/${profile.homeCitySlug}`}>
                  {cityName(profile.homeCitySlug)}
                </a>
                .
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Join and follow @{profile.handle}. If that follow does not stick, Finish on the
              setup page retries it without creating a second profile.
            </p>
            <Button asChild size="xl" className="w-full">
              <a href={`/onboarding?ref=${encodeURIComponent(profile.handle)}`}>
                Join and follow @{profile.handle}
              </a>
            </Button>
            <a className="text-sm font-bold underline" href={`/u/${profile.handle}`}>
              See {name}&apos;s profile first
            </a>
          </Card>
        </section>
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
