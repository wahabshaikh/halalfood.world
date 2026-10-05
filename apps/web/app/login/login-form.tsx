"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AuthClientError,
  requestLoginOtp,
  verifyLoginOtp,
} from "../../src/lib/auth-client";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { BrandMark } from "../../src/components/brand";
import { FormCard, IconLink, buttonClass } from "../../src/components/kit";
import { TURNSTILE_COMPACT_MAX_WIDTH, turnstileWidgetSize } from "../../src/lib/turnstile-size";

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

function TurnstileCheck({
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

/**
 * First login sends people through onboarding; everyone else goes where they
 * were headed. If the check fails for any reason, fall back to that destination
 * rather than blocking sign-in.
 */
async function destinationAfterLogin(returnTo: string, invite?: string): Promise<string> {
  if (returnTo.startsWith("/welcome")) return returnTo;
  try {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (!response.ok) return returnTo;
    const body = (await response.json()) as { profile?: { onboarded?: boolean } | null };
    if (body.profile?.onboarded) return returnTo;
    const query = new URLSearchParams({ returnTo });
    if (invite) query.set("invite", invite);
    return `/welcome?${query}`;
  } catch {
    return returnTo;
  }
}

export default function LoginForm({
  siteKey,
  returnTo = "/",
  notice,
  invite,
}: {
  siteKey: string;
  returnTo?: string;
  notice?: string;
  invite?: string;
}) {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [turnstileError, setTurnstileError] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [turnstileSize, setTurnstileSize] = useState<"compact" | "normal" | null>(null);
  const turnstileSizeRef = useRef<"compact" | "normal" | null>(null);

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${TURNSTILE_COMPACT_MAX_WIDTH}px)`);
    const apply = () => {
      const next = turnstileWidgetSize(
        query.matches ? TURNSTILE_COMPACT_MAX_WIDTH : TURNSTILE_COMPACT_MAX_WIDTH + 1,
      );
      if (turnstileSizeRef.current && turnstileSizeRef.current !== next) setTurnstileToken("");
      turnstileSizeRef.current = next;
      setTurnstileSize(next);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const onTurnstileToken = useCallback((token: string) => {
    setTurnstileToken(token);
    if (token) setTurnstileError("");
  }, []);
  const onTurnstileError = useCallback((message: string) => {
    setTurnstileToken("");
    setTurnstileError(message);
  }, []);

  const requestCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    if (!turnstileToken) {
      setError(turnstileError || "Complete the bot check first.");
      return;
    }
    setBusy(true);
    try {
      await requestLoginOtp(email, turnstileToken);
      setStep("code");
      setStatus(`Code sent to ${email.trim().toLowerCase()}.`);
    } catch (caught) {
      const authError = caught instanceof AuthClientError ? caught : undefined;
      setError(
        authError?.status === 429
          ? "Too many requests. Please wait before asking for another code."
          : "We could not send a code. Check your email and try again.",
      );
      setTurnstileToken("");
      setTurnstileReset((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (event?: React.FormEvent<HTMLFormElement>, code = otp) => {
    event?.preventDefault();
    if (busy) return;
    setError("");
    setStatus("");
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      await verifyLoginOtp(email, code);
      setStatus("You’re in. Taking you back…");
      window.location.assign(await destinationAfterLogin(returnTo, invite));
    } catch (caught) {
      const authError = caught instanceof AuthClientError ? caught : undefined;
      setError(
        authError?.status === 429
          ? "Too many verification attempts. Please wait and request a new code."
          : "That code is not valid or has expired. Request a new one and try again.",
      );
      setOtp("");
    } finally {
      setBusy(false);
    }
  };

  const input =
    "h-[54px] w-full rounded-[14px] border border-muted-foreground/60 bg-background px-4 text-[17px] font-semibold focus:border-foreground focus:outline-none";
  return (
    <FormCard className="pb-6 md:pb-8">
      <section aria-labelledby="login-title" className="flex w-full flex-col">
        <IconLink href={returnTo} label="Close" icon={Cancel01Icon} className="-ml-2.5" />
        {step === "email" ? (
          <form className="mt-10 grid gap-4" onSubmit={requestCode}>
            <div className="grid gap-3">
              <BrandMark size={52} className="md:hidden" />
              <h1 id="login-title" className="text-[30px] leading-tight font-black tracking-tight">
                Sign in to save places and add checks
              </h1>
              <p className="text-[15px] font-semibold text-subtle-foreground">
                No password. We’ll email you a 6-digit code.
              </p>
              {notice && (
                <p role="status" className="rounded-xl bg-secondary px-3.5 py-3 text-sm font-bold">
                  {notice}
                </p>
              )}
            </div>
            <div className="mt-4 grid gap-2">
              <label htmlFor="login-email" className="text-sm font-extrabold">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                autoFocus
                placeholder="you@example.com"
                required
                maxLength={320}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={input}
              />
            </div>
            {turnstileSize && (
              <TurnstileCheck
                key={`${turnstileReset}-${turnstileSize}`}
                siteKey={siteKey}
                size={turnstileSize}
                onToken={onTurnstileToken}
                onError={onTurnstileError}
              />
            )}
            {turnstileError && <p className="text-sm text-muted-foreground">{turnstileError}</p>}
            <button
              type="submit"
              className={buttonClass("primary", "lg", "w-full")}
              disabled={busy || !email.trim() || !turnstileToken}
            >
              {busy ? "Sending…" : "Send code"}
            </button>
          </form>
        ) : (
          <form className="mt-10 grid gap-4" onSubmit={verifyCode}>
            <div className="grid gap-2.5">
              <h1 id="login-title" className="text-[30px] leading-tight font-black tracking-tight">
                Check your email
              </h1>
              <p className="text-[15px] font-semibold text-subtle-foreground" role="status">
                We sent a 6-digit code to <strong className="text-foreground">{email.trim().toLowerCase()}</strong>
              </p>
            </div>
            <div className="mt-4 grid gap-2">
              <label htmlFor="login-otp" className="text-sm font-extrabold">
                Code
              </label>
              <input
                id="login-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                value={otp}
                onChange={(event) => {
                  const code = event.target.value.replace(/\D/g, "").slice(0, 6);
                  setOtp(code);
                  // Pasting or typing the last digit is enough; no extra tap.
                  if (code.length === 6) void verifyCode(undefined, code);
                }}
                className={input + " h-16 border-2 border-foreground text-[28px] font-black tracking-[0.3em]"}
              />
            </div>
            <button type="submit" className={buttonClass("primary", "lg", "w-full")} disabled={busy || otp.length !== 6}>
              {busy ? "Checking…" : "Continue"}
            </button>
            <button
              type="button"
              className="min-h-11 justify-self-start text-sm font-extrabold underline underline-offset-3"
              onClick={() => {
                setStep("email");
                setOtp("");
                setStatus("");
                setError("");
                setTurnstileToken("");
              }}
            >
              Use a different email
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-destructive-muted px-3.5 py-3 text-sm font-bold text-destructive">
            {error}
          </p>
        )}
      </section>
    </FormCard>
  );
}
