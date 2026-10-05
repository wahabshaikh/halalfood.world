import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "../../../src/components/app-shell";
import { AvatarStack, PlaceArt } from "../../../src/components/kit";
import { getViewerId } from "../../../src/lib/auth-session";
import { KIND_LABEL, getList } from "../../../src/lib/lists";
import { photoUrl } from "../../../src/lib/place-view";
import { avatarUrl } from "../../../src/lib/profiles";
import { canonical, jsonLdScript } from "../../../src/lib/seo";
import { ListActions, ListHeaderActions, ListItems } from "./list-client";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const ID = /^[0-9a-f-]{36}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = (await params).id;
  const list = ID.test(id) ? await getList(id, null).catch(() => null) : null;
  if (!list) return { title: "List", robots: { index: false } };
  return {
    title: list.title,
    description: list.caption ?? `${list.items} halal places${list.ownerName ? `, by ${list.ownerName}` : ""}.`,
    alternates: { canonical: `/list/${list.id}` },
  };
}

export default async function ListPage({ params }: Props) {
  const id = (await params).id;
  if (!ID.test(id)) notFound();
  const viewerId = await getViewerId();
  const list = await getList(id, viewerId);
  if (!list) notFound();
  const cover = list.places.find((place) => place.photoKey);
  const month = new Date(list.updatedAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const accepted = list.people.filter((person) => person.status !== "invited");
  const byline =
    list.kind === "guide"
      ? `Guide by halalfood.world · updated ${month}`
      : list.kind === "plan" && accepted.length > 1
        ? accepted.map((person) => person.name.split(" ")[0]).join(", ")
        : `By ${list.ownerName ?? "someone"}`;

  return (
    <AppShell active="saved">
      {list.visibility === "public" && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript([
              {
                "@context": "https://schema.org",
                "@type": "ItemList",
                name: list.title,
                ...(list.caption ? { description: list.caption } : {}),
                url: canonical(`/list/${list.id}`),
                itemListOrder: list.kind === "ranked" ? "https://schema.org/ItemListOrderAscending" : "https://schema.org/ItemListUnordered",
                itemListElement: list.places.map((place, index) => ({
                  "@type": "ListItem",
                  position: index + 1,
                  url: canonical(`/place/${place.id}`),
                  name: place.name,
                })),
              },
            ]),
          }}
        />
      )}
      <div className="relative h-[200px] overflow-hidden bg-secondary md:rounded-b-[20px]">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl(cover.photoKey) ?? ""} alt="" className="size-full object-cover" />
        ) : (
          <PlaceArt name={list.title} seed={list.id} className="size-full" rounded="rounded-none" textSize="text-5xl" />
        )}
        <ListHeaderActions list={{ id: list.id, title: list.title }} signedIn={Boolean(viewerId)} />
        <span className="absolute bottom-3.5 left-4 rounded-full bg-background px-3 py-1 text-xs font-black">{KIND_LABEL[list.kind]}</span>
      </div>
      <div className="grid gap-4 px-5 pt-5 pb-10">
        <div className="grid gap-1.5">
          <h1 className="text-[28px] leading-tight font-black tracking-tight">{list.title}</h1>
          {list.caption && <p className="text-[15px] font-semibold text-subtle-foreground">{list.caption}</p>}
          <div className="flex items-center gap-2.5 pt-1">
            {list.kind !== "guide" && (
              <AvatarStack people={accepted.map((person) => ({ name: person.name, seed: person.userId, src: avatarUrl(person.avatarKey, person.handle) }))} size={28} />
            )}
            <span className="text-[13px] font-bold text-muted-foreground">{byline}</span>
          </div>
        </div>

        {viewerId && list.items > 0 && (
          <div className="grid gap-1.5 rounded-2xl bg-muted p-4">
            <div className="flex justify-between text-sm font-extrabold">
              <span>
                You’ve been to {list.been} of {list.places.length}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-background">
              <div className="h-full rounded-full bg-success" style={{ width: `${list.places.length ? (list.been / list.places.length) * 100 : 0}%` }} />
            </div>
          </div>
        )}

        <ListActions
          list={{ id: list.id, title: list.title, caption: list.caption, visibility: list.visibility, kind: list.kind }}
          role={list.role}
          canAdd={list.canAdd}
          savedByMe={list.savedByMe}
          signedIn={Boolean(viewerId)}
        />

        <ListItems
          listId={list.id}
          ranked={list.kind === "ranked"}
          canReorder={list.role === "owner" && list.kind === "ranked"}
          viewerId={viewerId}
          ownerId={list.ownerId}
          items={list.places.map((place) => ({
            id: place.id,
            name: place.name,
            area: [place.cuisine, place.area].filter(Boolean).join(" · "),
            status: place.status,
            photoKey: place.photoKey,
            note: place.note,
            been: place.been,
            addedByUserId: place.addedByUserId,
          }))}
        />
      </div>
    </AppShell>
  );
}
