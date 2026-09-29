import type { Metadata } from "next";
import { Page, PageMain, SiteFooter, SiteHeader } from "../../src/components/site-chrome";
import { HomeTabs } from "../../src/components/home-tabs";
import RecsView from "./recs-view";

export const metadata: Metadata = {
  title: "Recs",
  description: "Places and lists your friends sent you, with a quick reply.",
  alternates: { canonical: "/recs" },
  robots: { index: false, follow: true },
};

export default async function RecsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { box } = await searchParams;
  return (
    <Page>
      <SiteHeader />
      <PageMain narrow>
        <HomeTabs active="recs" />
        <h1 className="mb-4 text-[clamp(24px,3vw,30px)]">Recs</h1>
        <RecsView initialBox={box === "sent" ? "sent" : "inbox"} />
      </PageMain>
      <SiteFooter active="explore" />
    </Page>
  );
}
