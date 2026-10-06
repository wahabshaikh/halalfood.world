"use client";

import { useState } from "react";
import { buttonClass } from "@/components/hf/kit";
import { api, errorText, toast } from "@/components/hf/kit-client";
import { SendSheetButton } from "@/components/hf/send-sheet";
import { currentReturnPath, loginHref } from "@/lib/signed-out";

export function EventActions({ eventId, title, going: initial, signedIn }: { eventId: string; title: string; going: boolean; signedIn: boolean }) {
  const [going, setGoing] = useState(initial);
  const toggle = async () => {
    if (!signedIn) return window.location.assign(loginHref(currentReturnPath()));
    const next = !going;
    setGoing(next);
    try {
      await api(`/api/events/${eventId}/going`, { method: next ? "PUT" : "DELETE" });
    } catch (error) {
      setGoing(!next);
      toast(errorText(error));
    }
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={toggle} aria-pressed={going} className={buttonClass(going ? "done" : "primary", "lg")}>
        {going ? "You’re going" : "I’m going"}
      </button>
      {signedIn ? (
        <SendSheetButton target={{ kind: "event", id: eventId, name: title }} className={buttonClass("outline", "lg")} label="Send" />
      ) : (
        <a href={loginHref(`/event/${eventId}`)} className={buttonClass("outline", "lg")}>
          Send
        </a>
      )}
    </div>
  );
}
