"use client";

import { useEffect, useRef, useState } from "react";
import { Crisp } from "crisp-sdk-web";
import { authClient } from "../lib/auth-client";

const CRISP_WEBSITE_ID = "b8333f3b-1afa-40e7-9103-08bbd21ebf00";

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
    Crisp.configure(CRISP_WEBSITE_ID);
    return authClient.useSession.subscribe((session) => {
      setEmail(session.data?.user?.email ?? null);
    });
  }, []);

  useEffect(() => {
    if (!email) {
      if (identifiedRef.current) {
        identifiedRef.current = false;
        Crisp.session.reset();
      }
      return;
    }

    let cancelled = false;
    fetchSignedIdentity().then((identity) => {
      if (cancelled || !identity?.email || !identity.signature) return;
      identifiedRef.current = true;
      Crisp.user.setEmail(identity.email, identity.signature);
      if (identity.name) Crisp.user.setNickname(identity.name);
    });
    return () => {
      cancelled = true;
    };
  }, [email]);

  return null;
}
