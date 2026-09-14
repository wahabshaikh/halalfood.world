import type { Metadata, Viewport } from "next";
import { SITE_NAME, SITE_URL, OG_IMAGE } from "../src/lib/seo";
import "./globals.css";

const DESCRIPTION =
  "Discover halal restaurants around the world, save the places you love, and help the community keep every listing useful.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Halalfood — discover halal places worth sharing",
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
    title: "Halalfood — discover halal places worth sharing",
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
    title: "Halalfood — discover halal places worth sharing",
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
  themeColor: "#f6f5ef",
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