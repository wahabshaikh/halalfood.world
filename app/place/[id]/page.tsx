import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getPlaceById } from "../../../src/lib/places";
import {
  assembleRestaurantPage,
  saveGoogleDetailsCache,
} from "../../../src/lib/restaurant-page";
import { placeIdParam } from "../../../src/lib/params";
import {
  breadcrumbJsonLd,
  canonical,
  cityName,
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
import SavePlaceButton from "../../../src/components/save-place-button";
import PlaceHalalVerification from "./place-halal-verification";
import PlaceRating from "./place-rating";
import PlaceReviews from "./place-reviews";
import PlacePhotos from "./place-photos";

/** `generateMetadata` and the page body share one round trip. */
const loadPlace = cache(async (raw: string) => {
  const id = placeIdParam(raw);
  // A malformed id is a 404, not an outage — skip the query entirely.
  if (!id) return { status: "missing" as const };
  return await loadOrDegrade(async () => {
    const place = await getPlaceById(id);
    return place
      ? assembleRestaurantPage(place, { saveGoogleDetails: saveGoogleDetailsCache })
      : null;
  });
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
  const place = loaded.data.place;
  const title = placeTitle(place);
  const description = placeDescription(place, { includeCommunity: true });
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
  const { place, google, community } = loaded.data;

  const city = cityName(place.city_slug);
  const website = safeWebsite(google.website);
  const maps = safeWebsite(google.mapsUrl);
  const address = google.address;
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
            __html: jsonLdScript([
              placeJsonLd(place, {
                mapsUrl: maps,
                communityNote: community.note,
              }),
              breadcrumbJsonLd(trail),
            ]),
          }}
        />
        <Breadcrumbs trail={trail} />
        <article className="place-detail">
          <p className="eyebrow">HALAL · {city.toUpperCase()}</p>
          <h1>{place.name}</h1>
          <p className="lead">{placeDescription(place, { includeCommunity: true })}</p>
          {place.source === "user-submitted" && place.halal_confirmed !== false && (
            <p className="submission-note">
              Community submission — a signed-in user confirmed this place is halal.
              Please verify with the restaurant before visiting.
            </p>
          )}

          <div className="detail-actions">
            {hasCoords && (
              <a
                className="action primary"
                href={`/?place=${encodeURIComponent(place.id)}`}
              >
                Show on the map
              </a>
            )}
            {google.telephone && (
              <a
                className="action"
                href={`tel:${google.telephone.replace(/[^+\d]/g, "")}`}
              >
                Call {google.telephone}
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
            <SavePlaceButton placeId={place.id} />
          </div>

          <section className="place-section listing-facts" aria-labelledby="listing-facts-title">
            <div className="place-section-heading">
              <div>
                <p className="eyebrow">
                  {google.linked ? "GOOGLE / LISTING FACTS" : "LISTING FACTS"}
                </p>
                <h2 id="listing-facts-title">Restaurant details</h2>
              </div>
              {google.linked && (
                <span className={`listing-cache-status ${google.cacheStatus}`}>
                  {google.cacheStatus === "cached" ? "Cached" :
                    google.cacheStatus === "refreshed" ? "Refreshed" :
                      google.cacheStatus === "stale-fallback" ? "Saved details" :
                        "Listing only"}
                </span>
              )}
            </div>
            <p className="section-intro">{google.note}</p>
            <dl className="detail-grid">
              {google.displayNameSource === "google" && (
                <div>
                  <dt>Google listing name</dt>
                  <dd>{google.displayName}</dd>
                </div>
              )}
              {address && (
                <div>
                  <dt>{google.addressSource === "google" ? "Google address" : "Address"}</dt>
                  <dd>{address}</dd>
                </div>
              )}
              {place.postal_code && (
                <div>
                  <dt>Postal code</dt>
                  <dd>{place.postal_code}</dd>
                </div>
              )}
              {google.ratingValue && (
                <div>
                  <dt>Listing rating</dt>
                  <dd>
                    ★ {google.ratingValue}
                    {google.reviewCount
                      ? ` from ${formatCount(google.reviewCount)} ${plural(google.reviewCount, "review")}`
                      : ""}
                  </dd>
                </div>
              )}
              {google.telephone && (
                <div>
                  <dt>Phone</dt>
                  <dd>{google.telephone}</dd>
                </div>
              )}
              {website && (
                <div>
                  <dt>Website</dt>
                  <dd>
                    <a href={website} target="_blank" rel="noopener noreferrer nofollow">
                      Visit restaurant website
                    </a>
                  </dd>
                </div>
              )}
              {place.serves_cuisine?.length ? (
                <div>
                  <dt>Cuisine</dt>
                  <dd>{place.serves_cuisine.join(", ")}</dd>
                </div>
              ) : null}
              {maps && (
                <div>
                  <dt>Map listing</dt>
                  <dd>
                    <a href={maps} target="_blank" rel="noopener noreferrer nofollow">
                      Open in Google Maps
                    </a>
                  </dd>
                </div>
              )}
              {hasCoords && (
                <div>
                  <dt>Approximate coordinates</dt>
                  <dd>
                    {place.lat!.toFixed(4)}, {place.lng!.toFixed(4)}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <ApproximateNote />

          <section className="community-section" aria-labelledby="community-evidence-title">
            <div className="place-section-heading">
              <div>
                <p className="eyebrow">COMMUNITY EVIDENCE</p>
                <h2 id="community-evidence-title">What the community adds</h2>
              </div>
            </div>
            <p className="section-intro">{community.note}</p>
            <div className="community-layers">
              <PlacePhotos placeId={place.id} />
              <PlaceRating placeId={place.id} />
              <PlaceReviews placeId={place.id} />
              <PlaceHalalVerification placeId={place.id} />
            </div>
          </section>

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
