import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight01Icon, Call02Icon, Globe02Icon, Navigation03Icon } from "@hugeicons/core-free-icons";
import { FACTS, type ListingClaim } from "@/lib/core/halal";
import { placeIdParam } from "@/lib/core/params";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/hf/app-shell";
import { AddToListButton } from "@/components/hf/list-sheets";
import { AvatarStack, FactTile, Icon, LinkButton, Page, PlaceArt, SectionTitle, StatusCard, StatusPill, buttonClass } from "@/components/hf/kit";
import { getViewerId } from "@/lib/auth-session";
import { listPlaceNotes, topDishes } from "@/lib/checks-repository";
import { decoratePlaces } from "@/lib/explore";
import { creatorPath, d1MediaLinkRepository } from "@/lib/media-links";
import { d1PlacePhotoRepository } from "@/lib/place-photos";
import { cityName, photoUrl } from "@/lib/place-view";
import { getPlaceById, nearbyPlaces } from "@/lib/places";
import { breadcrumbJsonLd, jsonLdScript, placeDescription, placeJsonLd, placeShareText, placeTitle } from "@/lib/seo";
import { AddEvidence, AddPhoto, HeroActions, HowItWorks, Notes, ReportPlace } from "./place-client";

export const dynamic = "force-dynamic";

/** Map listings are context, never a verdict. */
const LISTING_NOTE: Record<ListingClaim, string> = {
  only: "Map listings say everything here is halal.",
  yes: "Map listings say it has halal options.",
  no: "Map listings say it isn’t halal.",
};

type Props = { params: Promise<{ id: string }> };

async function load(rawId: string) {
  const id = placeIdParam(rawId);
  return id ? getPlaceById(id) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const place = await load((await params).id).catch(() => null);
  if (!place) return { title: "Place not found", robots: { index: false } };
  return {
    title: placeTitle(place),
    description: placeDescription(place, place.card.status, place.card.facts),
    alternates: { canonical: `/place/${place.id}` },
  };
}

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function shortDate(at: number | null): string | null {
  return at ? new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;
}

export default async function PlacePage({ params }: Props) {
  const place = await load((await params).id);
  if (!place) notFound();
  const viewerId = await getViewerId();
  const status = place.card.status;
  const [[card], dishes, photos, videos, notes, nearby] = await Promise.all([
    decoratePlaces(viewerId, [place.card]),
    topDishes(place.id).catch(() => []),
    d1PlacePhotoRepository().list(place.id, viewerId).catch(() => []),
    d1MediaLinkRepository().list(place.id).catch(() => []),
    listPlaceNotes(place.id, viewerId, { limit: 3 }).catch(() => []),
    place.lat !== null && place.lng !== null
      ? nearbyPlaces({ lat: place.lat, lng: place.lng }, { excludeId: place.id, limit: 4 }).catch(() => [])
      : Promise.resolve([]),
  ]);
  const city = cityName(place.city_slug);
  const where = [place.card.cuisine, place.street_address].filter(Boolean).join(" · ");
  const directions = safeUrl(place.maps_url);
  const website = safeUrl(place.website);
  const phone = place.telephone ? `tel:${place.telephone.replace(/[^+\d]/g, "")}` : null;
  const ctaLine =
    status.kind === "verified"
      ? "Answer 4 quick questions. If things have changed, your check helps keep this right."
      : status.kind === "checking"
        ? status.progress === 2
          ? "Answer 4 quick questions. Yours could be the one that verifies it."
          : "Answer 4 quick questions. Two more matching checks verify it."
        : "Be the first. It takes about 20 seconds.";
  const hero = photos[0] ? photoUrl(photos[0].r2Key) : null;
  const signedIn = Boolean(viewerId);
  const actions = [
    directions && { href: directions, label: "Directions", icon: Navigation03Icon, primary: true },
    phone && { href: phone, label: "Call", icon: Call02Icon, primary: false },
    website && { href: website, label: "Website", icon: Globe02Icon, primary: false },
  ].filter(Boolean) as { href: string; label: string; icon: typeof Call02Icon; primary: boolean }[];

  const thumbs = photos.slice(1, 3).map((photo) => photoUrl(photo.r2Key));
  const primaryAction = actions.find((action) => action.primary);

  return (
    <AppShell active="explore">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript([
            placeJsonLd({ ...place, serves_cuisine: place.serves_cuisine }, { mapsUrl: directions, status, facts: place.card.facts }),
            breadcrumbJsonLd([
              { name: "halalfood.world", path: "/" },
              { name: city, path: `/city/${place.city_slug}` },
              { name: place.name, path: `/place/${place.id}` },
            ]),
          ]),
        }}
      />
      <Page className="md:pt-6">
        <nav aria-label="Breadcrumb" className="mb-4 hidden items-center gap-1.5 text-sm font-bold text-muted-foreground md:flex">
          <a href="/" className="hover:text-foreground">
            Explore
          </a>
          <Icon icon={ArrowRight01Icon} size={14} />
          <a href={`/city/${place.city_slug}`} className="hover:text-foreground">
            {city}
          </a>
          <Icon icon={ArrowRight01Icon} size={14} />
          <span aria-current="page" className="truncate text-foreground">
            {place.name}
          </span>
        </nav>

        <div className="relative -mx-5 -mt-4 md:mx-0 md:mt-0">
          <div className={cn("grid gap-2 md:overflow-hidden md:rounded-[20px]", thumbs.length > 0 && "md:grid-cols-[2fr_1fr]")}>
            <div className={cn("relative h-[250px] overflow-hidden bg-secondary", thumbs.length > 0 ? "md:h-[400px]" : "md:h-[320px]")}>
              {hero ? (
                // Place photos are served from our own R2 proxy route.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hero} alt={`Photo of ${place.name}`} className="size-full object-cover" />
              ) : (
                <PlaceArt name={place.name} seed={place.id} className="size-full" rounded="rounded-none" textSize="text-5xl" />
              )}
            </div>
            {thumbs.length > 0 && (
              <div className={cn("hidden gap-2 md:grid md:h-[400px]", thumbs.length > 1 ? "grid-rows-2" : "grid-rows-1")}>
                {thumbs.map((src, index) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={index} src={src ?? ""} alt="" loading="lazy" className="size-full min-h-0 object-cover" />
                ))}
              </div>
            )}
          </div>
          <HeroActions
            placeId={place.id}
            name={place.name}
            shareText={placeShareText(place.name, place.address_locality ?? city, status)}
            saved={card.saved}
            signedIn={signedIn}
            backHref={`/city/${place.city_slug}`}
          />
          {photos.length > 1 && (
            <a
              href="#photos"
              className="absolute right-4 bottom-3.5 rounded-full bg-foreground/80 px-3 py-1.5 text-[13px] font-extrabold text-background md:bg-background md:text-foreground md:shadow-md"
            >
              <span className="md:hidden">1 / {photos.length} photos</span>
              <span className="hidden md:inline">Show all {photos.length} photos</span>
            </a>
          )}
        </div>

        {/* Phones stack this in the order of the `order-*` classes; from lg it is a main column and a sticky sidebar. */}
        <div className="flex flex-col gap-6 pt-5 md:pt-7 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-x-12 lg:gap-y-0">
          <div className="contents lg:grid lg:gap-9">
            <div className="grid gap-1.5 max-lg:order-1">
              <h1 className="text-[28px] leading-tight font-black tracking-tight md:text-[38px]">{place.name}</h1>
              <p className="text-[15px] font-semibold text-muted-foreground md:text-base">{where}</p>
            </div>

            <section aria-labelledby="facts" className="grid gap-3 max-lg:order-3">
              <SectionTitle id="facts">Halal facts</SectionTitle>
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3 lg:grid-cols-2">
                {FACTS.map((fact) => (
                  <FactTile key={fact} fact={fact} value={place.card.facts[fact]} evidence={place.evidence[fact]} />
                ))}
              </div>
              {place.listing_claim && (
                <p className="text-[13px] leading-relaxed font-semibold text-muted-foreground">{LISTING_NOTE[place.listing_claim]}</p>
              )}
              <AddEvidence placeId={place.id} signedIn={signedIn} />
            </section>

            {dishes.length > 0 && (
              <section aria-labelledby="dishes" className="grid gap-2.5 max-lg:order-7">
                <SectionTitle id="dishes">What people order</SectionTitle>
                <div className="flex flex-wrap gap-2">
                  {dishes.map((dish) => (
                    <span key={dish.name} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-secondary px-3.5 text-sm font-extrabold">
                      {dish.name} <span className="font-bold text-muted-foreground">· {dish.count}</span>
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section id="photos" aria-labelledby="photos-title" className="grid scroll-mt-24 gap-3 max-lg:order-8">
              <SectionTitle id="photos-title" action={<AddPhoto placeId={place.id} signedIn={signedIn} />}>
                Photos
              </SectionTitle>
              {photos.length ? (
                <div className="grid grid-cols-3 gap-2 md:grid-cols-4 md:gap-3">
                  {photos.slice(0, 8).map((photo) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={photo.id} src={photoUrl(photo.r2Key) ?? ""} alt="" loading="lazy" className="aspect-square w-full rounded-[14px] object-cover" />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No photos yet.</p>
              )}
            </section>

            {videos.length > 0 && (
              <section aria-labelledby="videos" className="grid gap-3 max-lg:order-9">
                <SectionTitle id="videos">Videos</SectionTitle>
                <div className="flex gap-2.5 overflow-x-auto [scrollbar-width:none] md:gap-3">
                  {videos.map((video) => (
                    <a
                      key={video.id}
                      href={video.authorHandle ? creatorPath(video.platform, video.authorHandle) : video.url}
                      className="grid w-[132px] shrink-0 gap-1.5 text-foreground"
                    >
                      <span className="relative flex h-[180px] items-center justify-center overflow-hidden rounded-[14px] bg-foreground/85 text-background">
                        {video.thumbnailUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={video.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover opacity-80" />
                        )}
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="relative">
                          <path d="M8 5.5v13l11-6.5z" />
                        </svg>
                      </span>
                      <span className="truncate text-[13px] font-extrabold">{video.authorHandle ? `@${video.authorHandle}` : "Video"}</span>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {notes.length > 0 && (
              <section aria-labelledby="notes" className="grid gap-1 max-lg:order-10">
                <SectionTitle id="notes">What people said</SectionTitle>
                <Notes placeId={place.id} initial={notes.slice(0, 2)} hasMore={notes.length > 2} />
              </section>
            )}

            {nearby.length > 0 && (
              <section aria-labelledby="nearby" className="grid gap-3 max-lg:order-11">
                <SectionTitle id="nearby">Nearby</SectionTitle>
                <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
                  {nearby.map((other) => (
                    <a key={other.id} href={`/place/${other.id}`} className="grid gap-1.5 text-foreground">
                      <PlaceArt name={other.name} seed={other.id} src={photoUrl(other.photoKey)} className="h-24 w-full md:h-28" rounded="rounded-[14px]" />
                      <strong className="truncate text-[15px] font-extrabold">{other.name}</strong>
                      <StatusPill status={other.status} short className="w-fit" />
                    </a>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside aria-label="Check this place" className="contents lg:sticky lg:top-24 lg:grid lg:gap-5">
            <StatusCard
              status={status}
              latest={shortDate(place.last_checked_at)}
              people={place.eligible_checks}
              how={<HowItWorks />}
              className="max-lg:order-2"
            />

            <section className="grid gap-3 rounded-[20px] bg-muted p-[18px] max-lg:order-6 lg:p-5">
              <div className="grid gap-1">
                <h2 className="text-[19px] font-black">Eaten here?</h2>
                <p className="text-sm font-semibold text-subtle-foreground">{ctaLine}</p>
              </div>
              <LinkButton href={`/place/${place.id}/check`} variant="dark" className="min-h-[50px]">
                Check this place
              </LinkButton>
            </section>

            {actions.length > 0 && (
              <div className={cn("grid gap-2 max-lg:order-4", actions.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
                {actions.map((action) => (
                  <a
                    key={action.label}
                    href={action.href}
                    {...(action.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
                    className={buttonClass(action.primary ? "primary" : "outline", "md", cn("min-h-[50px] rounded-[14px]", action === primaryAction && actions.length === 3 && "col-span-2"))}
                  >
                    <Icon icon={action.icon} size={18} />
                    {action.label}
                  </a>
                ))}
              </div>
            )}

            {card.friend?.checkId && (
              <a href={`/visit/${card.friend.checkId}`} className="flex items-center gap-3 rounded-2xl border border-border p-3.5 text-foreground max-lg:order-5">
                <AvatarStack people={card.friend.people.map((person) => ({ name: person.name, seed: person.userId }))} />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <strong className="text-[15px] font-black">{card.friend.line}</strong>
                  {card.friend.note && <span className="line-clamp-1 text-[13px] font-semibold text-muted-foreground">“{card.friend.note}”</span>}
                </span>
                <Icon icon={ArrowRight01Icon} size={18} />
              </a>
            )}

            <div className="grid gap-1 max-lg:order-12">
              {signedIn && (
                <AddToListButton
                  placeId={place.id}
                  placeName={place.name}
                  className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-extrabold text-subtle-foreground"
                />
              )}
              <ReportPlace placeId={place.id} placeName={place.name} signedIn={signedIn} />
            </div>
          </aside>
        </div>
      </Page>
    </AppShell>
  );
}
