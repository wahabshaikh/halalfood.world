import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlaceById } from "../../../../src/lib/places";
import { placeIdParam } from "@halalfood/core/params";
import { loadOrDegrade } from "../../../../src/lib/load";
import { Unavailable } from "../../../../src/components/site-chrome";
import { Logo } from "../../../../src/components/brand";
import CheckFlow from "./check-flow";

export const metadata: Metadata = {
  title: "Check a place",
  robots: { index: false, follow: false },
};

export default async function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const id = placeIdParam((await params).id);
  if (!id) notFound();
  const loaded = await loadOrDegrade(() => getPlaceById(id));
  if (loaded.status === "missing") notFound();
  const placeHref = "/place/" + encodeURIComponent(id);

  return (
    <div className="stepper">
      <div className="stepper-top">
        <a href="/" aria-label="halalfood.world home" style={{ border: 0, padding: 0 }}>
          <Logo compact />
        </a>
        <a href={placeHref}>Exit</a>
      </div>
      <main>
        {loaded.status === "ok" ? (
          <CheckFlow placeId={id} placeName={loaded.data.name} />
        ) : (
          <div className="page-main">
            <Unavailable retryPath={placeHref + "/check"} />
          </div>
        )}
      </main>
    </div>
  );
}
