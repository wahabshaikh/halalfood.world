import type { Metadata } from "next";
import { ArrowRight01Icon, FavouriteIcon, Video01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/hf/app-shell";
import { EmptyState, Icon, LIST_GRID, LinkButton, Page, PageTitle, PlaceArt, ROW_CARD } from "@/components/hf/kit";
import { NewListButton } from "@/components/hf/list-sheets";
import { PlaceRow } from "@/components/hf/place-row";
import { getViewerId } from "@/lib/auth-session";
import { decoratePlaces } from "@/lib/explore";
import { KIND_LABEL, myLists, type ListSummary } from "@/lib/lists";
import { isModerator } from "@/lib/moderators";
import { photoUrl } from "@/lib/place-view";
import { getProfile } from "@/lib/profiles";
import { d1SavedPlaceRepository } from "@/lib/saved-places";
import { loginHref } from "@/lib/signed-out";
import { SavedTabs } from "./saved-tabs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Saved", robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

type Row = ListSummary & { people: number; invited: boolean };

function badge(list: Row): string {
  if (list.invited) return "Invited";
  if (list.kind === "guide") return "Guide";
  if (list.kind === "plan") return list.people > 1 ? `${list.people} people` : "Plan";
  if (list.visibility === "private") return "Private";
  return KIND_LABEL[list.kind];
}

function ListGroup({ title, lists }: { title: string; lists: Row[] }) {
  if (!lists.length) return null;
  return (
    <section className="grid gap-2 md:gap-3">
      <h2 className="text-[17px] font-black md:text-xl">{title}</h2>
      <ul className={cn("grid", LIST_GRID)}>
        {lists.map((list) => (
          <li key={list.id}>
            <a href={`/list/${list.id}`} className={cn("flex items-center gap-3 border-b border-border/70 py-3 text-foreground", ROW_CARD, "md:py-3.5")}>
              <PlaceArt name={list.coverName ?? list.title} seed={list.coverPlaceId ?? list.id} src={photoUrl(list.coverKey)} className="size-14" rounded="rounded-[12px]" />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <strong className="truncate text-[15px] font-extrabold">{list.title}</strong>
                <span className="text-[13px] font-semibold text-muted-foreground">
                  {list.items} {list.items === 1 ? "place" : "places"}
                  {list.ownerName && title === "Lists you saved" ? ` · ${list.ownerName}` : ""}
                </span>
              </span>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-extrabold">{badge(list)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function SavedPage({ searchParams }: Props) {
  const tab = (await searchParams).tab === "lists" ? "lists" : null;
  const viewerId = await getViewerId();
  if (!viewerId) {
    return (
      <AppShell active="saved">
        <Page size="content" className="grid gap-4 md:gap-6">
          <PageTitle>Saved</PageTitle>
          <EmptyState
            icon={FavouriteIcon}
            title="Keep places for later"
            body="Sign in to save places and make lists with friends."
            action={
              <LinkButton href={loginHref("/saved")} className="mt-2 w-fit px-6">
                Sign in
              </LinkButton>
            }
          />
        </Page>
      </AppShell>
    );
  }

  const [saved, lists, moderator, profile] = await Promise.all([
    d1SavedPlaceRepository().list(viewerId),
    myLists(viewerId),
    isModerator(viewerId),
    getProfile(viewerId),
  ]);
  const places = await decoratePlaces(viewerId, saved.places);
  const hasLists = lists.own.length + lists.planning.length + lists.saved.length > 0;

  return (
    <AppShell active="saved">
      <Page className="grid gap-4 md:gap-6">
        <PageTitle>Saved</PageTitle>
        <SavedTabs
          initial={tab}
          places={
            <div className="grid gap-4">
              {places.length ? (
                <ul className={LIST_GRID}>
                  {places.map((place) => (
                    <PlaceRow key={place.id} place={place} signedIn />
                  ))}
                </ul>
              ) : (
                <EmptyState icon={FavouriteIcon} title="Nothing saved yet" body="Tap the heart on any place to keep it here." />
              )}
              <a href="/add/video" className="flex items-center gap-3.5 rounded-2xl border border-border p-4 text-foreground hover:bg-muted md:max-w-md">
                <span className="flex size-11 items-center justify-center rounded-full bg-accent text-primary">
                  <Icon icon={Video01Icon} />
                </span>
                <span className="grid flex-1 gap-0.5">
                  <strong className="text-[15px] font-black">Save a place from a video</strong>
                  <span className="text-[13px] font-semibold text-muted-foreground">Paste a TikTok, Reel or YouTube link.</span>
                </span>
                <Icon icon={ArrowRight01Icon} size={18} />
              </a>
            </div>
          }
          lists={
            <div className="grid gap-6">
              <div className="flex justify-end">
                <NewListButton moderator={moderator} privateDefault={profile?.listsPrivateDefault ?? false} />
              </div>
              <ListGroup title="Your lists" lists={lists.own} />
              <ListGroup title="Planning with friends" lists={lists.planning} />
              <ListGroup title="Lists you saved" lists={lists.saved} />
              {!hasLists && <p className="py-6 text-center text-sm font-semibold text-muted-foreground">Make a list to plan with friends or rank your favourites.</p>}
            </div>
          }
        />
      </Page>
    </AppShell>
  );
}
