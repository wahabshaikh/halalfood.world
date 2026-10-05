import type { Metadata } from "next";
import { Award01Icon, Notification03Icon, UserGroupIcon, UserSearch01Icon } from "@hugeicons/core-free-icons";
import { AppShell } from "../../src/components/app-shell";
import { EmptyState, IconLink, LinkButton } from "../../src/components/kit";
import { getViewerId } from "../../src/lib/auth-session";
import { feedPage } from "../../src/lib/feed";
import { unreadCount } from "../../src/lib/inbox";
import { suggestedPeople } from "../../src/lib/people";
import { avatarUrl, getProfile } from "../../src/lib/profiles";
import { loginHref } from "../../src/lib/signed-out";
import { visitJson } from "../../src/lib/visit-json";
import { FeedList, SuggestedPeople } from "./friends-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Friends", robots: { index: false } };

export default async function FriendsPage() {
  const viewerId = await getViewerId();
  if (!viewerId) {
    return (
      <AppShell active="friends">
        <EmptyState
          icon={UserGroupIcon}
          title="See where your friends eat"
          body="Sign in to follow people and see their checks."
          action={
            <LinkButton href={loginHref("/friends")} className="mt-2 w-fit px-6">
              Sign in
            </LinkButton>
          }
        />
      </AppShell>
    );
  }
  const [page, unread, profile] = await Promise.all([feedPage(viewerId, null), unreadCount(viewerId).catch(() => 0), getProfile(viewerId)]);
  const suggestions = page.items.length ? [] : await suggestedPeople(viewerId, profile?.homeCitySlug ?? null).catch(() => []);
  return (
    <AppShell active="friends">
      <header className="flex items-center gap-1 px-5 pt-[18px] pb-2">
        <h1 className="flex-1 text-[28px] font-black tracking-tight">Friends</h1>
        <IconLink href="/community" label="Community" icon={Award01Icon} />
        <span className="relative">
          <IconLink href="/inbox" label={unread ? `Inbox, ${unread} unread` : "Inbox"} icon={Notification03Icon} />
          {unread > 0 && (
            <span className="pointer-events-none absolute top-1 right-1 min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] leading-5 font-black text-primary-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </span>
        <IconLink href="/search?tab=people" label="Find people" icon={UserSearch01Icon} />
      </header>
      <div className="px-5 pb-10">
        {page.items.length ? (
          <FeedList initial={page.items.map(visitJson)} next={page.next} />
        ) : (
          <div className="grid gap-4">
            <EmptyState icon={UserGroupIcon} title="Follow people to see where they eat" body="Their checks, notes and photos show up here." />
            <SuggestedPeople
              people={suggestions.map((person) => ({ handle: person.handle, name: person.name, avatarUrl: avatarUrl(person.avatarKey, person.handle) }))}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
