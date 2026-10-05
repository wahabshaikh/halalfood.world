import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExploreScreen, resolveCity, type ExploreSearchParams } from "../../../src/components/explore-screen";
import { citySlugParam } from "@halalfood/core/params";
import { cityDescription, cityTitle } from "../../../src/lib/seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ citySlug: string }>; searchParams: Promise<ExploreSearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = citySlugParam((await params).citySlug);
  if (!slug) return {};
  const { city } = await resolveCity(slug).catch(() => ({ city: null }));
  if (!city) return { title: "City not found", robots: { index: false } };
  return {
    title: cityTitle(city.city_slug, city.place_count),
    description: cityDescription(city.city_slug, city.place_count),
    alternates: { canonical: `/city/${city.city_slug}` },
  };
}

export default async function CityPage({ params, searchParams }: Props) {
  const slug = citySlugParam((await params).citySlug);
  if (!slug) notFound();
  const { city } = await resolveCity(slug);
  if (!city) notFound();
  return <ExploreScreen city={city} searchParams={await searchParams} />;
}
