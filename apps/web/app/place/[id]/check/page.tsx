import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { placeIdParam } from "@halalfood/core/params";
import { AppShell } from "../../../../src/components/app-shell";
import { getViewerId } from "../../../../src/lib/auth-session";
import { getPlaceById } from "../../../../src/lib/places";
import { getProfile } from "../../../../src/lib/profiles";
import { loginHref } from "../../../../src/lib/signed-out";
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
