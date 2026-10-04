import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Call02Icon, DrinkIcon, File01Icon, LinkSquare02Icon, MapsIcon, Navigation03Icon, SteakIcon } from "@hugeicons/core-free-icons";
import { getPlaceById } from "../../../src/lib/places";
import {
  assembleRestaurantPage,
  saveGoogleDetailsCache,
} from "../../../src/lib/restaurant-page";
import { placeIdParam } from "@halalfood/core/params";
import {
  breadcrumbJsonLd,
  canonical,
  cityName,
  formatCount,
  jsonLdScript,
  OG_IMAGE,
  TWITTER_SITE,
  placeDescription,
  placeJsonLd,
  placeShareText,
  placeTitle,
  plural,
} from "../../../src/lib/seo";
import {
  ApproximateNote,
  Breadcrumbs,
  Page,
  PageMain,
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
} from "@halalfood/core/halal-glance-view";
import { d1PlacePhotoRepository, type PlacePhoto } from "../../../src/lib/place-photos";
import ShareButton from "../../../src/components/share-button";
import { SendRecLink } from "../../../src/components/send-rec-link";
import SavePlaceButton from "../../../src/components/save-place-button";
import { PlacePhoto as PlacePhotoArt } from "../../../src/components/place-photo";
import PlaceHalalVerification from "./place-halal-verification";
import PlaceCheckIn from "./place-check-in";
import PlaceModeration from "./place-moderation";
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
import type { ObservedFact } from "@halalfood/core/observations";
import { coverageLevel } from "@halalfood/core/coverage";
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
import { PlaceRow } from "../../../src/components/place-tile";
import { Button } from "@halalfood/ui/components/button";
import { Card } from "@halalfood/ui/components/card";
import { Separator } from "@halalfood/ui/components/separator";
import { cn } from "@halalfood/ui/lib/utils";
import { TextLink } from "../../../src/components/blocks";
import { MetaItem, Note, SectionIntro } from "../../../src/components/section";
import { findPlacesNear } from "../../../src/lib/local-context-repository";
import { annotateCardEvidence } from "../../../src/lib/discovery";
import type { HalalTaxonomyStatus } from "@halalfood/core/halal-taxonomy";

const loadEvidenceStatus = cache(async (placeId: string): Promise<HalalTaxonomyStatus | null> => {
  try {
    const [row] = await annotateCardEvidence([{ id: placeId }]);
    return row?.evidence_loaded ? row.halal_status : null;
  } catch {
    return null;
  }
});

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
  certificate: <HugeiconsIcon icon={File01Icon} size={24} strokeWidth={1.6} aria-hidden="true" />,
  alcohol: <HugeiconsIcon icon={DrinkIcon} size={24} strokeWidth={1.6} aria-hidden="true" />,
  meat: <HugeiconsIcon icon={SteakIcon} size={24} strokeWidth={1.6} aria-hidden="true" />,
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
  const evidenceStatus = await loadEvidenceStatus(place.id);
  const title = placeTitle(place);
  const description = placeDescription(place, {
    includeCommunity: true,
    evidenceStatus,
  });
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
    twitter: { card: "summary_large_image", site: TWITTER_SITE, title, description },
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
      <Page>
        <SiteHeader />
        <PageMain>
          <Unavailable retryPath={"/place/" + encodeURIComponent(id)} domain="This place" />
        </PageMain>
        <SiteFooter />
      </Page>
    );

  const { place, google, community } = loaded.data;
  // Loaded without a session so the page stays publicly cacheable and fully
  // crawlable. The signed-in suitability check is layered on by
  // <PersonalSuitability>, which reads the same data from /decision.
  const [decisionBundle, { status, glance, photos }, nearby] = await Promise.all([
    loadDecision(place.id, null),
    loadCommunity(place.id),
    place.lat !== null && place.lng !== null
      ? findPlacesNear(
          { lat: place.lat, lng: place.lng },
          { limit: 8, radiusKm: 10, excludeId: place.id },
        ).catch(() => [])
      : Promise.resolve([]),
  ]);
  const city = cityName(place.city_slug);
  const evidenceStatus = await loadEvidenceStatus(place.id);
  const website = safeWebsite(google.website);
  const maps = safeWebsite(google.mapsUrl);
  const hasCoords = place.lat !== null && place.lng !== null;
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
  const galleryPhotos = photos.slice(0, 1);
  const orderable = (decisionBundle?.dishes ?? []).filter((dish) => dish.status === "accepted");
  const knownGlance = lines.filter((line) => line.known);
  const unknownGlance = lines.filter((line) => !line.known);

  return (
    <Page>
      <SiteHeader />
      <PageMain className="pb-[calc(9.5rem+env(safe-area-inset-bottom))] md:pb-16">
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
        <div className="mb-4.5 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
          <h1 className="text-[clamp(24px,3vw,30px)]">{place.name}</h1>
          <div className="flex items-center gap-1">
            <ShareButton
              url={"/place/" + place.id}
              title={place.name}
              text={placeShareText(place.name, city, evidenceStatus)}
            />
            <SendRecLink place={place.id} />
            <SavePlaceButton placeId={place.id} />
          </div>
        </div>

        <div className="relative -mx-4.5 h-40 overflow-hidden md:mx-0 md:h-52 md:rounded-2xl">
          {galleryPhotos[0] ? (
            // Community photos are served through the R2 proxy route.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={"/api/uploads/r2?key=" + encodeURIComponent(galleryPhotos[0].r2Key)}
              alt={"Community photo of " + place.name}
              className="size-full object-cover"
            />
          ) : (
            <PlacePhotoArt seed={place.id} name={place.name} className="aspect-auto! h-full rounded-none" />
          )}
          <Button
            asChild
            variant="outline"
            className="absolute! right-4 bottom-4 border-foreground font-extrabold"
          >
            <a href="#photos">
              {photos.length ? `Photos (${photos.length})` : "Add a photo"}
            </a>
          </Button>
        </div>

        <section className="mt-6 grid gap-5" aria-label="What to know first">
          <div>
            <h2 className="text-[22px]">Where</h2>
            <p className="mt-1">{google.address}</p>
            <div className="mt-2.5 flex flex-wrap gap-2.5">
              {hasCoords && (
                <Button asChild size="lg" variant="outline">
                  <a href={"/map?place=" + encodeURIComponent(place.id)}>
                    <HugeiconsIcon icon={MapsIcon} size={18} aria-hidden="true" />
                    Show on map
                  </a>
                </Button>
              )}
              {maps && (
                <Button asChild size="lg" variant="outline">
                  <a href={maps} target="_blank" rel="noopener noreferrer nofollow">
                    <HugeiconsIcon icon={Navigation03Icon} size={18} aria-hidden="true" />
                    Directions
                  </a>
                </Button>
              )}
            </div>
            <ApproximateNote compact />
          </div>
          <div>
            <h2 className="text-[22px]">What to order</h2>
            {decisionBundle ? (
              orderable.length ? (
                <ul className="mt-2 grid gap-1.5">
                  {orderable.slice(0, 3).map((dish) => (
                    <li key={dish.id} className="flex justify-between gap-3 text-sm">
                      <span className="font-semibold">{dish.name}</span>
                      <span className="text-muted-foreground">
                        {dish.halalScope === "halal"
                          ? "Listed as halal"
                          : dish.halalScope === "not-halal"
                            ? "Listed as not halal"
                            : "Halal scope unknown"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">No accepted dish is listed yet.</p>
              )
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">The dish list could not be loaded.</p>
            )}
          </div>
          <div>
            <h2 className="text-[22px]">Evidence</h2>
            {decisionBundle ? (
              <DecisionHeadline
                assessment={decisionBundle.decision.assessment}
                headline={decisionBundle.decision.headline}
                evidenceLine={decisionBundle.decision.evidenceLine}
                suitability={null}
              />
            ) : (
              <p className="mt-1">
                {approvedChecks
                  ? `Checked by the community. Latest check ${latestCheck ?? "recently"}.`
                  : "Not checked yet. Unverified does not mean not halal."}
              </p>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              Community evidence. A listing is not a halal certification.
              {google.ratingValue
                ? ` Google rating ${google.ratingValue}${
                    google.reviewCount
                      ? ` from ${formatCount(google.reviewCount)} Google ${plural(google.reviewCount, "review")}`
                      : ""
                  }.`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <SavePlaceButton placeId={place.id} />
            <SendRecLink place={place.id} />
            <Button asChild size="lg">
              <a href={checkHref}>I’ve been here, let me check</a>
            </Button>
          </div>
        </section>
        <PlaceModeration placeId={place.id} />

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-20">
          <div>
            {decisionBundle ? (
              <div className="grid gap-3">
                <PersonalSuitability placeId={place.id} />
                <ScopeNote assessment={decisionBundle.decision.assessment} />
                <CoverageBadge level={decisionBundle.coverage} />
              </div>
            ) : null}

            <section className="mt-8 scroll-mt-24" aria-labelledby="glance-title">
              <h2 id="glance-title" className="mb-1.5 text-[22px]">
                Halal at a glance
              </h2>
              <SectionIntro>
                From approved checks by people who visited. We don’t certify places.
              </SectionIntro>
              {knownGlance.length ? (
                <ul className="mt-4.5 grid grid-cols-1 gap-x-6 gap-y-4.5 sm:grid-cols-2">
                  {knownGlance.map((line) => (
                    <li key={line.question} className="flex items-center gap-3.5 text-base">
                      {GLANCE_ICONS[line.question]}
                      <span>
                        {line.label}
                        <br />
                        <small className="text-muted-foreground">{line.detail}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Certificate, alcohol, and meat are not checked yet.
                </p>
              )}
              {unknownGlance.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-bold">
                    Facts not checked yet
                  </summary>
                  <ul className="mt-3 grid gap-3">
                    {unknownGlance.map((line) => (
                      <li key={line.question} className="flex items-center gap-3.5 text-sm text-muted-foreground">
                        {GLANCE_ICONS[line.question]}
                        <span>
                          {line.label}
                          <br />
                          {line.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>

            {decisionBundle && (
              <>
                <Separator className="my-8" />
                <details className="grid gap-4">
                  <summary className="cursor-pointer text-[22px] font-extrabold">
                    How this was recorded
                  </summary>
                  <div className="mt-4 grid gap-4">
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
                    <section aria-labelledby="menu-panel-title">
                      <h2 id="menu-panel-title" className="mb-1.5 text-[22px]">
                        Dishes on file
                      </h2>
                      <SectionIntro>Added by the community.</SectionIntro>
                      <ul className="divide-y">
                        {decisionBundle.dishes.map((dish) => (
                          <li key={dish.id} className="flex justify-between gap-3 py-2">
                            <span
                              className={cn(
                                "font-semibold",
                                dish.halalScope === "not-halal" && "text-destructive",
                              )}
                            >
                              {dish.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
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
                </details>
                <Separator className="my-8" />
                <div id="visit" className="grid scroll-mt-24 gap-4">
                  <PlaceCheckIn placeId={place.id} placeName={place.name} />
                  <PlaceContribute placeId={place.id} />
                </div>
              </>
            )}

            <Separator className="my-8" />
            <PlaceVideos placeId={place.id} />

            <Separator className="my-8" />
            <div id="checks" className="scroll-mt-24">
              <PlaceHalalVerification placeId={place.id} />
            </div>

            <Separator className="my-8" />
            <div id="photos" className="scroll-mt-24">
              <PlacePhotos placeId={place.id} />
            </div>

            <Separator className="my-8" />
            <div id="reviews" className="grid scroll-mt-24 gap-8">
              <PlaceRating placeId={place.id} />
              <PlaceReviews placeId={place.id} />
            </div>

            <Separator className="my-8" />
            {nearby.length ? (
              <PlaceRow
                title={"More places listed nearby"}
                href={"/city/" + place.city_slug}
                places={nearby}
              />
            ) : (
              <p className="text-muted-foreground">
                <TextLink href={"/city/" + place.city_slug}>See places listed in {city}</TextLink>
              </p>
            )}
          </div>

          <aside>
            <Card className="gap-3.5 px-6 py-6 shadow-lg ring-border lg:sticky lg:top-28">
              <h2 className="text-[22px]">
                Planning a visit?{" "}
                <span className="text-base font-semibold text-muted-foreground">{city}</span>
              </h2>
              <dl className="grid gap-2.5 text-sm">
                <MetaItem label="Address">{google.address}</MetaItem>
                {google.telephone && <MetaItem label="Phone">{google.telephone}</MetaItem>}
                <MetaItem label="Halal checks">
                  {approvedChecks
                    ? `${formatCount(approvedChecks)} approved · latest ${latestCheck ?? "recently"}`
                    : "None yet"}
                </MetaItem>
              </dl>
              {maps ? (
                <Button asChild size="xl" className="w-full">
                  <a href={maps} target="_blank" rel="noopener noreferrer nofollow">
                    Get directions
                  </a>
                </Button>
              ) : hasCoords ? (
                <Button asChild size="xl" className="w-full">
                  <a href={"/map?place=" + encodeURIComponent(place.id)}>Show on map</a>
                </Button>
              ) : null}
              {(phoneHref || website) && (
                <div className="flex flex-wrap gap-2">
                  {phoneHref && (
                    <Button asChild variant="outline" size="lg">
                      <a href={phoneHref}>
                        <HugeiconsIcon icon={Call02Icon} size={16} aria-hidden="true" />
                        Call
                      </a>
                    </Button>
                  )}
                  {website && (
                    <Button asChild variant="outline" size="lg">
                      <a href={website} target="_blank" rel="noopener noreferrer nofollow">
                        <HugeiconsIcon icon={LinkSquare02Icon} size={16} aria-hidden="true" />
                        Website
                      </a>
                    </Button>
                  )}
                </div>
              )}
              <Button asChild size="xl" variant="secondary" className="w-full">
                <a href={checkHref}>I’ve been here, let me check</a>
              </Button>
              <Note>Checks are reviewed before they count.</Note>
            </Card>
          </aside>
        </div>
      </PageMain>
      <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 flex items-center justify-between gap-3 border-t bg-background px-4.5 py-2.5 md:hidden">
        <div className="min-w-0">
          <strong className="block truncate underline">{place.name}</strong>
          <span className="text-[13px] text-muted-foreground">
            {approvedChecks ? `${formatCount(approvedChecks)} approved ${plural(approvedChecks, "check")}` : "Not checked yet"}
          </span>
        </div>
        <Button asChild size="xl">
          {maps ? (
            <a href={maps} target="_blank" rel="noopener noreferrer nofollow">
              Directions
            </a>
          ) : (
            <a href={checkHref}>Check it</a>
          )}
        </Button>
      </div>
      <SiteFooter />
    </Page>
  );
}
