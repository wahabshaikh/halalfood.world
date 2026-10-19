"use client";

import { useState } from "react";
import { buttonClass } from "@/components/hf/kit";
import { api, errorText, toast } from "@/components/hf/kit-client";

/** Send the signed-in reader to Whop's hosted newsletter checkout. */
export function SubscribeButton() {
  const [busy, setBusy] = useState(false);
  const subscribe = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api<{ url: string }>("/api/newsletter/checkout", { method: "POST", json: {} });
      window.location.assign(result.url);
    } catch (error) {
      toast(errorText(error));
      setBusy(false);
    }
  };
  return <button type="button" disabled={busy} onClick={subscribe} className={buttonClass("primary", "lg")}>{busy ? "Opening checkout…" : "Subscribe on Whop"}</button>;
}
