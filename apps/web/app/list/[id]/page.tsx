import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Breadcrumbs,
  Page,
  PageIntro,
  PageMain,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../../src/components/site-chrome";
import { TextLink } from "../../../src/components/blocks";
import { Note } from "../../../src/components/section";
import { PersonAvatar } from "../../../src/components/person";
import { PlacePhoto } from "../../../src/components/place-photo";
import {
  getEditToken,
  getListForViewer,
  handleOf,
  listCollaboratorsOf,
  listItems,
} from "../../../src/lib/lists-repository";
import { listVisitedPlaceIds } from "../../../src/lib/visits";
import { getViewerId } from "../../../src/lib/auth-session";
import { placeIdParam } from "@halalfood/core/params";
import { isEditToken, listProgress } from "@halalfood/core/place-lists";
import { loadOrDegrade } from "../../../src/lib/load";
import { canonical } from "../../../src/lib/seo";
import ListActions from "./list-actions";
import ListItems from "./list-items";
import JoinList from "./join-list";

/**
 * A shared list. It is server-rendered and works without an account, which is
 * the point: every shareable artifact has to be useful to whoever opens it.
 *
 * What a viewer sees depends on who they are: private lists belong to their
 * people, a block hides a list both ways, and a private account's lists open
 * only for its followers. All of those read as missing, so none of them leaks
 * that the list exists.
 */
async function load(raw: string) {
  const id = placeIdParam(raw);
  if (!id) return { status: "missing" as const };
  return loadOrDegrade(async () => {
    const viewerId = await getViewerId();
    const access = await getListForViewer(id, viewerId);
    if (!access) return null;
    const [items, visited, collaborators, viewerHandle, editToken] = await Promise.all([
      listItems(id),
      viewerId ? listVisitedPlaceIds(viewerId) : Promise.resolve(new Set<string>()),
      access.role === "owner" || access.role === "editor" || access.role === "invited"
        ? listCollaboratorsOf(id)
        : Promise.resolve([]),
      viewerId ? handleOf(viewerId) : Promise.resolve(null),
      access.role === "owner" && access.editLinkOn && viewerId
        ? getEditToken(id, viewerId)
        : Promise.resolve(null),
    ]);
    return {
      ...access,
      viewerId,
      viewerHandle,
      items,
      visited,
      collaborators,
      editLinkPath: editToken ? `/list/${id}?join=${editToken}` : null,
    };
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const loaded = await load((await params).id);
  if (loaded.status !== "ok")
    return { title: "List not found", robots: { index: false, follow: true } };
  const { list } = loaded.data;
  return {
    title: list.title,
    description:
      list.caption ??
      list.description ??
      `${list.itemCount} halal ${list.itemCount === 1 ? "place" : "places"} collected on halalfood.world.`,
    alternates: { canonical: `/list/${list.id}` },
    robots:
      list.visibility === "public"
        ? { index: true, follow: true }
        : { index: false, follow: true },
  };
}

export default async function ListPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const join = (await searchParams).join;
  const joinToken = typeof join === "string" && isEditToken(join) ? join : null;
  const loaded = await load(id);
  if (loaded.status === "error")
    return (
      <Page>
        <SiteHeader />
        <PageMain>
          <Unavailable retryPath={`/list/${encodeURIComponent(id)}`} />
        </PageMain>
        <SiteFooter />
      </Page>
    );

  // A private list opened through its edit link shows only the invitation, so
  // the link never reveals what is on the list before someone joins.
  if (loaded.status === "missing") {
    const listId = placeIdParam(id);
    if (!joinToken || !listId) notFound();
    return (
      <Page>
        <SiteHeader />
        <PageMain>
          <PageIntro eyebrow="A SHARED LIST" title="You’ve been invited to a list">
            <JoinList listId={listId} token={joinToken} />
          </PageIntro>
        </PageMain>
        <SiteFooter />
      </Page>
    );
  }

  const { list, owner, role, saved, editLinkPath, items, visited, collaborators, viewerId, viewerHandle } =
    loaded.data;
  const progress = viewerId ? listProgress(items, visited) : null;
  const cover = items.find((item) => item.placeId === list.displayCoverPlaceId) ?? items[0];
  const ownerName = owner ? (owner.displayName ?? owner.handle) : null;
  const canJoin = joinToken && (role === "viewer" || !viewerId) && !list.ranked;

  return (
    <Page>
      <SiteHeader />
      <PageMain>
        <Breadcrumbs
          trail={[
            { name: "Halalfood", path: "/" },
            { name: list.title, path: `/list/${list.id}` },
          ]}
        />
        <PageIntro
          eyebrow={list.ranked ? "A PERSONAL RANKING" : "A COLLECTION"}
          title={list.title}
          lead={list.caption || list.description || undefined}
        >
          {cover && (
            <PlacePhoto
              seed={cover.placeId}
              name={cover.name}
              className="aspect-[3/1] max-h-44 w-full rounded-2xl"
            />
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {owner && (
              <a href={`/u/${owner.handle}`} className="inline-flex items-center gap-2 font-semibold text-foreground hover:underline">
                <PersonAvatar name={ownerName ?? owner.handle} avatarUrl={owner.avatarUrl} size={28} />
                {ownerName}
              </a>
            )}
            <span>
              {list.itemCount} {list.itemCount === 1 ? "place" : "places"}
            </span>
            {list.saveCount > 0 && (
              <span>
                {list.saveCount} {list.saveCount === 1 ? "save" : "saves"}
              </span>
            )}
            {progress && progress.total > 0 && role !== "owner" && (
              <span className="font-semibold text-foreground">
                You’ve been {progress.been}/{progress.total}
              </span>
            )}
            {progress && progress.total > 0 && role === "owner" && (
              <span>
                You’ve been to {progress.been} of {progress.total}
              </span>
            )}
          </div>
          {list.caption && list.description && <p className="text-sm">{list.description}</p>}
          <Note>
            {list.ranked
              ? "This is one diner's ranking of places they have visited, not a platform ranking."
              : collaborators.some((person) => person.status === "accepted")
                ? "A collection put together by a group of diners."
                : "A collection assembled by one diner."}{" "}
            Saves and notes are taste; each place keeps its own halal status and evidence.
          </Note>
          {canJoin && joinToken && <JoinList listId={list.id} token={joinToken} />}
          <ListActions
            listId={list.id}
            title={list.title}
            role={role}
            viewerHandle={viewerHandle}
            signedIn={Boolean(viewerId)}
            saved={saved}
            saves={list.saveCount}
            itemCount={list.itemCount}
            sendable={
              Boolean(viewerId) &&
              (list.visibility === "public" || (role === "owner" && list.visibility === "unlisted"))
            }
            editable={{
              title: list.title,
              caption: list.caption,
              description: list.description,
              ranked: list.ranked,
              visibility: list.visibility,
              coverPlaceId: list.coverPlaceId,
            }}
            places={items.map((item) => ({ placeId: item.placeId, name: item.name }))}
            collaborators={collaborators.map(({ userId: _userId, ...person }) => person)}
            editLinkPath={editLinkPath}
          />
        </PageIntro>

        <ListItems
          listId={list.id}
          initialItems={items}
          role={role}
          viewerId={viewerId}
          ranked={list.ranked}
          visitedIds={[...visited].filter((placeId) => items.some((item) => item.placeId === placeId))}
          shared={collaborators.some((person) => person.status === "accepted")}
        />

        <p className="mt-6 text-sm text-muted-foreground">
          Want your own? <TextLink href={canonical("/lists")}>Start a list</TextLink>.
        </p>
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
