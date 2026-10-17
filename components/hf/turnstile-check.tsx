"use client";

import { useEffect, useRef } from "react";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      size?: "normal" | "compact" | "flexible";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  remove?(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Cloudflare Turnstile, rendered explicitly. The page loads `api.js?render=explicit` itself. */
export function TurnstileCheck({
  siteKey,
  size,
  onToken,
  onError,
}: {
  siteKey: string;
  size: "normal" | "compact";
  onToken: (token: string) => void;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!siteKey) {
      onError("The bot check is not configured yet.");
      return;
    }
    let stopped = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const render = () => {
      if (stopped || widgetId.current || !container.current || !window.turnstile)
        return Boolean(widgetId.current);
      try {
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          size,
          callback: onToken,
          "expired-callback": () => onToken(""),
          "error-callback": () => {
            onToken("");
            onError("The bot check could not load. Please try again.");
          },
        });
        return true;
      } catch {
        onError("The bot check could not load. Please try again.");
        return false;
      }
    };

    if (!render()) {
      interval = setInterval(() => {
        if (render() && interval) clearInterval(interval);
      }, 100);
      timeout = setTimeout(() => {
        if (interval) clearInterval(interval);
        if (!widgetId.current) onError("The bot check could not load. Please try again.");
      }, 15_000);
    }

    return () => {
      stopped = true;
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
      if (widgetId.current && window.turnstile?.remove)
        window.turnstile.remove(widgetId.current);
      widgetId.current = undefined;
    };
  }, [onError, onToken, siteKey, size]);

  return <div ref={container} className="min-h-16 max-w-full" />;
}
