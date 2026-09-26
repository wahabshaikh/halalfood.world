import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../src/components/site-chrome";
import { getVisitorLocation } from "../../src/lib/visitor-location";
import AddPlaceForm from "./add-place-form";

export const metadata: Metadata = {
  title: "Add a place",
  description: "Add a halal place that's missing, picked from Google Maps.",
  alternates: { canonical: "/add" },
  robots: { index: false, follow: true },
};

export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).q;
  const initialQuery = typeof raw === "string" ? raw.trim().slice(0, 120) : "";
  const location = await getVisitorLocation();
  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <AddPlaceForm initialQuery={initialQuery} area={location?.city ?? null} />
      </main>
      <SiteFooter active="add" />
    </div>
  );
}
