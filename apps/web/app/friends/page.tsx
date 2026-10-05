import type { Metadata } from "next";
import { Award01Icon, Notification03Icon, UserGroupIcon, UserSearch01Icon } from "@hugeicons/core-free-icons";
import { AppShell } from "../../src/components/app-shell";
import { EmptyState, Icon, IconLink, LinkButton, Page } from "../../src/components/kit";
import { getViewerId } from "../../src/lib/auth-session";
import { feedPage } from "../../src/lib/feed";
import { unreadCount } from "../../src/lib/inbox";
import { suggestedPeople } from "../../src/lib/people";
import { avatarUrl, getProfile } from "../../src/lib/profiles";
import { loginHref } from "../../src/lib/signed-out";
import { visitJson } from "../../src/lib/visit-json";
import { InviteButton } from "../me/me-client";
import { FeedList, SuggestedPeople } from "./friends-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Friends", robots: { index: false } };

export default async function FriendsPage() {
  const viewerId = await getViewerId();
  if (!viewerId) {
    return (
      <AppShell active="friends">
        <Page size="content">
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
        </Page>
      </AppShell>
    );
  }
  const [page, unread, profile] = await Promise.all([feedPage(viewerId, null), unreadCount(viewerId).catch(() => 0), getProfile(viewerId)]);
  const suggestions = await suggestedPeople(viewerId, profile?.homeCitySlug ?? null).catch(() => []);
  const people = suggestions.map((person) => ({ handle: person.handle, name: person.name, avatarUrl: avatarUrl(person.avatarKey, person.handle) }));
  const inboxLabel = unread ? `Inbox, ${unread} unread` : "Inbox";
  return (
    <AppShell active="friends">
      <Page>
        <header className="mb-2 flex items-center gap-1 md:mb-6 md:gap-2">
          <h1 className="flex-1 text-[28px] font-black tracking-tight md:text-[34px]">Friends</h1>
          <div className="flex items-center gap-1 md:hidden">
            <IconLink href="/community" label="Community" icon={Award01Icon} />
            <span className="relative">
              <IconLink href="/inbox" label={inboxLabel} icon={Notification03Icon} />
              {unread > 0 && (
                <span className="pointer-events-none absolute top-1 right-1 min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] leading-5 font-black text-primary-foreground">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </span>
            <IconLink href="/search?tab=people" label="Find people" icon={UserSearch01Icon} />
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <LinkButton href="/community" variant="outline" size="sm">
              <Icon icon={Award01Icon} size={16} />
              Community
            </LinkButton>
            <LinkButton href="/inbox" variant="outline" size="sm" aria-label={inboxLabel}>
              <Icon icon={Notification03Icon} size={16} />
              Inbox
              {unread > 0 && (
                <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] leading-5 font-black text-primary-foreground">{unread > 99 ? "99+" : unread}</span>
              )}
            </LinkButton>
            <LinkButton href="/search?tab=people" variant="outline" size="sm">
              <Icon icon={UserSearch01Icon} size={16} />
              Find people
            </LinkButton>
          </div>
        </header>
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-x-12">
          <div>
            {page.items.length ? (
              <FeedList initial={page.items.map(visitJson)} next={page.next} />
            ) : (
              <div className="grid gap-4">
                <EmptyState icon={UserGroupIcon} title="Follow people to see where they eat" body="Their checks, notes and photos show up here." />
                <div className="lg:hidden">
                  <SuggestedPeople people={people} />
                </div>
              </div>
            )}
          </div>
          <aside className="hidden lg:sticky lg:top-24 lg:grid lg:gap-5">
            {people.length > 0 && (
              <div className="rounded-[20px] border border-border p-5">
                <SuggestedPeople people={people} />
              </div>
            )}
            {profile && (
              <div className="grid gap-2 rounded-[20px] bg-muted p-5">
                <h2 className="text-[17px] font-black md:text-xl">Bring friends along</h2>
                <p className="text-sm font-semibold text-subtle-foreground">Invite someone and see where they eat.</p>
                <InviteButton handle={profile.handle} className="-ml-3 w-fit" />
              </div>
            )}
          </aside>
        </div>
      </Page>
    </AppShell>
  );
}
