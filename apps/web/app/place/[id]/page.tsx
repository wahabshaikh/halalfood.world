import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight01Icon, Call02Icon, Globe02Icon, Navigation03Icon } from "@hugeicons/core-free-icons";
import { FACTS } from "@halalfood/core/halal";
import { placeIdParam } from "@halalfood/core/params";
import { AppShell } from "../../../src/components/app-shell";
import { AddToListButton } from "../../../src/components/list-sheets";
import { AvatarStack, FactTile, Icon, LinkButton, PlaceArt, SectionTitle, StatusCard, StatusPill, buttonClass } from "../../../src/components/kit";
import { getViewerId } from "../../../src/lib/auth-session";
import { listPlaceNotes, topDishes } from "../../../src/lib/checks-repository";
import { decoratePlaces } from "../../../src/lib/explore";
import { creatorPath, d1MediaLinkRepository } from "../../../src/lib/media-links";
import { d1PlacePhotoRepository } from "../../../src/lib/place-photos";
import { cityName, photoUrl } from "../../../src/lib/place-view";
import { getPlaceById, nearbyPlaces } from "../../../src/lib/places";
import { breadcrumbJsonLd, jsonLdScript, placeDescription, placeJsonLd, placeShareText, placeTitle } from "../../../src/lib/seo";
import { AddPhoto, HeroActions, HowItWorks, Notes, ReportPlace } from "./place-client";

export const dynamic = "force-dynamic";

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
      ? nearbyPlaces({ lat: place.lat, lng: place.lng }, { excludeId: place.id, limit: 2 }).catch(() => [])
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
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10 lg:px-6 lg:pt-6">
        <div>
          <div className="relative h-[250px] overflow-hidden bg-secondary lg:rounded-[20px]">
            {hero ? (
              // Place photos are served from our own R2 proxy route.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={hero} alt={`Photo of ${place.name}`} className="size-full object-cover" />
            ) : (
              <PlaceArt name={place.name} seed={place.id} className="size-full" rounded="rounded-none" textSize="text-5xl" />
            )}
            <HeroActions
              placeId={place.id}
              name={place.name}
              shareText={placeShareText(place.name, place.address_locality ?? city, status)}
              saved={card.saved}
              signedIn={signedIn}
              backHref={`/city/${place.city_slug}`}
            />
            {photos.length > 1 && (
              <a href="#photos" className="absolute right-4 bottom-3.5 rounded-full bg-foreground/80 px-3 py-1.5 text-[13px] font-extrabold text-background">
                1 / {photos.length} photos
              </a>
            )}
          </div>

          <div className="grid gap-[26px] px-5 pt-[22px] lg:px-0">
            <div className="grid gap-1.5">
              <h1 className="text-[28px] leading-tight font-black tracking-tight">{place.name}</h1>
              <p className="text-[15px] font-semibold text-muted-foreground">{where}</p>
            </div>

            <StatusCard status={status} latest={shortDate(place.last_checked_at)} how={<HowItWorks />} />

            <section aria-labelledby="facts" className="grid gap-3">
              <SectionTitle id="facts">Halal facts</SectionTitle>
              <div className="grid grid-cols-2 gap-2.5">
                {FACTS.map((fact) => (
                  <FactTile key={fact} fact={fact} value={place.card.facts[fact]} />
                ))}
              </div>
            </section>

            {actions.length > 0 && (
              <div className="grid gap-2" style={{ gridTemplateColumns: actions.length === 3 ? "1.4fr 1fr 1fr" : `repeat(${actions.length}, minmax(0, 1fr))` }}>
                {actions.map((action) => (
                  <a
                    key={action.label}
                    href={action.href}
                    {...(action.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
                    className={buttonClass(action.primary ? "primary" : "outline", "md", "min-h-[50px] rounded-[14px]")}
                  >
                    <Icon icon={action.icon} size={18} />
                    {action.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-[26px] px-5 pt-[26px] pb-10 lg:px-0 lg:pt-0">
          {card.friend?.checkId && (
            <a href={`/visit/${card.friend.checkId}`} className="flex items-center gap-3 rounded-2xl border border-border p-3.5 text-foreground">
              <AvatarStack people={card.friend.people.map((person) => ({ name: person.name, seed: person.userId }))} />
              <span className="grid flex-1 gap-0.5">
                <strong className="text-[15px] font-black">{card.friend.line}</strong>
                {card.friend.note && <span className="line-clamp-1 text-[13px] font-semibold text-muted-foreground">“{card.friend.note}”</span>}
              </span>
              <Icon icon={ArrowRight01Icon} size={18} />
            </a>
          )}

          <section className="grid gap-3 rounded-[20px] bg-muted p-[18px]">
            <div className="grid gap-1">
              <h2 className="text-[19px] font-black">Eaten here?</h2>
              <p className="text-sm font-semibold text-subtle-foreground">{ctaLine}</p>
            </div>
            <LinkButton href={`/place/${place.id}/check`} variant="dark" className="min-h-[50px]">
              Check this place
            </LinkButton>
          </section>

          {dishes.length > 0 && (
            <section aria-labelledby="dishes" className="grid gap-2.5">
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

          <section id="photos" aria-labelledby="photos-title" className="grid scroll-mt-24 gap-3">
            <SectionTitle id="photos-title" action={<AddPhoto placeId={place.id} signedIn={signedIn} />}>
              Photos
            </SectionTitle>
            {photos.length ? (
              <div className="grid grid-cols-3 gap-2">
                {photos.slice(0, 6).map((photo) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={photo.id} src={photoUrl(photo.r2Key) ?? ""} alt="" loading="lazy" className="aspect-square w-full rounded-[14px] object-cover" />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No photos yet.</p>
            )}
          </section>

          {videos.length > 0 && (
            <section aria-labelledby="videos" className="grid gap-3">
              <SectionTitle id="videos">Videos</SectionTitle>
              <div className="flex gap-2.5 overflow-x-auto [scrollbar-width:none]">
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
            <section aria-labelledby="notes" className="grid gap-1">
              <SectionTitle id="notes">What people said</SectionTitle>
              <Notes placeId={place.id} initial={notes.slice(0, 2)} hasMore={notes.length > 2} />
            </section>
          )}

          {nearby.length > 0 && (
            <section aria-labelledby="nearby" className="grid gap-3">
              <SectionTitle id="nearby">Nearby</SectionTitle>
              <div className="grid grid-cols-2 gap-2.5">
                {nearby.map((other) => (
                  <a key={other.id} href={`/place/${other.id}`} className="grid gap-1.5 text-foreground">
                    <PlaceArt name={other.name} seed={other.id} src={photoUrl(other.photoKey)} className="h-24 w-full" rounded="rounded-[14px]" />
                    <strong className="truncate text-[15px] font-extrabold">{other.name}</strong>
                    <StatusPill status={other.status} short className="w-fit" />
                  </a>
                ))}
              </div>
            </section>
          )}

          <div className="grid gap-1">
            {signedIn && (
              <AddToListButton
                placeId={place.id}
                placeName={place.name}
                className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-extrabold text-subtle-foreground"
              />
            )}
            <ReportPlace placeId={place.id} placeName={place.name} signedIn={signedIn} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
