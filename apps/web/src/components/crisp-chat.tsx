"use client";

import { useEffect } from "react";
import { Crisp } from "crisp-sdk-web";
import { getClientSession } from "../lib/client-session";

const CRISP_WEBSITE_ID = "b8333f3b-1afa-40e7-9103-08bbd21ebf00";

export function CrispChat() {
  useEffect(() => {
    Crisp.configure(CRISP_WEBSITE_ID);
    // One shared lookup per page load. Better Auth's `useSession` store would
    // also refetch the session on every tab focus.
    let active = true;
    void getClientSession().then((user) => {
      const email = user?.email;
      if (!active || !email) return;
      Crisp.user.setEmail(email);
      if (user.name) Crisp.user.setNickname(user.name);
    });
    return () => {
      active = false;
    };
  }, []);

  return null;
}
