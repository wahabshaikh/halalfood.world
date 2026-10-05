import type { Metadata } from "next";
import { AppShell } from "../src/components/app-shell";
import { EmptyState, LinkButton } from "../src/components/kit";
import { ExploreScreen, resolveCity, type ExploreSearchParams } from "../src/components/explore-screen";
import { SITE_NAME } from "../src/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME} — halal places, checked by people who ate there` },
  description:
    "Find places to eat and see if they’re Muslim-owned, halal certified, and free of pork and alcohol, checked by three people who ate there.",
  alternates: { canonical: "/" },
};

export default async function Home({ searchParams }: { searchParams: Promise<ExploreSearchParams> }) {
  const params = await searchParams;
  const { city } = await resolveCity(null).catch(() => ({ city: null }));
  if (!city)
    return (
      <AppShell active="explore">
        <EmptyState
          title="No places are listed yet"
          body="If it’s on Google Maps, you can add it."
          action={<LinkButton href="/add">Add a place</LinkButton>}
        />
      </AppShell>
    );
  return <ExploreScreen city={city} searchParams={params} />;
}
