import type { Metadata } from "next";
import {
  Breadcrumbs,
  Page,
  PageIntro,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../../src/components/site-chrome";
import PasteView from "./paste-view";

export const metadata: Metadata = {
  title: "Save from a reel",
  description: "Paste an Instagram, TikTok or YouTube link and save the place to your want-to-try list.",
  alternates: { canonical: "/paste" },
  robots: { index: false, follow: true },
};

export default function PastePage() {
  return (
    <Page>
      <SiteHeader />
      <PageMain>
        <Breadcrumbs
          trail={[
            { name: "Halalfood", path: "/" },
            { name: "Save from a reel", path: "/paste" },
          ]}
        />
        <PageIntro
          eyebrow="SAVE FROM A REEL"
          title="Found a place in a video?"
          lead="Paste an Instagram, TikTok or YouTube link. We look for the place in the caption, you confirm it, and it goes on your want-to-try list with the creator credited."
        />
        <PasteView />
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
