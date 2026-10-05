import type { Metadata } from "next";
import { citySlugParam } from "@halalfood/core/params";
import { AppShell } from "../../src/components/app-shell";
import { getViewerId } from "../../src/lib/auth-session";
import { SearchScreen } from "./search-screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search",
  description: "Search places, dishes, people, lists and cities on halalfood.world.",
  alternates: { canonical: "/search" },
};

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const city = citySlugParam(typeof params.city === "string" ? params.city : null);
  const tab = params.tab === "people" ? "people" : null;
  const viewerId = await getViewerId();
  return (
    <AppShell active="explore">
      <SearchScreen initialQuery={q} city={city} signedIn={Boolean(viewerId)} focusPeople={tab === "people"} />
    </AppShell>
  );
}
