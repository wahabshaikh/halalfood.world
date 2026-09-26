"use client";

import { useEffect } from "react";
import { getAnalytics } from "../lib/analytics";

export function DataFastAnalytics() {
  useEffect(() => {
    void getAnalytics();
  }, []);

  return null;
}
