import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../src/components/site-chrome";
import AddPlaceForm from "./add-place-form";

export const metadata: Metadata = {
  title: "Add a place",
  description: "Add a halal place that's missing, picked from Google Maps.",
  alternates: { canonical: "/add" },
  robots: { index: false, follow: true },
};

export default function AddPage() {
  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <AddPlaceForm />
      </main>
      <SiteFooter active="add" />
    </div>
  );
}
