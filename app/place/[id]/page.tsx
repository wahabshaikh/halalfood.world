import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getPlaceById } from "../../../src/lib/places";
import { placeIdParam } from "../../../src/lib/params";
import {
  breadcrumbJsonLd,
  canonical,
  cityName,
  formatAddress,
  formatCount,
  jsonLdScript,
  OG_IMAGE,
  placeDescription,
  placeJsonLd,
  placeTitle,
  plural,
} from "../../../src/lib/seo";
import {
  ApproximateNote,
  Breadcrumbs,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../../src/components/site-chrome";
import { loadOrDegrade } from "../../../src/lib/load";
import ShareButton from "../../../src/components/share-button";

/** `generateMetadata` and the page body share one round trip. */
const loadPlace = cache(async (raw: string) => {
  const id = placeIdParam(raw);
  // A malformed id is a 404, not an outage — skip the query entirely.
  if (!id) return { status: "missing" as const };
  return await loadOrDegrade(() => getPlaceById(id));
});

function safeWebsite(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const loaded = await loadPlace(id);
  if (loaded.status !== "ok")
    return {
      title: loaded.status === "missing" ? "Place not found" : "Listing unavailable",
      robots: { index: false, follow: true },
    };
  const place = loaded.data;
  const title = placeTitle(place);
  const description = placeDescription(place);
  const url = canonical(`/place/${place.id}`);
  return {
    title,
    description,
    alternates: { canonical: `/place/${place.id}` },
    openGraph: {
      type: "website",
      url,
      title,
      description,
      images: [{ url: OG_IMAGE, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PlacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loaded = await loadPlace(id);
  if (loaded.status === "missing") notFound();
  if (loaded.status === "error")
    return (
      <div className="page">
        <SiteHeader />
        <main className="page-main">
          <Unavailable retryPath={`/place/${encodeURIComponent(id)}`} />
        </main>
        <SiteFooter />
      </div>
    );
  const place = loaded.data;

  const city = cityName(place.city_slug);
  const website = safeWebsite(place.website);
  const maps = safeWebsite(place.maps_url);
  const address = formatAddress(place);
  const hasCoords = place.lat !== null && place.lng !== null;
  const trail = [
    { name: "Halalfood", path: "/" },
    { name: city, path: `/city/${place.city_slug}` },
    { name: place.name, path: `/place/${place.id}` },
  ];

  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <script
          type="application/ld+json"
          // Schema.org payload; string is JSON with `<` escaped.
          dangerouslySetInnerHTML={{
            __html: jsonLdScript([placeJsonLd(place), breadcrumbJsonLd(trail)]),
          }}
        />
        <Breadcrumbs trail={trail} />
        <article className="place-detail">
          <p className="eyebrow">HALAL · {city.toUpperCase()}</p>
          <h1>{place.name}</h1>
          <p className="lead">{placeDescription(place)}</p>

          <div className="detail-actions">
            {hasCoords && (
              <a
                className="action primary"
                href={`/?place=${encodeURIComponent(place.id)}`}
              >
                Show on the map
              </a>
            )}
            {place.telephone && (
              <a
                className="action"
                href={`tel:${place.telephone.replace(/[^+\d]/g, "")}`}
              >
                Call {place.telephone}
              </a>
            )}
            {website && (
              <a
                className="action"
                href={website}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                Website
              </a>
            )}
            {maps && (
              <a
                className="action"
                href={maps}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                Directions
              </a>
            )}
            <ShareButton
              url={`/place/${place.id}`}
              title={place.name}
              text={`${place.name} — halal food in ${city}`}
              className="action share-button"
            />
          </div>

          <h2>Details</h2>
          <dl className="detail-grid">
            {address && (
              <div>
                <dt>Address</dt>
                <dd>{address}</dd>
              </div>
            )}
            {place.postal_code && (
              <div>
                <dt>Postal code</dt>
                <dd>{place.postal_code}</dd>
              </div>
            )}
            {place.rating_value && (
              <div>
                <dt>Rating</dt>
                <dd>
                  ★ {place.rating_value}
                  {place.review_count
                    ? ` from ${formatCount(place.review_count)} ${plural(place.review_count, "review")}`
                    : ""}
                </dd>
              </div>
            )}
            {place.serves_cuisine?.length ? (
              <div>
                <dt>Cuisine</dt>
                <dd>{place.serves_cuisine.join(", ")}</dd>
              </div>
            ) : null}
            {hasCoords && (
              <div>
                <dt>Approximate coordinates</dt>
                <dd>
                  {place.lat!.toFixed(4)}, {place.lng!.toFixed(4)}
                </dd>
              </div>
            )}
          </dl>

          <ApproximateNote />

          <p className="detail-more">
            Looking for more? See{" "}
            <a href={`/city/${place.city_slug}`}>
              every halal restaurant we list in {city}
            </a>
            .
          </p>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
