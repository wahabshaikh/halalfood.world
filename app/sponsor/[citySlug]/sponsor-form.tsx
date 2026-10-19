"use client";

import { useState } from "react";
import { buttonClass } from "@/components/hf/kit";
import { api, errorText, toast } from "@/components/hf/kit-client";
import { TextField } from "@/components/hf/people-client";
import { SponsorCard } from "@/components/hf/sponsor-card";
import { MAX_LINK_URL, MAX_SPONSOR_NAME, MAX_TAGLINE, sponsorLink } from "@/lib/core/sponsorship";

/** Write the card, see it as it will look, then go to Whop to pay. */
export function SponsorForm({ citySlug, cityLabel, price }: { citySlug: string; cityLabel: string; price: number }) {
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const linkUrl = sponsorLink(link);
  const ready = name.trim().length > 0 && linkUrl !== null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      const result = await api<{ checkoutUrl: string }>("/api/sponsorships", {
        method: "POST",
        json: { citySlug, name, tagline, linkUrl: link },
      });
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      toast(errorText(error));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <TextField label="Name on the card" value={name} onChange={setName} maxLength={MAX_SPONSOR_NAME} placeholder="Your business" />
      <TextField label="One line (optional)" value={tagline} onChange={setTagline} maxLength={MAX_TAGLINE} placeholder="What you do, in a sentence" />
      <TextField label="Link" value={link} onChange={setLink} maxLength={MAX_LINK_URL} placeholder="https://yourbusiness.com" />
      <div className="grid gap-1.5">
        <span className="text-sm font-extrabold">Preview</span>
        <SponsorCard
          preview
          cityLabel={cityLabel}
          sponsor={{ id: "preview", citySlug, name: name.trim() || "Your business", tagline: tagline.trim() || null, linkUrl: linkUrl ?? "https://example.com" }}
        />
      </div>
      <button type="submit" disabled={!ready || busy} className={buttonClass("primary", "lg")}>
        {busy ? "Opening checkout…" : `Continue to payment · $${price}/month`}
      </button>
      <p className="text-sm font-semibold text-muted-foreground">
        Payment and receipts are handled by Whop. Your card goes live as soon as the payment clears, and renews every 30 days until you cancel in Whop.
      </p>
    </form>
  );
}
