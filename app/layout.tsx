import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Halalfood — Find halal food around you",
  description:
    "Explore halal restaurants around the world. Find your next meal on the map.",
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
