import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canViewVisit } from "@halalfood/core/feed";
import { uuidParam } from "@halalfood/core/params";
import { getViewerId, looksSignedIn } from "../../../src/lib/auth-session";
import { getVisitAccess, type VisitAccess } from "../../../src/lib/feed-repository";
import {
  Page,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../../../src/components/site-chrome";
import VisitView from "./visit-view";

/** A shared visit with its comments. Not indexed: it is a person's post, not a listing. */
export const metadata: Metadata = {
  title: "Visit",
  robots: { index: false, follow: true },
};

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const visitId = uuidParam((await params).id);
  if (!visitId) notFound();
  // A visit this viewer may not open is a real 404, not a page whose client
  // fetch later says "not found": an unshared visit, one to a place that is
  // no longer listed, or one hidden by a block. The visit API applies the same
  // rule, so this only decides the status code.
  const viewerId = await getViewerId();
  let access: VisitAccess | null | undefined;
  try {
    access = await getVisitAccess(visitId, viewerId);
  } catch {
    access = undefined; // The database is unavailable: let the page show its retry state.
  }
  if (access === null) notFound();
  if (access && !canViewVisit(access.audience)) {
    // A session lookup that failed reads as a guest; never 404 the owner over
    // that. The page then asks the API, which resolves the session again.
    if (viewerId || !(await looksSignedIn())) notFound();
  }
  return (
    <Page>
      <SiteHeader />
      <PageMain narrow>
        <VisitView visitId={visitId} />
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
