import type { Metadata, Viewport } from "next";
import { SITE_NAME, SITE_URL, OG_IMAGE } from "../src/lib/seo";
import "./globals.css";

const DESCRIPTION =
  "Find halal food around the world through transparent evidence, real visits and community knowledge.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "halalfood.world — discover halal food with evidence you can inspect",
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
    title: "halalfood.world — discover halal food with evidence you can inspect",
    description: DESCRIPTION,
    locale: "en_US",
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "Halalfood — a community map of halal restaurants",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "halalfood.world — discover halal food with evidence you can inspect",
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
  themeColor: "#f4f0e8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}