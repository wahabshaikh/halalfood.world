import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlaceById } from "../../../../src/lib/places";
import { placeIdParam } from "@halalfood/core/params";
import { loadOrDegrade } from "../../../../src/lib/load";
import { Button } from "@halalfood/ui/components/button";
import { PageMain, Unavailable } from "../../../../src/components/site-chrome";
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
    <div className="flex min-h-screen flex-col">
      <div className="flex items-center justify-between gap-2.5 px-4.5 py-4.5 md:px-6">
        <a href="/" aria-label="halalfood.world home">
          <Logo compact />
        </a>
        <Button asChild variant="outline" className="rounded-full px-4 font-bold">
          <a href={placeHref}>Exit</a>
        </Button>
      </div>
      <main className="flex flex-1 flex-col">
        {loaded.status === "ok" ? (
          <CheckFlow placeId={id} placeName={loaded.data.name} />
        ) : (
          <PageMain>
            <Unavailable retryPath={placeHref + "/check"} />
          </PageMain>
        )}
      </main>
    </div>
  );
}
