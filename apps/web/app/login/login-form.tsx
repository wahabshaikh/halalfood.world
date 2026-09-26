"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AuthClientError,
  requestLoginOtp,
  verifyLoginOtp,
} from "../../src/lib/auth-client";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
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
  onToken,
  onError,
}: {
  siteKey: string;
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
  }, [onError, onToken, siteKey]);

  return <div ref={container} className="turnstile-check" />;
}

export default function LoginForm({
  siteKey,
  returnTo = "/",
  heading = "Log in or sign up",
}: {
  siteKey: string;
  returnTo?: string;
  heading?: string;
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
      window.location.assign(returnTo);
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

  return (
    <section className="auth-card" aria-labelledby="login-title">
      <h1 id="login-title">{heading}</h1>
      <p>Just your email. We’ll send a code, no password needed.</p>

      {step === "email" ? (
        <form className="auth-form" onSubmit={requestCode}>
          <label htmlFor="login-email">Email address</label>
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
          />
          <TurnstileCheck
            key={turnstileReset}
            siteKey={siteKey}
            onToken={onTurnstileToken}
            onError={onTurnstileError}
          />
          {turnstileError && <p className="auth-help">{turnstileError}</p>}
          <button
            type="submit"
            className="btn btn-primary auth-submit"
            disabled={busy || !email.trim() || !turnstileToken}
          >
            {busy ? "Sending…" : "Continue"}
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={verifyCode}>
          <p className="auth-status" role="status">
            {status}
          </p>
          <label htmlFor="login-otp">6-digit code</label>
          <input
            id="login-otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            pattern="[0-9]{6}"
            maxLength={6}
            value={otp}
            onChange={(event) => {
              const code = event.target.value.replace(/\D/g, "").slice(0, 6);
              setOtp(code);
              // Pasting or typing the last digit is enough; no extra tap.
              if (code.length === 6) void verifyCode(undefined, code);
            }}
          />
          <button
            type="submit"
            className="btn btn-primary auth-submit"
            disabled={busy || otp.length !== 6}
          >
            {busy ? "Checking…" : "Log in"}
          </button>
          <button
            type="button"
            className="auth-secondary"
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
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
