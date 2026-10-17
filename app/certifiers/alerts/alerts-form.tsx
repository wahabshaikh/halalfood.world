"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckmarkBadge01Icon } from "@hugeicons/core-free-icons";
import { Icon, buttonClass } from "@/components/hf/kit";
import { api, errorText } from "@/components/hf/kit-client";
import { TurnstileCheck } from "@/components/hf/turnstile-check";
import { turnstileWidgetSize } from "@/lib/turnstile-size";

const FIELD = "min-h-12 w-full rounded-xl border border-input bg-background px-3.5 text-[15px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AlertsForm({
  siteKey,
  countries,
  certifiers,
  scopes,
  initialCertifier,
}: {
  siteKey: string;
  countries: { id: string; label: string }[];
  certifiers: { slug: string; name: string }[];
  scopes: { code: string; label: string }[];
  initialCertifier: string | null;
}) {
  const [email, setEmail] = useState("");
  const [authorities, setAuthorities] = useState<string[]>(countries.map((country) => country.id));
  const [certifier, setCertifier] = useState(initialCertifier ?? "");
  const [chosenScopes, setChosenScopes] = useState<string[]>([]);
  const [token, setToken] = useState("");
  const [size, setSize] = useState<"compact" | "normal" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [widget, setWidget] = useState(0);

  useEffect(() => setSize(turnstileWidgetSize(window.innerWidth)), []);
  const onToken = useCallback((value: string) => setToken(value), []);
  const onError = useCallback((message: string) => setError(message), []);

  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((each) => each !== value) : [...list, value]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!token) {
      setError("Please complete the bot check.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/certifiers/alerts", {
        method: "POST",
        json: { email, authorities, certifiers: certifier ? [certifier] : [], scopes: chosenScopes, turnstileToken: token },
      });
      setDone(true);
    } catch (failure) {
      setError(errorText(failure));
      setToken("");
      setWidget((count) => count + 1);
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <div role="status" className="grid justify-items-start gap-2 rounded-2xl bg-success-muted p-5 text-success">
        <Icon icon={CheckmarkBadge01Icon} size={28} />
        <p className="text-[17px] font-black">You are on the list.</p>
        <p className="text-sm font-semibold">We will email {email} once to confirm before we send any alert.</p>
      </div>
    );

  return (
    <form onSubmit={submit} className="grid gap-5 md:rounded-[24px] md:border md:border-border md:p-6" noValidate>
      <label className="grid gap-1.5">
        <span className="text-sm font-extrabold">Email</span>
        <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} className={FIELD} />
      </label>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-extrabold">Importing countries</legend>
        {countries.map((country) => (
          <label key={country.id} className="flex min-h-11 items-center gap-3 text-[15px] font-semibold">
            <input type="checkbox" checked={authorities.includes(country.id)} onChange={() => setAuthorities(toggle(authorities, country.id))} className="size-5 accent-primary" />
            {country.label}
          </label>
        ))}
      </fieldset>

      <label className="grid gap-1.5">
        <span className="text-sm font-extrabold">Only one certifier (optional)</span>
        <select value={certifier} onChange={(event) => setCertifier(event.target.value)} className={FIELD}>
          <option value="">Every certifier</option>
          {certifiers.map((each) => (
            <option key={each.slug} value={each.slug}>
              {each.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-extrabold">Only these product scopes (optional)</legend>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          {scopes.map((scope) => (
            <label key={scope.code} className="flex min-h-11 items-center gap-3 text-[15px] font-semibold">
              <input type="checkbox" checked={chosenScopes.includes(scope.code)} onChange={() => setChosenScopes(toggle(chosenScopes, scope.code))} className="size-5 accent-primary" />
              {scope.label}
            </label>
          ))}
        </div>
      </fieldset>

      {size && <TurnstileCheck key={widget} siteKey={siteKey} size={size} onToken={onToken} onError={onError} />}

      {error && (
        <p role="alert" className="text-sm font-bold text-destructive">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy || !email} className={buttonClass("primary", "lg")}>
        {busy ? "Signing you up…" : "Sign up for alerts"}
      </button>
    </form>
  );
}
