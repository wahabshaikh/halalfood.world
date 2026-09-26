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
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@halalfood/ui/components/item";
import { TextLink } from "../../../src/components/blocks";
import { InsufficientData, Note } from "../../../src/components/section";
import ShareButton from "../../../src/components/share-button";
import { getList, listItems } from "../../../src/lib/lists-repository";
import { placeIdParam } from "@halalfood/core/params";
import { loadOrDegrade } from "../../../src/lib/load";
import { canonical, cityName } from "../../../src/lib/seo";

/**
 * A shared list. It is server-rendered and works without an account, which is
 * the point: every shareable artifact has to be useful to whoever opens it.
 */
async function load(raw: string) {
  const id = placeIdParam(raw);
  if (!id) return { status: "missing" as const };
  return loadOrDegrade(async () => {
    const list = await getList(id);
    // A private list is invisible to everyone but its owner, and this page is
    // public, so it reads as missing here rather than leaking its existence.
    if (!list || list.visibility === "private") return null;
    return { list, items: await listItems(id) };
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
      list.description ??
      `${list.itemCount} halal ${list.itemCount === 1 ? "place" : "places"} collected on halalfood.world.`,
    alternates: { canonical: `/list/${list.id}` },
    robots:
      list.visibility === "unlisted"
        ? { index: false, follow: true }
        : { index: true, follow: true },
  };
}

export default async function ListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loaded = await load(id);
  if (loaded.status === "missing") notFound();
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

  const { list, items } = loaded.data;

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
          lead={list.description || undefined}
        >
          <Note>
            {list.ranked
              ? "This is one diner's ranking of places they have visited, not a platform ranking."
              : "A collection assembled by one diner."}
          </Note>
          <div className="flex flex-wrap gap-2.5">
            <ShareButton
              url={`/list/${list.id}`}
              title={list.title}
              text={`${list.itemCount} halal places`}
              variant="outline"
            />
          </div>
        </PageIntro>

        {items.length === 0 ? (
          <InsufficientData>This list is empty so far.</InsufficientData>
        ) : (
          <ol className="mt-4.5 grid gap-3">
            {items.map((item, index) => (
              <li key={item.placeId}>
                <Item variant="outline" className="items-start gap-3.5 rounded-xl px-4 py-3.5">
                  {list.ranked && (
                    <ItemMedia className="min-w-7 text-xl font-bold text-muted-foreground">
                      {index + 1}
                    </ItemMedia>
                  )}
                  <ItemContent>
                    <ItemTitle>
                      <a href={`/place/${item.placeId}`} className="font-semibold hover:underline">
                        {item.name}
                      </a>
                    </ItemTitle>
                    <ItemDescription className="text-xs">
                      {item.streetAddress} · {cityName(item.citySlug)}
                    </ItemDescription>
                    {item.note && <p className="mt-1.5 text-[13px]">{item.note}</p>}
                  </ItemContent>
                </Item>
              </li>
            ))}
          </ol>
        )}

        <p className="mt-6 text-sm text-muted-foreground">
          Want your own? <TextLink href={canonical("/lists")}>Start a list</TextLink>.
        </p>
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
