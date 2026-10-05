import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { normalizeHandle } from "@halalfood/core/people";
import { AppShell } from "../../../src/components/app-shell";
import { Avatar, FormCard, PlaceArt, StatusPill, buttonClass } from "../../../src/components/kit";
import { database } from "../../../src/db";
import { visibleCheck } from "../../../src/lib/feed";
import { PLACE_CARD_COLUMNS, photoUrl, toPlaceCard } from "../../../src/lib/place-view";
import { avatarUrl, getProfileByHandle } from "../../../src/lib/profiles";
import { loginHref } from "../../../src/lib/signed-out";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }> };

async function load(raw: string) {
  const handle = normalizeHandle(decodeURIComponent(raw));
  const profile = handle ? await getProfileByHandle(handle) : null;
  return profile && !profile.suspended ? profile : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await load((await params).handle).catch(() => null);
  if (!profile) return { title: "Not found", robots: { index: false } };
  return {
    title: `${profile.displayName} invited you`,
    description: `${profile.displayName} invited you to halalfood.world: halal places checked by people who eat there.`,
    robots: { index: false },
  };
}

export default async function InvitePage({ params }: Props) {
  const profile = await load((await params).handle);
  if (!profile) notFound();
  const db = await database();
  // check-visibility: gated — signed-out view of the inviter's loved places (visibleCheck).
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${PLACE_CARD_COLUMNS}
    FROM checks c LEFT JOIN profiles pr ON pr.user_id = c.user_id JOIN places p ON p.id = c.place_id JOIN place_status s ON s.place_id = p.id
    WHERE c.user_id = ${profile.userId} AND c.verdict = 'loved' AND p.listing_status = 'listed' AND ${visibleCheck(null)}
    GROUP BY p.id
    ORDER BY MAX(c.created_at) DESC
    LIMIT 2
  `);
  const places = rows.map(toPlaceCard);
  const first = profile.displayName.split(" ")[0];
  return (
    <AppShell hideNav>
      <FormCard fill className="items-center text-center max-md:pt-12">
        <Avatar name={profile.displayName} seed={profile.userId} src={avatarUrl(profile.avatarKey, profile.handle)} size={88} />
        <h1 className="mt-5 text-[28px] leading-tight font-black tracking-tight">{profile.displayName} invited you to halalfood.world</h1>
        <p className="mt-2 text-[15px] font-semibold text-subtle-foreground">Halal places, checked by people who eat there. See where {first} eats.</p>
        {places.length > 0 && (
          <div className="mt-8 grid w-full grid-cols-2 gap-3 text-left">
            {places.map((place) => (
              <a key={place.id} href={`/place/${place.id}`} className="grid gap-1.5 text-foreground">
                <PlaceArt name={place.name} seed={place.id} src={photoUrl(place.photoKey)} className="h-28 w-full" rounded="rounded-[14px]" />
                <strong className="truncate text-[15px] font-extrabold">{place.name}</strong>
                <StatusPill status={place.status} short className="w-fit" />
              </a>
            ))}
          </div>
        )}
        <div className="mt-auto grid w-full gap-2.5 pt-10">
          <a href={`${loginHref("/", "join")}&invite=${encodeURIComponent(profile.handle)}`} className={buttonClass("primary", "lg")}>
            Join and follow {first}
          </a>
          <a href="/" className={buttonClass("ghost", "lg")}>
            Just look around
          </a>
        </div>
      </FormCard>
    </AppShell>
  );
}
