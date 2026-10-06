import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { placeIdParam } from "@/lib/core/params";
import { AppShell } from "@/components/hf/app-shell";
import { getViewerId } from "@/lib/auth-session";
import { getPlaceById } from "@/lib/places";
import { getProfile } from "@/lib/profiles";
import { loginHref } from "@/lib/signed-out";
import { CheckForm } from "./check-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Check a place", robots: { index: false } };

export default async function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const id = placeIdParam((await params).id);
  if (!id) notFound();
  const place = await getPlaceById(id);
  if (!place) notFound();
  const viewerId = await getViewerId();
  if (!viewerId) redirect(loginHref(`/place/${id}/check`));
  const profile = await getProfile(viewerId).catch(() => null);
  return (
    <AppShell hideNav footer={false}>
      <CheckForm placeId={place.id} placeName={place.name} isPrivate={profile?.isPrivate ?? false} />
    </AppShell>
  );
}
