"use client";

import { useState } from "react";
import { buttonClass } from "@/components/hf/kit";
import { api, errorText, toast } from "@/components/hf/kit-client";
import { TextField } from "@/components/hf/people-client";

/** Role, contact email, then Whop. Checkout is refused by the API when the plan id is unset. */
export function ClaimForm({ placeId, price, offered }: { placeId: string; price: number; offered: boolean }) {
  const [role, setRole] = useState<"owner" | "manager">("owner");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!offered || busy) return;
    setBusy(true);
    try {
      const result = await api<{ checkoutUrl: string }>("/api/owner-claims", {
        method: "POST",
        json: { placeId, role, contactEmail: email },
      });
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      toast(errorText(error));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <fieldset className="grid gap-2">
        <legend className="text-sm font-extrabold">Your role</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["owner", "I own it"],
              ["manager", "I manage it"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-2 rounded-2xl border border-border px-3 text-sm font-bold">
              <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <TextField label="Contact email" value={email} onChange={setEmail} maxLength={120} placeholder="you@restaurant.com" />
      <p className="text-sm font-semibold text-muted-foreground">
        Moderators use this to check the claim. It is not shown on the place page. ${price} a month, billed by Whop.
      </p>
      {offered ? (
        <button type="submit" disabled={busy || !email.trim()} className={buttonClass("primary", "lg")}>
          {busy ? "Opening checkout…" : `Continue to checkout · $${price}/month`}
        </button>
      ) : (
        <button type="button" disabled className={buttonClass("primary", "lg")}>
          Not available yet
        </button>
      )}
    </form>
  );
}
