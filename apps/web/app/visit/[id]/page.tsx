import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { uuidParam } from "@halalfood/core/params";
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
