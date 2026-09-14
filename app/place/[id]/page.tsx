import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import {
  ExternalLink,
  MapPin,
  Navigation,
  Phone,
  Share2,
  Star,
  Utensils,
} from "lucide-react";
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

const loadPlace = cache(async (raw: string) => {
  const id = placeIdParam(raw);
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
  const url = canonical("/place/" + place.id);
  return {
    title,
    description,
    alternates: { canonical: "/place/" + place.id },
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
          <Unavailable retryPath={"/place/" + encodeURIComponent(id)} />
        </main>
        <SiteFooter />
      </div>
    );

  const { place, google, community } = loaded.data;
  const city = cityName(place.city_slug);
  const website = safeWebsite(google.website);
  const maps = safeWebsite(google.mapsUrl);
  const hasCoords = place.lat !== null && place.lng !== null;
  const cuisine = place.serves_cuisine?.filter(Boolean).slice(0, 3).join(" · ");
  const trail = [
    { name: "Halalfood", path: "/" },
    { name: city, path: "/city/" + place.city_slug },
    { name: place.name, path: "/place/" + place.id },
  ];

  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript([
              placeJsonLd(place, { mapsUrl: maps, communityNote: community.note }),
              breadcrumbJsonLd(trail),
            ]),
          }}
        />
        <Breadcrumbs trail={trail} />
        <article className="place-detail">
          <div className="place-hero">
            <div className="place-hero-visual" aria-hidden="true">
              <Utensils size={60} strokeWidth={1.1} />
              <span className="place-hero-visual-label">HALALFOOD GUIDE</span>
            </div>
            <div className="place-hero-copy">
              <div className="place-status-row">
                <span className="ui-badge ui-badge-default">Halal listed</span>
                {google.linked && <span className="place-source-label">Google listing linked</span>}
              </div>
              <p className="eyebrow">HALAL LISTING · {city.toUpperCase()}</p>
              <h1>{place.name}</h1>
              <p className="place-summary">
                {placeDescription(place, { includeCommunity: true })}
              </p>
              <div className="place-facts">
                {google.ratingValue && (
                  <span className="place-fact">
                    <Star className="star" size={15} fill="currentColor" aria-hidden="true" />
                    <strong>{google.ratingValue}</strong>
                    {google.reviewCount
                      ? " from " + formatCount(google.reviewCount) + " reviews"
                      : ""}
                  </span>
                )}
                <span className="place-fact">
                  <MapPin size={15} aria-hidden="true" />
                  {city}
                </span>
                {cuisine && <span className="place-fact">{cuisine}</span>}
              </div>
              <div className="detail-actions">
                {hasCoords && (
                  <a className="action primary" href={"/?place=" + encodeURIComponent(place.id)}>
                    <MapPin size={15} aria-hidden="true" />
                    Show on map
                  </a>
                )}
                {maps && (
                  <a className="action" href={maps} target="_blank" rel="noopener noreferrer nofollow">
                    <Navigation size={15} aria-hidden="true" />
                    Directions
                  </a>
                )}
                {google.telephone && (
                  <a className="action" href={"tel:" + google.telephone.replace(/[^+\d]/g, "")}>
                    <Phone size={15} aria-hidden="true" />
                    Call
                  </a>
                )}
                {website && (
                  <a className="action" href={website} target="_blank" rel="noopener noreferrer nofollow">
                    <ExternalLink size={15} aria-hidden="true" />
                    Website
                  </a>
                )}
                <ShareButton
                  url={"/place/" + place.id}
                  title={place.name}
                  text={place.name + " — halal food in " + city}
                  className="action share-button"
                />
                <SavePlaceButton placeId={place.id} />
              </div>
              {place.source === "user-submitted" && place.halal_confirmed !== false && (
                <p className="submission-note">
                  Community submission — a signed-in member confirmed this listing as halal.
                  Please confirm with the restaurant before visiting.
                </p>
              )}
            </div>
          </div>

          <div className="place-detail-grid">
            <div className="place-detail-main">
              <section className="community-section" aria-labelledby="community-evidence-title">
                <div className="place-section-heading">
                  <div>
                    <p className="eyebrow">COMMUNITY EVIDENCE</p>
                    <h2 id="community-evidence-title">Help the next visitor</h2>
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
                <a href={"/city/" + place.city_slug}>
                  every halal restaurant we list in {city}
                </a>
                .
              </p>
            </div>

            <aside className="place-detail-aside">
              <section className="place-section listing-facts" aria-labelledby="listing-facts-title">
                <div className="place-section-heading">
                  <div>
                    <p className="eyebrow">
                      {google.linked ? "GOOGLE / LISTING FACTS" : "LISTING FACTS"}
                    </p>
                    <h2 id="listing-facts-title">Restaurant details</h2>
                  </div>
                  {google.linked && (
                    <span className={"listing-cache-status " + google.cacheStatus}>
                      {google.cacheStatus === "cached"
                        ? "Cached"
                        : google.cacheStatus === "refreshed"
                          ? "Refreshed"
                          : google.cacheStatus === "stale-fallback"
                            ? "Saved details"
                            : "Listing only"}
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
                  {google.address && (
                    <div>
                      <dt>{google.addressSource === "google" ? "Google address" : "Address"}</dt>
                      <dd>{google.address}</dd>
                    </div>
                  )}
                  {place.postal_code && (
                    <div>
                      <dt>Postal code</dt>
                      <dd>{place.postal_code}</dd>
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
                  {cuisine && (
                    <div>
                      <dt>Cuisine</dt>
                      <dd>{cuisine}</dd>
                    </div>
                  )}
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
                      <dt>Coordinates</dt>
                      <dd>{place.lat?.toFixed(4) + ", " + place.lng?.toFixed(4)}</dd>
                    </div>
                  )}
                </dl>
              </section>
              <ApproximateNote />
            </aside>
          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}