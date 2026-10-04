import type { Metadata } from "next";
import {
  Page,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../../src/components/site-chrome";
import { ADD_OG_IMAGE, TWITTER_SITE, canonical } from "../../src/lib/seo";
import { getVisitorLocation } from "../../src/lib/visitor-location";
import AddPlaceForm from "./add-place-form";

const TITLE = "Help us map every halal spot";
const DESCRIPTION =
  "Search for a place and send it for review. It stays off the map until someone moderates it. A submission is not a halal certification.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/add" },
  robots: { index: false, follow: true },
  openGraph: {
    type: "website",
    url: canonical("/add"),
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: ADD_OG_IMAGE, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    site: TWITTER_SITE,
    title: TITLE,
    description: DESCRIPTION,
    images: [ADD_OG_IMAGE],
  },
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
    <Page>
      <SiteHeader />
      <PageMain>
        <AddPlaceForm initialQuery={initialQuery} area={location?.city ?? null} />
      </PageMain>
      <SiteFooter active="add" />
    </Page>
  );
}
