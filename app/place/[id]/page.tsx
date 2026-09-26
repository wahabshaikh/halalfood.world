import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import {
  BadgeCheck,
  Beef,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Map as MapIcon,
  MapPin,
  Navigation,
  Phone,
  Star,
  Wine,
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
import {
  d1HalalStatusRepository,
  getHalalStatus,
  type HalalStatus,
} from "../../../src/lib/halal-status";
import {
  getHalalCheckGlance,
  type HalalCheckGlance,
} from "../../../src/lib/halal-verifications";
import {
  formatCheckDate,
  glanceLines,
  type GlanceQuestion,
} from "../../../src/lib/halal-glance-view";
import { d1PlacePhotoRepository, type PlacePhoto } from "../../../src/lib/place-photos";
import ShareButton from "../../../src/components/share-button";
import SavePlaceButton from "../../../src/components/save-place-button";
import { PlacePhoto as PlacePhotoArt } from "../../../src/components/place-photo";
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
import {
  getObservedFacts,
  listInspections,
} from "../../../src/lib/observations-repository";
import type { ObservedFact } from "../../../src/lib/observations";
import { coverageLevel } from "../../../src/lib/coverage";
import { refreshCoverageLevel } from "../../../src/lib/coverage-repository";
import {
  CoverageBadge,
  InspectionPanel,
  ProvenancePanel,
  ServicePanel,
} from "../../../src/components/provenance-panels";
import PlaceRating from "./place-rating";
import PlaceReviews from "./place-reviews";
import PlacePhotos from "./place-photos";
import PlaceVideos from "./place-videos";

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

const EMPTY_GLANCE: HalalCheckGlance = { certificate: null, alcohol: null, meat: null };

async function loadCommunity(placeId: string) {
  const [status, glance, photos] = await Promise.all([
    getHalalStatus(d1HalalStatusRepository(), placeId).catch(
      (): HalalStatus => ({ status: "unavailable" }),
    ),
    getHalalCheckGlance(placeId).catch(() => EMPTY_GLANCE),
    d1PlacePhotoRepository()
      .list(placeId, null)
      .catch((): PlacePhoto[] => []),
  ]);
  return { status, glance, photos };
}

/**
 * The decision bundle is loaded separately from the listing so a failure here
 * degrades one section rather than 404-ing a page that does exist. Everything
 * is server-rendered: the status, its evidence and the dish verdicts have to be
 * readable by a crawler and by a visitor with JavaScript switched off.
 */
async function loadDecision(placeId: string, userId: string | null) {
  // Each piece is settled on its own. One `Promise.all` here would mean a
  // single missing table — say `place_observations` before migration 0010 has
  // been applied — silently removing the halal status, the evidence panel and
  // the check-in along with it. The status is the point of the page, so it
  // fails alone or not at all, and every degraded piece is logged rather than
  // disappearing quietly behind a 200.
  const now = Date.now();
  const preferences = userId
    ? await getPreferences(userId).catch(() => null)
    : null;

  const decision = await getDecisionSummary(placeId, preferences).catch(
    (error: unknown) => {
      console.error("place.decision-summary failed", placeId, error);
      return null;
    },
  );
  // Without the decision summary there is no page to degrade into.
  if (!decision) return null;

  const settle = async <T,>(
    label: string,
    read: () => Promise<T>,
    fallback: T,
  ): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      console.error(`place.${label} failed`, placeId, error);
      return fallback;
    }
  };

  const [history, verifications, dishes, observed, inspections] =
    await Promise.all([
      settle("status-history", () => listStatusHistory(placeId), []),
      settle(
        "verifications",
        () => d1HalalVerificationRepository().list(placeId, userId),
        [],
      ),
      settle("dishes", () => listDishes(placeId), []),
      settle(
        "observations",
        () => getObservedFacts(placeId, now),
        new Map<string, ObservedFact>(),
      ),
      settle("inspections", () => listInspections(placeId), []),
    ]);

  // Coverage is derived from what is actually attached, so the badge can
  // never promise more than the page can show.
  const coverage = coverageLevel({
    evidenceCount: decision.assessment.currentEvidenceCount,
    observationCount: observed.size,
    dishCount: dishes.length,
    checkInCount:
      decision.checkIns.verified.count + decision.checkIns.unverified.count,
    verifiedCheckInCount: decision.checkIns.verified.count,
    distinctContributors: decision.assessment.contributorCount,
    hasInspection: inspections.length > 0,
  });

  // The stored column is a projection used by the city aggregates; the page
  // derives the level live and writes it back so the two cannot drift apart
  // and show a visitor two different answers. Same pattern as the Google
  // details cache above it.
  await refreshCoverageLevel(placeId, coverage).catch(() => {});

  return {
    decision,
    history,
    verifications,
    dishes,
    facts: [...observed.values()],
    inspections,
    coverage,
    now,
  };
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

const GLANCE_ICONS: Record<GlanceQuestion, React.ReactNode> = {
  certificate: <FileText size={24} strokeWidth={1.6} aria-hidden="true" />,
  alcohol: <Wine size={24} strokeWidth={1.6} aria-hidden="true" />,
  meat: <Beef size={24} strokeWidth={1.6} aria-hidden="true" />,
};

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
  const [decisionBundle, { status, glance, photos }] = await Promise.all([
    loadDecision(place.id, null),
    loadCommunity(place.id),
  ]);
  const city = cityName(place.city_slug);
  const website = safeWebsite(google.website);
  const maps = safeWebsite(google.mapsUrl);
  const hasCoords = place.lat !== null && place.lng !== null;
  const cuisine = place.serves_cuisine?.filter(Boolean).slice(0, 2).join(" · ");
  const approvedChecks = status.status === "evidence-backed" ? status.approvedCount : 0;
  const latestCheck =
    status.status === "evidence-backed" ? formatCheckDate(status.latestReviewedAt) : null;
  const lines = glanceLines(glance);
  const checkHref = "/place/" + encodeURIComponent(place.id) + "/check";
  const phoneHref = google.telephone ? "tel:" + google.telephone.replace(/[^+\d]/g, "") : null;
  const trail = [
    { name: "halalfood.world", path: "/" },
    { name: city, path: "/city/" + place.city_slug },
    { name: place.name, path: "/place/" + place.id },
  ];
  const galleryPhotos = photos.slice(0, 5);

  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main place-page">
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
        <div className="place-title-row">
          <h1>{place.name}</h1>
          <div className="place-title-actions">
            <ShareButton
              url={"/place/" + place.id}
              title={place.name}
              text={place.name + " — halal food in " + city}
            />
            <SavePlaceButton placeId={place.id} />
          </div>
        </div>

        <div className="gallery">
          {galleryPhotos.length ? (
            galleryPhotos.map((photo, index) => (
              // Community photos are served through the R2 proxy route.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={photo.id}
                src={"/api/uploads/r2?key=" + encodeURIComponent(photo.r2Key)}
                alt={index === 0 ? "Community photo of " + place.name : ""}
                loading={index === 0 ? "eager" : "lazy"}
              />
            ))
          ) : (
            <PlacePhotoArt seed={place.id} name={place.name} />
          )}
          {galleryPhotos.length < 5 &&
            Array.from({ length: galleryPhotos.length ? 5 - galleryPhotos.length : 4 }, (_, index) => (
              <PlacePhotoArt key={"art-" + index} seed={place.id + index} name={place.name} />
            ))}
          <a className="gallery-more" href="#photos">
            {photos.length ? `Show all ${photos.length} ${plural(photos.length, "photo")}` : "Add a photo"}
          </a>
        </div>

        <div className="place-layout">
          <div className="place-main">
            <div className="place-subtitle">
              <h2>
                {cuisine ? cuisine + " in " + city : "Halal food in " + city}
              </h2>
              <p>{google.address}</p>
            </div>

            {decisionBundle ? (
              <div className="place-decision">
                <DecisionHeadline
                  assessment={decisionBundle.decision.assessment}
                  headline={decisionBundle.decision.headline}
                  evidenceLine={decisionBundle.decision.evidenceLine}
                  suitability={null}
                />
                <PersonalSuitability placeId={place.id} />
                <ScopeNote assessment={decisionBundle.decision.assessment} />
                <CoverageBadge level={decisionBundle.coverage} />
              </div>
            ) : (
              <div className="fav-strip">
                <div className="fav-strip-badge">
                  <BadgeCheck size={26} aria-hidden="true" />
                  <span>{approvedChecks ? "Checked by the community" : "Not checked yet"}</span>
                </div>
                <p className="fav-strip-text">
                  {approvedChecks
                    ? `Latest check ${latestCheck ?? "recently"}.`
                    : "Be the first to share what you saw here."}
                </p>
              </div>
            )}

            <hr className="rule" />
            <div className="feature-list">
              <div className="feature">
                <ClipboardCheck size={26} strokeWidth={1.6} aria-hidden="true" />
                <div>
                  <h3>
                    {approvedChecks
                      ? `${formatCount(approvedChecks)} approved ${plural(approvedChecks, "check")}`
                      : "No halal checks yet"}
                  </h3>
                  <p>
                    {approvedChecks
                      ? `Reviewed by our moderators. Latest ${latestCheck ?? "recently"}.`
                      : "Unchecked doesn’t mean not halal. It means nobody has shared what they saw yet."}
                  </p>
                </div>
              </div>
              <div className="feature">
                <MapPin size={26} strokeWidth={1.6} aria-hidden="true" />
                <div>
                  <h3>{google.linked ? "Details from Google" : "Listed details"}</h3>
                  <p>{google.note}</p>
                </div>
              </div>
              {google.ratingValue && (
                <div className="feature">
                  <Star size={26} strokeWidth={1.6} aria-hidden="true" />
                  <div>
                    <h3>Rated {google.ratingValue} on Google</h3>
                    <p>
                      {google.reviewCount
                        ? `From ${formatCount(google.reviewCount)} Google ${plural(google.reviewCount, "review")}.`
                        : "Google’s public rating for this place."}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <hr className="rule" />
            <section className="place-section" aria-labelledby="glance-title">
              <h2 id="glance-title">Halal at a glance</h2>
              <p className="section-intro">
                From approved checks by people who visited. We don’t certify places.
              </p>
              <ul className="glance-grid">
                {lines.map((line) => (
                  <li key={line.question} className={line.known ? undefined : "is-unknown"}>
                    {GLANCE_ICONS[line.question]}
                    <span>
                      {line.label}
                      <br />
                      <small className="muted">{line.detail}</small>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="button-row" style={{ marginTop: 22 }}>
                <a className="btn btn-dark" href={checkHref}>
                  I’ve been here, let me check
                </a>
                <a className="btn btn-soft" href="#checks">
                  How we know
                </a>
              </div>
            </section>

            {decisionBundle && (
              <>
                <hr className="rule" />
                <div className="place-section stack">
                  <EvidencePanel
                    assessment={decisionBundle.decision.assessment}
                    verifications={decisionBundle.verifications}
                    history={decisionBundle.history}
                  />
                  <FactChips facts={decisionBundle.decision.facts} />
                  <ReturnIntentPanel checkIns={decisionBundle.decision.checkIns} />
                  <ServicePanel checkIns={decisionBundle.decision.checkIns} />
                  <InspectionPanel inspections={decisionBundle.inspections} />
                  <ProvenancePanel facts={decisionBundle.facts} now={decisionBundle.now} />
                  <DishHighlightPanel dishes={decisionBundle.decision.dishes} />
                  {decisionBundle.dishes.length > 0 && (
                    <section className="menu-panel" aria-labelledby="menu-panel-title">
                      <h2 id="menu-panel-title">Dishes on file</h2>
                      <p className="section-intro">Added by the community.</p>
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
                </div>
                <hr className="rule" />
                <div id="visit" className="place-section stack">
                  <PlaceCheckIn placeId={place.id} placeName={place.name} />
                  <PlaceContribute placeId={place.id} />
                </div>
              </>
            )}

            <hr className="rule" />
            <PlaceVideos placeId={place.id} />

            <hr className="rule" />
            <section className="place-section" aria-labelledby="where-title">
              <h2 id="where-title">Where you’ll be</h2>
              <p className="section-intro">{google.address}</p>
              <div className="button-row">
                {hasCoords && (
                  <a className="btn btn-outline" href={"/map?place=" + encodeURIComponent(place.id)}>
                    <MapIcon size={18} aria-hidden="true" />
                    Show on map
                  </a>
                )}
                {maps && (
                  <a className="btn btn-outline" href={maps} target="_blank" rel="noopener noreferrer nofollow">
                    <Navigation size={18} aria-hidden="true" />
                    Directions
                  </a>
                )}
              </div>
              <div style={{ marginTop: 14 }}>
                <ApproximateNote compact />
              </div>
            </section>

            <hr className="rule" />
            <div id="checks" className="place-section">
              <PlaceHalalVerification placeId={place.id} />
            </div>

            <hr className="rule" />
            <div id="photos" className="place-section">
              <PlacePhotos placeId={place.id} />
            </div>

            <hr className="rule" />
            <div id="reviews" className="place-section stack">
              <PlaceRating placeId={place.id} />
              <PlaceReviews placeId={place.id} />
            </div>

            <hr className="rule" />
            <p className="muted">
              Looking for more?{" "}
              <a className="link-underline" href={"/city/" + place.city_slug}>
                See every halal place we list in {city}
              </a>
            </p>
          </div>

          <aside>
            <div className="booking-card">
              <h2>
                Planning a visit? <span>{city}</span>
              </h2>
              <dl className="booking-card-rows">
                <div>
                  <dt>Address</dt>
                  <dd>{google.address}</dd>
                </div>
                {google.telephone && (
                  <div>
                    <dt>Phone</dt>
                    <dd>{google.telephone}</dd>
                  </div>
                )}
                <div>
                  <dt>Halal checks</dt>
                  <dd>
                    {approvedChecks
                      ? `${formatCount(approvedChecks)} approved · latest ${latestCheck ?? "recently"}`
                      : "None yet"}
                  </dd>
                </div>
              </dl>
              {maps ? (
                <a className="btn btn-primary btn-block" href={maps} target="_blank" rel="noopener noreferrer nofollow">
                  Get directions
                </a>
              ) : hasCoords ? (
                <a className="btn btn-primary btn-block" href={"/map?place=" + encodeURIComponent(place.id)}>
                  Show on map
                </a>
              ) : null}
              <div className="booking-card-links">
                {phoneHref && (
                  <a className="btn btn-line btn-sm" href={phoneHref}>
                    <Phone size={16} aria-hidden="true" />
                    Call
                  </a>
                )}
                {website && (
                  <a className="btn btn-line btn-sm" href={website} target="_blank" rel="noopener noreferrer nofollow">
                    <ExternalLink size={16} aria-hidden="true" />
                    Website
                  </a>
                )}
              </div>
              <a className="btn btn-dark btn-block" href={checkHref}>
                I’ve been here, let me check
              </a>
              <p className="booking-card-note">Checks are reviewed before they count.</p>
            </div>
          </aside>
        </div>
      </main>
      <div className="sticky-bar">
        <div>
          <strong>{place.name}</strong>
          <span>{approvedChecks ? `${formatCount(approvedChecks)} halal ${plural(approvedChecks, "check")}` : "Not checked yet"}</span>
        </div>
        {maps ? (
          <a className="btn btn-primary" href={maps} target="_blank" rel="noopener noreferrer nofollow">
            Directions
          </a>
        ) : (
          <a className="btn btn-primary" href={checkHref}>
            Check it
          </a>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
