import type { Metadata, Viewport } from "next";
import { DataFastAnalytics } from "../src/components/datafast-analytics";
import { SITE_NAME, SITE_URL, OG_IMAGE, TWITTER_SITE } from "../src/lib/seo";
import { CrispChat } from "../src/components/crisp-chat";
import "@halalfood/ui/globals.css";

const TITLE = "halalfood.world — a community map of places people eat";
const DESCRIPTION =
  "Places people eat, with whatever evidence they have actually shared. A listing is not a halal certification.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · " + SITE_NAME,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "halal food",
    "halal restaurants",
    "halal near me",
    "halal map",
    "muslim friendly restaurants",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: TWITTER_SITE,
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
  category: "food",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-sentry-environment={process.env.ENVIRONMENT?.trim() || undefined}
    >
      <body>
        {children}
        <DataFastAnalytics />
        <CrispChat />
      </body>
    </html>
  );
}