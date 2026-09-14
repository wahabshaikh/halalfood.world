import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../src/components/site-chrome";
import AddPlaceForm from "./add-place-form";

export const metadata: Metadata = {
  title: "Add a place",
  description: "Submit a halal place missing from the halalfood.world directory.",
  alternates: { canonical: "/add" },
  robots: { index: false, follow: true },
};

export default function AddPage() {
  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main auth-main">
        <AddPlaceForm />
      </main>
      <SiteFooter />
    </div>
  );
}
