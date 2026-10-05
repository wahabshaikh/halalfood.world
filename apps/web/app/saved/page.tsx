import type { Metadata } from "next";
import { FavouriteIcon } from "@hugeicons/core-free-icons";
import { AppShell } from "../../src/components/app-shell";
import { EmptyState, LinkButton, PageTitle } from "../../src/components/kit";
import { PlaceRow } from "../../src/components/place-row";
import { getViewerId } from "../../src/lib/auth-session";
import { decoratePlaces } from "../../src/lib/explore";
import { d1SavedPlaceRepository } from "../../src/lib/saved-places";
import { loginHref } from "../../src/lib/signed-out";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Saved",
  robots: { index: false },
};

export default async function SavedPage() {
  const viewerId = await getViewerId();
  if (!viewerId) {
    return (
      <AppShell active="saved">
        <div className="grid gap-4 px-5 pt-6">
          <PageTitle>Saved</PageTitle>
          <EmptyState
            icon={FavouriteIcon}
            title="Keep places for later"
            body="Sign in to save places and find them here."
            action={
              <LinkButton href={loginHref("/saved")} className="mt-2 w-fit px-6">
                Sign in
              </LinkButton>
            }
          />
        </div>
      </AppShell>
    );
  }

  const saved = await d1SavedPlaceRepository().list(viewerId);
  const places = await decoratePlaces(viewerId, saved.places);
  return (
    <AppShell active="saved">
      <div className="grid gap-3 px-5 pt-6 pb-10">
        <PageTitle sub={saved.total ? `${saved.total} ${saved.total === 1 ? "place" : "places"}` : undefined}>Saved</PageTitle>
        {places.length ? (
          <ul>
            {places.map((place) => (
              <PlaceRow key={place.id} place={place} signedIn />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={FavouriteIcon}
            title="Nothing saved yet"
            body="Tap the heart on any place to keep it here."
            action={
              <LinkButton href="/" variant="outline" className="mt-2 w-fit px-6">
                Explore places
              </LinkButton>
            }
          />
        )}
      </div>
    </AppShell>
  );
}
