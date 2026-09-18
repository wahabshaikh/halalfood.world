"use client";

import { useEffect, useRef, useState } from "react";
import { authClient } from "../lib/auth-client";

const CRISP_WEBSITE_ID = "b8333f3b-1afa-40e7-9103-08bbd21ebf00";

declare global {
  interface Window {
    $crisp?: unknown[];
    CRISP_WEBSITE_ID?: string;
  }
}

type IdentityResponse = {
  email?: string;
  signature?: string;
  name?: string | null;
};

async function fetchSignedIdentity(): Promise<IdentityResponse | null> {
  try {
    const response = await fetch("/api/crisp/identity", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as IdentityResponse;
  } catch {
    return null;
  }
}

export function CrispChat() {
  const [email, setEmail] = useState<string | null>(null);
  const identifiedRef = useRef(false);

  useEffect(() => {
    if (!window.$crisp) {
      window.$crisp = [];
      window.CRISP_WEBSITE_ID = CRISP_WEBSITE_ID;

      const script = document.createElement("script");
      script.src = "https://client.crisp.chat/l.js";
      script.async = true;
      document.head.appendChild(script);
    }

    return authClient.useSession.subscribe((session) => {
      setEmail(session.data?.user?.email ?? null);
    });
  }, []);

  useEffect(() => {
    const crisp = window.$crisp;
    if (!crisp) return;

    if (!email) {
      if (identifiedRef.current) {
        identifiedRef.current = false;
        crisp.push(["do", "session:reset"]);
      }
      return;
    }

    let cancelled = false;
    fetchSignedIdentity().then((identity) => {
      if (cancelled || !identity?.email || !identity.signature) return;
      identifiedRef.current = true;
      crisp.push(["set", "user:email", [identity.email, identity.signature]]);
      if (identity.name) crisp.push(["set", "user:nickname", [identity.name]]);
    });
    return () => {
      cancelled = true;
    };
  }, [email]);

  return null;
}
