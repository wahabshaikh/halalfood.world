import type { Metadata } from "next";
import { AppShell } from "../../src/components/app-shell";
import { getViewerId } from "../../src/lib/auth-session";
import { AddFlow } from "./add-flow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Add a place",
  description: "Find a place on Google Maps and add it to halalfood.world in a few taps.",
  alternates: { canonical: "/add" },
  robots: { index: false, follow: true },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function text(value: string | string[] | undefined, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export default async function AddPage({ searchParams }: Props) {
  const params = await searchParams;
  const viewerId = await getViewerId();
  const googleId = text(params.g, 300);
  const picked = googleId ? { id: googleId, name: text(params.n, 200) ?? "This place", address: text(params.a, 400) ?? "" } : null;
  return (
    <AppShell active="add">
      <AddFlow signedIn={Boolean(viewerId)} initial={picked} />
    </AppShell>
  );
}
