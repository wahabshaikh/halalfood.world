import type { Metadata } from "next";
import { placeIdParam } from "@halalfood/core/params";
import { getPlaceById } from "../../src/lib/places";
import { loadOrDegrade } from "../../src/lib/load";
import {
  PageIntro,
  Page,
  PageMain,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../src/components/site-chrome";
import PlaceCheckIn from "../place/[id]/place-check-in";
import PlacePicker from "./place-picker";

export const metadata: Metadata = {
  title: "Log a visit",
  description: "Log a halal place you ate at and share it with your friends.",
  alternates: { canonical: "/log" },
  robots: { index: false, follow: true },
};

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.place;
  const placeId = placeIdParam(typeof raw === "string" ? raw : null);
  const loaded = placeId ? await loadOrDegrade(() => getPlaceById(placeId)) : null;
  const place = loaded?.status === "ok" ? loaded.data : null;

  return (
    <Page>
      <SiteHeader />
      <PageMain narrow>
        {place && placeId ? (
          <>
            <PageIntro
              eyebrow="LOG A VISIT"
              title={place.name}
              lead={
                <>
                  Not the right place? <a className="underline" href="/log">Pick another</a>.
                </>
              }
            />
            <PlaceCheckIn placeId={placeId} placeName={place.name} defaultOpen />
          </>
        ) : loaded?.status === "error" ? (
          <Unavailable retryPath={`/log?place=${placeId}`} />
        ) : (
          <>
            <PageIntro
              eyebrow="LOG A VISIT"
              title="Where did you eat?"
              lead="Pick the place, say how it was and share it with the people who follow you."
            />
            <PlacePicker />
            <p className="mt-6 text-sm text-muted-foreground">
              Can&rsquo;t find it? <a className="underline" href="/add">Add a missing place</a>.
            </p>
          </>
        )}
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
