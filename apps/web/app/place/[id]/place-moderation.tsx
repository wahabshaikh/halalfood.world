"use client";

import { useEffect, useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { Card } from "@halalfood/ui/components/card";
import { Input } from "@halalfood/ui/components/input";
import { getClientSession } from "../../../src/lib/client-session";
import { FormMessage, Note } from "../../../src/components/section";

type Listing = {
  placeId: string;
  listingStatus: "listed" | "hidden";
  restorable: boolean;
  lat: number | null;
  lng: number | null;
};

/**
 * Moderator controls on a place page: unpublish (a reversible hide) and the
 * map pin. The page is a shared cached document, so the control decides
 * client-side whether to show itself: only a signed-in moderator gets a 200
 * from the listing endpoint. Everyone else sees nothing.
 */
export default function PlaceModeration({ placeId }: { placeId: string }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [reason, setReason] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const user = await getClientSession();
      if (!user) return;
      try {
        const response = await fetch(`/api/admin/places/${placeId}`, {
          signal: controller.signal,
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const body = (await response.json()) as { listing?: Listing };
        if (body.listing) {
          setListing(body.listing);
          if (body.listing.lat !== null) setLat(String(body.listing.lat));
          if (body.listing.lng !== null) setLng(String(body.listing.lng));
        }
      } catch {
        // Not a moderator, or offline: the page works without the control.
      }
    })();
    return () => controller.abort();
  }, [placeId]);

  if (!listing) return null;

  async function send(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/places/${placeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        listing?: Listing;
        loginUrl?: string;
      };
      if (response.status === 401 && body.loginUrl) {
        window.location.assign(body.loginUrl);
        return;
      }
      if (!response.ok || !body.listing) {
        setMessage({ tone: "error", text: body.error ?? "That change failed. Nothing was changed." });
        return;
      }
      setListing(body.listing);
      setMessage({ tone: "success", text: success });
    } catch {
      setMessage({ tone: "error", text: "Could not reach the server. Nothing was changed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card size="sm" className="mt-6 gap-3 px-4" aria-labelledby="place-moderation-title">
      <h2 id="place-moderation-title" className="text-base font-extrabold">
        Moderator controls
      </h2>
      {listing.listingStatus === "hidden" ? (
        <>
          <Note>
            Unpublished. This place is hidden from search, city pages and the map. Nothing was
            deleted.
          </Note>
          {listing.restorable ? (
            <Button
              className="justify-self-start"
              disabled={busy}
              onClick={() => void send({ action: "restore" }, "Restored. It is listed again.")}
            >
              Restore listing
            </Button>
          ) : (
            <Note>The listing rules hid this place. It cannot be restored here.</Note>
          )}
        </>
      ) : (
        <>
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!reason.trim()) {
                setMessage({ tone: "error", text: "Unpublishing needs a reason. It is kept on the audit log." });
                return;
              }
              void send(
                { action: "unpublish", reason: reason.trim() },
                "Unpublished. It is hidden from search, city pages and the map. Restore it here or in the moderation console.",
              );
            }}
          >
            <Input
              aria-label="Reason for unpublishing (required)"
              placeholder="Reason for unpublishing (required)"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button type="submit" variant="outline" className="justify-self-start" disabled={busy}>
              Unpublish
            </Button>
          </form>
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send({ action: "pin", lat, lng }, "Pin saved. The place is on the map.");
            }}
          >
            <p className="text-sm font-bold">
              Map pin {listing.lat === null ? "(missing, so this place is not on the map)" : ""}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Input
                aria-label="Latitude"
                inputMode="decimal"
                placeholder="Latitude"
                value={lat}
                onChange={(event) => setLat(event.target.value)}
              />
              <Input
                aria-label="Longitude"
                inputMode="decimal"
                placeholder="Longitude"
                value={lng}
                onChange={(event) => setLng(event.target.value)}
              />
            </div>
            <Button type="submit" variant="outline" className="justify-self-start" disabled={busy}>
              Save pin
            </Button>
          </form>
        </>
      )}
      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
    </Card>
  );
}
