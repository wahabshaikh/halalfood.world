"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Crisp } from "crisp-sdk-web";
import { getClientSession } from "@/lib/client-session";
import { isFocusedFlow } from "@/lib/focused-flow";

const CRISP_WEBSITE_ID = "b8333f3b-1afa-40e7-9103-08bbd21ebf00";
/** Below the mobile tab bar (z-50) and the check-flow action bar (z-70). */
const CRISP_Z_INDEX = 40;

export function CrispChat() {
  const pathname = usePathname() || "";

  useEffect(() => {
    Crisp.configure(CRISP_WEBSITE_ID);
    Crisp.setZIndex(CRISP_Z_INDEX);
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

  useEffect(() => {
    if (isFocusedFlow(pathname)) {
      Crisp.chat.close();
      Crisp.chat.hide();
      return;
    }
    Crisp.chat.show();
  }, [pathname]);

  return null;
}
