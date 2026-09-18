import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import {
  ExternalLink,
  MapPin,
  Navigation,
  Phone,
  Star,
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
import PlaceHalalStatus from "./place-halal-status";
import PlaceHalalVerification from "./place-halal-verification";
import PlaceCheckIn from "./place-check-in";
import PlaceContribute from "./place-contribute";
import {
  DecisionHeadline,
  DishHighlightPanel,
  FactChips,
  ReturnIntentPanel,
  ScopeNote,
} from "../../../src/components/decision-summary";
import EvidencePanel from "../../../src/components/evidence-panel";
import {
  getDecisionSummary,
  listStatusHistory,
} from "../../../src/lib/place-decision";
import { getPreferences } from "../../../src/lib/preferences-repository";
import PersonalSuitability from "./personal-suitability";
import { d1HalalVerificationRepository } from "../../../src/lib/halal-verifications";
import { listDishes } from "../../../src/lib/dishes-repository";
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

function placeInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
  return initials || "HF";
}

/**
 * The decision bundle is loaded separately from the listing so a failure here
 * degrades one section rather than 404-ing a page that does exist. Everything
 * is server-rendered: the status, its evidence and the dish verdicts have to be
 * readable by a crawler and by a visitor with JavaScript switched off.
 */
async function loadDecision(placeId: string, userId: string | null) {
  try {
    const preferences = userId ? await getPreferences(userId) : null;
    const [decision, history, verifications, dishes] = await Promise.all([
      getDecisionSummary(placeId, preferences),
      listStatusHistory(placeId),
      d1HalalVerificationRepository().list(placeId, userId),
      listDishes(placeId),
    ]);
    return { decision, history, verifications, dishes };
  } catch {
    return null;
  }
}

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
  // Loaded without a session so the page stays publicly cacheable and fully
  // crawlable. The signed-in suitability check is layered on by
  // <PersonalSuitability>, which reads the same data from /decision.
  const decisionBundle = await loadDecision(place.id, null);
  const city = cityName(place.city_slug);
  const website = safeWebsite(google.website);
  const maps = safeWebsite(google.mapsUrl);
  const hasCoords = place.lat !== null && place.lng !== null;
  const cuisine = place.serves_cuisine?.filter(Boolean).slice(0, 3).join(" · ");
  const trail = [
    { name: "halalfood.world", path: "/" },
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
              <span className="place-hero-mark">{placeInitials(place.name)}</span>
              <span className="place-hero-label">Halal place<br />{city}</span>
            </div>
            <div className="place-hero-copy">
              <div className="place-status-row">
                <PlaceHalalStatus placeId={place.id} compact />
                {google.linked && <span className="place-source-label">Source linked: Google Places</span>}
              </div>
              <p className="eyebrow">HALAL PLACE · {city.toUpperCase()}</p>
              <h1>{place.name}</h1>
              <p className="place-summary">
                {placeDescription(place, { includeCommunity: true })}
              </p>
              <div className="place-facts">
                {google.ratingValue && (
                  <span className="place-fact">
                    <Star className="star" size={15} fill="currentColor" aria-hidden="true" />
                    <strong>{google.ratingValue}</strong>
                    {" Google rating"}
                    {google.reviewCount
                      ? " · " + formatCount(google.reviewCount) + " reviews"
                      : ""}
                  </span>
                )}
                <span className="place-fact">
                  <MapPin size={15} aria-hidden="true" />
                  {city}
                </span>
                <span className="place-fact place-fact-evidence">
                  Halal evidence shown below
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
            </div>
          </div>

          {decisionBundle && (
            <>
              <DecisionHeadline
                assessment={decisionBundle.decision.assessment}
                headline={decisionBundle.decision.headline}
                evidenceLine={decisionBundle.decision.evidenceLine}
                suitability={null}
              />
              <PersonalSuitability placeId={place.id} />
              <ScopeNote assessment={decisionBundle.decision.assessment} />
            </>
          )}

          <div className="place-detail-grid">
            <div className="place-detail-main">
              {decisionBundle && (
                <>
                  <EvidencePanel
                    assessment={decisionBundle.decision.assessment}
                    verifications={decisionBundle.verifications}
                    history={decisionBundle.history}
                  />
                  <FactChips facts={decisionBundle.decision.facts} />
                  <ReturnIntentPanel checkIns={decisionBundle.decision.checkIns} />
                  <DishHighlightPanel dishes={decisionBundle.decision.dishes} />
                  {decisionBundle.dishes.length > 0 && (
                    <section className="menu-panel" aria-labelledby="menu-panel-title">
                      <div className="place-section-heading">
                        <div>
                          <p className="eyebrow">MENU CONTRIBUTED BY THE COMMUNITY</p>
                          <h2 id="menu-panel-title">Dishes on file</h2>
                        </div>
                      </div>
                      <ul className="menu-list">
                        {decisionBundle.dishes.map((dish) => (
                          <li key={dish.id} className={`menu-item is-${dish.halalScope}`}>
                            <span className="menu-item-name">{dish.name}</span>
                            <span className="menu-item-meta">
                              {dish.halalScope === "unknown"
                                ? "Halal scope unknown"
                                : dish.halalScope === "halal"
                                  ? "Halal"
                                  : "Not halal"}
                              {dish.status === "pending" ? " · awaiting review" : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <PlaceCheckIn placeId={place.id} placeName={place.name} />
                  <PlaceContribute placeId={place.id} />
                </>
              )}
              <section className="community-section" aria-labelledby="community-evidence-title">
                <div className="place-section-heading">
                  <div>
                    <p className="eyebrow">DECISION EVIDENCE</p>
                    <h2 id="community-evidence-title">What to know before you go</h2>
                  </div>
                </div>
                <p className="section-intro">{community.note}</p>
                <ol className="trust-ladder" aria-label="How to read this place evidence">
                  <li>
                    <strong>Halal status</strong>
                    <span>Read the status and the source checks before relying on the claim.</span>
                  </li>
                  <li>
                    <strong>Visit notes and photos</strong>
                    <span>Use dated community observations for practical, on-the-ground context.</span>
                  </li>
                  <li>
                    <strong>Visit signals</strong>
                    <span>Personal impressions are directional, not certification or a score.</span>
                  </li>
                </ol>
                <div className="community-layers">
                  <PlaceHalalVerification placeId={place.id} />
                  <PlacePhotos placeId={place.id} />
                  <PlaceReviews placeId={place.id} />
                  <PlaceRating placeId={place.id} />
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
                      {google.linked ? "SOURCE / LISTING FACTS" : "LISTING FACTS"}
                    </p>
                    <h2 id="listing-facts-title">Practical details</h2>
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
                      <dt>{google.addressSource === "google" ? "Google address" : "Listed address"}</dt>
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
                      <dt>Directions</dt>
                      <dd>
                        <a href={maps} target="_blank" rel="noopener noreferrer nofollow">
                          Open directions
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
