import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VERDICT_LABEL } from "@halalfood/core/check";
import { AppShell } from "../../../src/components/app-shell";
import { Avatar, EmptyState, PlaceArt, StatusPill, TopBar } from "../../../src/components/kit";
import { ReportButton } from "../../../src/components/report-sheet";
import { timeAgo } from "../../../src/components/time-ago";
import { getViewerId } from "../../../src/lib/auth-session";
import { getVisit, likers, listComments } from "../../../src/lib/feed";
import { photoUrl } from "../../../src/lib/place-view";
import { avatarUrl } from "../../../src/lib/profiles";
import { Comments, LikeLine } from "./visit-client";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const ID = /^[0-9a-f-]{36}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = (await params).id;
  const visit = ID.test(id) ? await getVisit(id, null).catch(() => null) : null;
  return {
    title: visit ? `${visit.author.name} at ${visit.place.name}` : "Visit",
    robots: { index: false },
  };
}

export default async function VisitPage({ params }: Props) {
  const id = (await params).id;
  if (!ID.test(id)) notFound();
  const viewerId = await getViewerId();
  const visit = await getVisit(id, viewerId);
  if (!visit) {
    return (
      <AppShell active="friends">
        <TopBar back="/friends" />
        <EmptyState title="This visit isn’t available" body="It may be private, or it was removed." />
      </AppShell>
    );
  }
  const [names, comments] = await Promise.all([likers(id, viewerId), listComments(id, viewerId)]);
  const author = visit.author;
  const photos = visit.photoKeys.map((key) => photoUrl(key)).filter((url): url is string => Boolean(url));
  return (
    <AppShell active="friends">
      <TopBar back="/friends">
        {viewerId && viewerId !== author.userId && (
          <ReportButton targetType="check" targetId={visit.checkId} subject={`${author.name} at ${visit.place.name}`} signedIn variant="icon" label="Report this visit" />
        )}
      </TopBar>
      <article className="grid gap-4 px-5 pb-6">
        <header className="flex items-center gap-3">
          <a href={author.handle ? `/u/${author.handle}` : "#"}>
            <Avatar name={author.name} seed={author.userId} src={author.handle ? avatarUrl(author.avatarKey, author.handle) : null} size={44} />
          </a>
          <div className="grid">
            <a href={author.handle ? `/u/${author.handle}` : "#"} className="text-[15px] font-black text-foreground">
              {author.name}
            </a>
            <span className="text-[13px] font-semibold text-muted-foreground">{timeAgo(visit.createdAt)}</span>
          </div>
        </header>
        {photos.length > 0 && (
          <div className="flex snap-x gap-2 overflow-x-auto [scrollbar-width:none]">
            {photos.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt={`Photo from ${visit.place.name}`} className="aspect-[4/3] w-full shrink-0 snap-center rounded-2xl object-cover" />
            ))}
          </div>
        )}
        <a href={`/place/${visit.place.id}`} className="flex items-center gap-3 rounded-2xl border border-border p-3 text-foreground">
          <PlaceArt name={visit.place.name} seed={visit.place.id} src={photoUrl(visit.place.photoKey)} className="size-14" rounded="rounded-[12px]" />
          <span className="grid min-w-0 flex-1 gap-1">
            <strong className="truncate text-base font-extrabold">{visit.place.name}</strong>
            <StatusPill status={visit.place.status} short className="w-fit" />
          </span>
          {visit.verdict && <span className="rounded-full bg-accent px-3 py-1 text-[13px] font-extrabold text-primary">{VERDICT_LABEL[visit.verdict]}</span>}
        </a>
        {visit.note && <p className="text-base leading-relaxed">{visit.note}</p>}
        {visit.dishes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {visit.dishes.map((dish) => (
              <span key={dish} className="rounded-full bg-secondary px-3 py-1 text-[13px] font-extrabold">
                {dish}
              </span>
            ))}
          </div>
        )}
        <LikeLine checkId={visit.checkId} liked={visit.likedByMe} likes={visit.likes} names={names} signedIn={Boolean(viewerId)} />
      </article>
      <Comments
        checkId={visit.checkId}
        signedIn={Boolean(viewerId)}
        initial={(comments ?? []).map((comment) => ({
          ...comment,
          author: { ...comment.author, avatarUrl: comment.author.handle ? avatarUrl(comment.author.avatarKey, comment.author.handle) : null },
        }))}
      />
    </AppShell>
  );
}
