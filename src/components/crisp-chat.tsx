"use client";

import { useEffect, useRef } from "react";
import { Crisp } from "crisp-sdk-web";
import { authClient } from "../lib/auth-client";

const CRISP_WEBSITE_ID = "b8333f3b-1afa-40e7-9103-08bbd21ebf00";

export function CrispChat() {
  const identifiedRef = useRef(false);

  useEffect(() => {
    Crisp.configure(CRISP_WEBSITE_ID);
    return authClient.useSession.subscribe((session) => {
      const user = session.data?.user;
      const email = user?.email?.trim();
      if (!email) {
        if (identifiedRef.current) {
          identifiedRef.current = false;
          Crisp.session.reset();
        }
        return;
      }
      identifiedRef.current = true;
      Crisp.user.setEmail(email);
      const name = user?.name?.trim();
      if (name) Crisp.user.setNickname(name);
    });
  }, []);

  return null;
}
