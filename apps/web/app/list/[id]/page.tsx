import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Breadcrumbs,
  Page,
  PageMain,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../../src/components/site-chrome";
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
        <div className="page-intro">
          <p className="eyebrow">
            {list.ranked ? "A PERSONAL RANKING" : "A COLLECTION"}
          </p>
          <h1>{list.title}</h1>
          {list.description && <p className="lead">{list.description}</p>}
          <p className="approximate-note compact">
            {list.ranked
              ? "This is one diner's ranking of places they have visited, not a platform ranking."
              : "A collection assembled by one diner."}
          </p>
          <div className="detail-actions">
            <ShareButton
              url={`/list/${list.id}`}
              title={list.title}
              text={`${list.itemCount} halal places`}
              variant="outline"
            />
          </div>
        </div>

        {items.length === 0 ? (
          <p className="insufficient-data">This list is empty so far.</p>
        ) : (
          <ol className={`curated-list${list.ranked ? " is-ranked" : ""}`}>
            {items.map((item, index) => (
              <li key={item.placeId}>
                {list.ranked && <span className="curated-rank">{index + 1}</span>}
                <div className="curated-body">
                  <a href={`/place/${item.placeId}`}>{item.name}</a>
                  <span className="curated-meta">
                    {item.streetAddress} · {cityName(item.citySlug)}
                  </span>
                  {item.note && <p className="curated-note">{item.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}

        <p className="detail-more">
          Want your own? <a href={canonical("/lists")}>Start a list</a>.
        </p>
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
