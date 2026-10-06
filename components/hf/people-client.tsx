"use client";

import { useEffect, useRef, useState } from "react";
import { Camera01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { FILTERS, FILTER_LABEL, type Filter } from "@/lib/core/halal";
import { cn } from "@/lib/utils";
import { Avatar, Icon, buttonClass } from "./kit";
import { api, errorText, toast } from "./kit-client";

/* ------------------------------------------------------------------------ */
/* Follow                                                                    */
/* ------------------------------------------------------------------------ */

export type FollowState = "following" | "requested" | "none";

export function FollowButton({
  handle,
  initial,
  size = "md",
  className,
  onChange,
}: {
  handle: string;
  initial: FollowState;
  size?: "sm" | "md";
  className?: string;
  onChange?: (state: FollowState) => void;
}) {
  const [state, setState] = useState<FollowState>(initial);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (state === "none") {
        const result = await api<{ status: "pending" | "accepted" }>(`/api/follows/${encodeURIComponent(handle)}`, { method: "PUT" });
        const next = result.status === "pending" ? "requested" : "following";
        setState(next);
        onChange?.(next);
      } else {
        await api(`/api/follows/${encodeURIComponent(handle)}`, { method: "DELETE" });
        setState("none");
        onChange?.("none");
      }
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const label = state === "following" ? "Following" : state === "requested" ? "Requested" : "Follow";
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={state !== "none"}
      className={buttonClass(state === "none" ? "primary" : "outline", size === "sm" ? "sm" : "md", cn(size === "sm" && "min-h-9 px-4", className))}
    >
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------------ */
/* Switch                                                                    */
/* ------------------------------------------------------------------------ */

export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-[60px] items-center justify-between gap-3 py-2">
      <span className="grid gap-0.5">
        <span className="text-[15px] font-extrabold">{label}</span>
        {hint && <span className="text-[13px] font-semibold text-muted-foreground">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("flex h-[30px] w-[50px] shrink-0 rounded-full p-[3px]", checked ? "justify-end bg-success" : "justify-start bg-input")}
      >
        <span className="size-6 rounded-full bg-white shadow" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Default filters                                                           */
/* ------------------------------------------------------------------------ */

export function FilterChecklist({ value, onChange }: { value: Filter[]; onChange: (next: Filter[]) => void }) {
  return (
    <div className="grid gap-2">
      {FILTERS.map((filter) => {
        const on = value.includes(filter);
        return (
          <button
            key={filter}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => onChange(on ? value.filter((item) => item !== filter) : FILTERS.filter((item) => item === filter || value.includes(item)))}
            className={cn(
              "flex min-h-[54px] items-center justify-between gap-3 rounded-[14px] border px-4 text-left text-[15px] font-extrabold",
              on ? "border-foreground" : "border-input",
            )}
          >
            {FILTER_LABEL[filter]}
            <span className={cn("flex size-6 items-center justify-center rounded-md border-2", on ? "border-foreground bg-foreground text-background" : "border-input")}>
              {on && <Icon icon={Tick02Icon} size={14} strokeWidth={3} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Handle                                                                    */
/* ------------------------------------------------------------------------ */

export type HandleCheck = { state: "idle" | "checking" | "ok" | "bad"; message: string | null };

/** A handle input with a live availability check. */
export function HandleField({
  value,
  onChange,
  original,
  onCheck,
}: {
  value: string;
  onChange: (value: string) => void;
  original?: string;
  onCheck: (check: HandleCheck) => void;
}) {
  const [check, setCheck] = useState<HandleCheck>({ state: "idle", message: null });
  const ticket = useRef(0);
  useEffect(() => {
    const handle = value.trim().toLowerCase();
    const mine = ++ticket.current;
    if (!handle || handle === original) {
      const idle = { state: "idle" as const, message: null };
      setCheck(idle);
      onCheck(idle);
      return;
    }
    const checking = { state: "checking" as const, message: "Checking…" };
    setCheck(checking);
    onCheck(checking);
    const timer = window.setTimeout(async () => {
      try {
        const result = await api<{ available: boolean; error?: string }>(`/api/handles/check?h=${encodeURIComponent(handle)}`);
        if (mine !== ticket.current) return;
        const next: HandleCheck = result.available ? { state: "ok", message: "Available" } : { state: "bad", message: result.error ?? "That handle is taken." };
        setCheck(next);
        onCheck(next);
      } catch {
        if (mine !== ticket.current) return;
        const next: HandleCheck = { state: "idle", message: null };
        setCheck(next);
        onCheck(next);
      }
    }, 300);
    return () => window.clearTimeout(timer);
    // onCheck is a setter from the parent; the value drives the check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, original]);
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-extrabold">Handle</span>
      <span className="flex h-[50px] items-center rounded-[14px] border border-input px-3.5 focus-within:border-foreground">
        <span className="text-[15px] font-bold text-muted-foreground">@</span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value.toLowerCase().replace(/\s/g, ""))}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={30}
          className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none"
        />
      </span>
      {check.message && (
        <span className={cn("text-[13px] font-bold", check.state === "ok" ? "text-success" : check.state === "bad" ? "text-destructive" : "text-muted-foreground")}>
          {check.message}
        </span>
      )}
    </label>
  );
}

/* ------------------------------------------------------------------------ */
/* Avatar                                                                    */
/* ------------------------------------------------------------------------ */

export function AvatarPicker({ name, seed, initial }: { name: string; seed: string; initial: string | null }) {
  const [src, setSrc] = useState(initial);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const result = await api<{ avatarUrl: string }>("/api/me/avatar", { method: "POST", body: form });
      setSrc(result.avatarUrl);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-4">
      <Avatar name={name || "You"} seed={seed} src={src} size={72} />
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className={buttonClass("outline", "sm", "min-h-10 px-4")}>
        <Icon icon={Camera01Icon} size={16} />
        {busy ? "Uploading…" : src ? "Change photo" : "Add a photo"}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  maxLength,
  multiline = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  multiline?: boolean;
  placeholder?: string;
}) {
  const className = "w-full rounded-[14px] border border-input px-3.5 text-[15px] font-semibold outline-none focus:border-foreground";
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-extrabold">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={maxLength}
          rows={3}
          placeholder={placeholder}
          className={cn(className, "resize-none py-3")}
        />
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} placeholder={placeholder} className={cn(className, "h-[50px]")} />
      )}
    </label>
  );
}
