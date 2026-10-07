"use client";

import { useState } from "react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { FILTER_LABEL, type Filter } from "@/lib/core/halal";
import { Icon, buttonClass } from "@/components/hf/kit";
import { Sheet, api, errorText, toast, useSheet } from "@/components/hf/kit-client";
import { AvatarPicker, FilterChecklist, HandleField, TextField, type HandleCheck } from "@/components/hf/people-client";
import { SignOutButton } from "@/components/hf/sign-out-button";
import { clearLocalAccountState } from "@/lib/sign-out";
import { forgetSignedIn } from "@/lib/signed-out";

type Initial = { displayName: string; handle: string; bio: string; avatarUrl: string | null; filters: Filter[] };

export function SettingsView({
  seed,
  email,
  pendingRequests,
  initial,
}: {
  seed: string;
  email: string;
  pendingRequests: number;
  initial: Initial;
}) {
  const [name, setName] = useState(initial.displayName);
  const [handle, setHandle] = useState(initial.handle);
  const [savedHandle, setSavedHandle] = useState(initial.handle);
  const [bio, setBio] = useState(initial.bio);
  const [check, setCheck] = useState<HandleCheck>({ state: "idle", message: null });
  const [filters, setFilters] = useState<Filter[]>(initial.filters);
  const [busy, setBusy] = useState(false);
  const filtersSheet = useSheet("filters");
  const deleteSheet = useSheet("delete");
  const [confirm, setConfirm] = useState("");

  const saveProfile = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api<{ profile: { handle: string } }>("/api/me", { method: "PUT", json: { displayName: name, handle, bio } });
      setSavedHandle(result.profile.handle);
      toast("Profile saved");
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const saveFilters = async () => {
    try {
      await api("/api/me", { method: "PUT", json: { defaultFilters: filters } });
      filtersSheet.hide();
      toast("Default filters saved");
    } catch (error) {
      toast(errorText(error));
    }
  };

  const deleteAccount = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/me", { method: "DELETE" });
      forgetSignedIn();
      clearLocalAccountState();
      window.location.assign("/");
    } catch (error) {
      toast(errorText(error));
      setBusy(false);
    }
  };

  const dirty = name !== initial.displayName || handle !== savedHandle || bio !== initial.bio;
  const ready = name.trim() && check.state !== "bad" && check.state !== "checking";
  const rowClass = "flex min-h-[56px] w-full items-center justify-between gap-3 border-b border-border/70 text-left text-[15px] font-extrabold text-foreground";

  return (
    <div className="grid gap-8 pt-2">
      <section className="grid gap-4">
        <AvatarPicker name={name} seed={seed} initial={initial.avatarUrl} />
        <TextField label="Name" value={name} onChange={setName} maxLength={60} />
        <HandleField value={handle} onChange={setHandle} original={savedHandle} onCheck={setCheck} />
        <TextField label="Bio" value={bio} onChange={setBio} maxLength={160} multiline placeholder="What do you love eating?" />
        <button type="button" onClick={saveProfile} disabled={!dirty || !ready || busy} className={buttonClass("primary", "lg")}>
          {busy ? "Saving…" : "Save profile"}
        </button>
      </section>

      <section className="grid">
        <a href="/me/privacy" className={rowClass}>
          Privacy & people
          <span className="flex items-center gap-2">
            {pendingRequests > 0 && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-black text-primary-foreground">{pendingRequests}</span>}
            <Icon icon={ArrowRight01Icon} size={18} />
          </span>
        </a>
        <button type="button" onClick={filtersSheet.show} className={rowClass}>
          Default filters
          <span className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            {filters.length ? filters.map((filter) => FILTER_LABEL[filter]).join(", ") : "None"}
            <Icon icon={ArrowRight01Icon} size={18} />
          </span>
        </button>
        <div className={rowClass}>
          Email
          <span className="truncate text-sm font-semibold text-muted-foreground">{email}</span>
        </div>
        <SignOutButton className={rowClass} />
        <button type="button" onClick={deleteSheet.show} className={`${rowClass} text-destructive`}>
          Delete account
        </button>
      </section>

      <Sheet open={filtersSheet.open} onClose={filtersSheet.hide} title="Default filters">
        <div className="grid gap-4">
          <p className="text-sm font-semibold text-subtle-foreground">Explore opens with these on.</p>
          <FilterChecklist value={filters} onChange={setFilters} />
          <button type="button" onClick={saveFilters} className={buttonClass("primary", "lg")}>
            Save
          </button>
        </div>
      </Sheet>

      <Sheet open={deleteSheet.open} onClose={deleteSheet.hide} title="Delete your account?">
        <div className="grid gap-4">
          <p className="text-sm font-semibold text-subtle-foreground">
            Your profile, lists, photos, follows and comments are deleted. Your halal answers stay, anonymously, so place statuses don’t change.
            This can’t be undone.
          </p>
          <TextField label="Type DELETE to confirm" value={confirm} onChange={setConfirm} maxLength={10} />
          <button type="button" onClick={deleteAccount} disabled={confirm !== "DELETE" || busy} className={buttonClass("danger", "lg")}>
            {busy ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
