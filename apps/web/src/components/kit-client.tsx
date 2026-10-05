"use client";

/**
 * Interactive building blocks (spec §7.2): the save heart, filter chips,
 * segmented tabs, sheets, toasts and the share action. Optimistic where the
 * spec asks for it, rolled back with a toast when the server says no.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Share08Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@halalfood/ui/lib/utils";
import { FILTERS, FILTER_LABEL, type Filter } from "@halalfood/core/halal";
import { Icon } from "./kit";
import { currentReturnPath, loginHref, signInAgainUrl } from "../lib/signed-out";

/* ------------------------------------------------------------------------ */
/* Toast                                                                     */
/* ------------------------------------------------------------------------ */

type ToastMessage = { id: number; text: string; action?: { label: string; onClick: () => void } };
let pushToast: ((message: Omit<ToastMessage, "id">) => void) | null = null;

export function toast(text: string, action?: ToastMessage["action"]) {
  pushToast?.({ text, action });
}

export function Toaster() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  useEffect(() => {
    let counter = 0;
    pushToast = (message) => {
      const id = ++counter;
      setMessages((current) => [...current.slice(-2), { ...message, id }]);
      setTimeout(() => setMessages((current) => current.filter((item) => item.id !== id)), 4500);
    };
    return () => {
      pushToast = null;
    };
  }, []);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(104px+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 md:bottom-8"
    >
      {messages.map((message) => (
        <div
          key={message.id}
          role="status"
          className="pointer-events-auto flex min-h-12 max-w-md items-center gap-3 rounded-2xl bg-foreground px-4 py-2.5 text-sm font-bold text-background shadow-lg"
        >
          <span>{message.text}</span>
          {message.action && (
            <button
              type="button"
              className="min-h-10 shrink-0 px-1 font-black text-primary-foreground underline underline-offset-3"
              onClick={message.action.onClick}
            >
              {message.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Requests                                                                  */
/* ------------------------------------------------------------------------ */

export type ApiError = { status: number; error: string; loginUrl?: string; body: Record<string, unknown> };

/** fetch JSON; a 401 sends the person to sign in and comes back here. */
export async function api<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const response = await fetch(url, {
    credentials: "same-origin",
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  // A 401 sends the person to sign in and back to this page, never the API path.
  if (response.status === 401) window.location.assign(signInAgainUrl(body));
  if (!response.ok) {
    throw {
      status: response.status,
      error: typeof body.error === "string" ? body.error : "Something went wrong. Please try again.",
      loginUrl: typeof body.loginUrl === "string" ? body.loginUrl : undefined,
      body,
    } satisfies ApiError;
  }
  return body as T;
}

export function errorText(error: unknown): string {
  return typeof error === "object" && error && "error" in error ? String((error as ApiError).error) : "Something went wrong. Please try again.";
}

/* ------------------------------------------------------------------------ */
/* Save heart                                                                */
/* ------------------------------------------------------------------------ */

export function SaveHeart({
  placeId,
  saved: initial,
  signedIn,
  variant = "plain",
  label,
}: {
  placeId: string;
  saved: boolean;
  signedIn: boolean;
  variant?: "plain" | "floating";
  label?: string;
}) {
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (!signedIn) {
      window.location.assign(loginHref(currentReturnPath(), "save"));
      return;
    }
    if (busy) return;
    const next = !saved;
    setSaved(next);
    setBusy(true);
    try {
      await api(`/api/places/${placeId}/saved`, { method: next ? "POST" : "DELETE" });
      if (!next) toast("Removed from Saved", { label: "Undo", onClick: () => void toggleTo(true) });
    } catch (error) {
      setSaved(!next);
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const toggleTo = async (value: boolean) => {
    setSaved(value);
    try {
      await api(`/api/places/${placeId}/saved`, { method: value ? "POST" : "DELETE" });
    } catch (error) {
      setSaved(!value);
      toast(errorText(error));
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${label ?? "place"} from saved` : `Save ${label ?? "place"}`}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full",
        variant === "floating" && "bg-background shadow-md",
        variant === "plain" && "hover:bg-secondary",
        saved ? "text-primary" : "text-foreground",
      )}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z" />
      </svg>
    </button>
  );
}

/* ------------------------------------------------------------------------ */
/* Chips and tabs                                                            */
/* ------------------------------------------------------------------------ */

export function chipClass(on: boolean, floating = false) {
  return cn(
    "inline-flex min-h-10 shrink-0 items-center rounded-full border px-[15px] text-sm font-extrabold whitespace-nowrap transition-colors",
    on ? "border-foreground bg-foreground text-background" : "border-input bg-background text-foreground hover:bg-secondary",
    floating && !on && "border-background shadow-sm",
  );
}

const FILTERS_STORAGE = "hf_filters";

export function readStoredFilters(): Filter[] | null {
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE);
    if (raw === null) return null;
    return FILTERS.filter((filter) => raw.split(",").includes(filter));
  } catch {
    return null;
  }
}

export function storeFilters(filters: readonly string[]) {
  try {
    window.localStorage.setItem(FILTERS_STORAGE, filters.join(","));
  } catch {
    // Remembering filters is a convenience.
  }
}

/** Filter chips that drive `?filters=` and `?friends=1` and remember the choice. */
export function FilterChips({
  filters,
  friends,
  showFriends,
  floating = false,
  className,
  onChange,
}: {
  filters: Filter[];
  friends: boolean;
  showFriends: boolean;
  floating?: boolean;
  /** Layout of the row. The default is a single scrolling line; callers add their own gutters. */
  className?: string;
  onChange?: (next: { filters: Filter[]; friends: boolean }) => void;
}) {
  const apply = (next: { filters: Filter[]; friends: boolean }) => {
    storeFilters(next.filters);
    if (showFriends) void api("/api/me/filters", { method: "PUT", json: { filters: next.filters } }).catch(() => undefined);
    if (onChange) return onChange(next);
    const url = new URL(window.location.href);
    if (next.filters.length) url.searchParams.set("filters", next.filters.join(","));
    else url.searchParams.set("filters", "");
    if (next.friends) url.searchParams.set("friends", "1");
    else url.searchParams.delete("friends");
    url.searchParams.delete("offset");
    window.location.assign(url.toString());
  };
  return (
    <div role="group" aria-label="Filters" className={cn("flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]", className)}>
      {showFriends && (
        <button type="button" aria-pressed={friends} className={chipClass(friends, floating)} onClick={() => apply({ filters, friends: !friends })}>
          Friends’ picks
        </button>
      )}
      {FILTERS.map((filter) => {
        const on = filters.includes(filter);
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={on}
            className={chipClass(on, floating)}
            onClick={() => apply({ filters: on ? filters.filter((item) => item !== filter) : [...filters, filter], friends })}
          >
            {FILTER_LABEL[filter]}
          </button>
        );
      })}
    </div>
  );
}

/** When the URL carries no filters, apply the ones this browser remembers. */
export function RestoreFilters({ hasParam }: { hasParam: boolean }) {
  useEffect(() => {
    if (hasParam) return;
    const stored = readStoredFilters();
    if (!stored?.length) return;
    const url = new URL(window.location.href);
    url.searchParams.set("filters", stored.join(","));
    window.location.replace(url.toString());
  }, [hasParam]);
  return null;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid rounded-full bg-secondary p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-10 rounded-full text-sm font-extrabold",
            option.value === value ? "bg-background text-foreground shadow-sm" : "text-subtle-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Sheet                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * A bottom sheet on phones and a centred dialog at md. It owns `?sheet=name`,
 * so the back button closes it.
 */
export function useSheet(name: string) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sync = () => setOpen(new URL(window.location.href).searchParams.get("sheet") === name);
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [name]);
  const show = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("sheet", name);
    window.history.pushState(null, "", url);
    setOpen(true);
  }, [name]);
  const hide = useCallback(() => {
    if (new URL(window.location.href).searchParams.get("sheet") === name) window.history.back();
    setOpen(false);
  }, [name]);
  return { open, show, hide };
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, textarea, select");
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-foreground/50" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative max-h-[90dvh] w-full overflow-y-auto rounded-t-[28px] bg-background px-6 pt-3 pb-[calc(28px+env(safe-area-inset-bottom))] outline-none md:max-w-md md:rounded-[28px] md:pt-6"
      >
        <span className="mx-auto mb-4 block h-[5px] w-10 rounded-full bg-input md:hidden" aria-hidden="true" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-2xl font-black">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mt-1 -mr-2 hidden size-11 items-center justify-center rounded-full hover:bg-secondary md:inline-flex">
            <Icon icon={Cancel01Icon} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Share                                                                     */
/* ------------------------------------------------------------------------ */

export function ShareAction({ url, title, text, className }: { url: string; title: string; text: string; className?: string }) {
  const share = async () => {
    const absolute = new URL(url, window.location.origin).toString();
    if (navigator.share) {
      try {
        await navigator.share({ url: absolute, title, text });
        return;
      } catch {
        // Cancelled, or not allowed here: fall back to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(absolute);
      toast("Link copied");
    } catch {
      toast("Couldn’t copy the link");
    }
  };
  return (
    <button type="button" onClick={share} aria-label="Share" className={className}>
      <Icon icon={Share08Icon} />
    </button>
  );
}

