"use client";

import { useState } from "react";
import { buttonClass } from "@/components/hf/kit";
import { api, errorText, toast } from "@/components/hf/kit-client";
import { SwitchRow, TextField } from "@/components/hf/people-client";
import type { MemberKey } from "@/lib/member-keys";

const MAX_KEYS = 3;

function when(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function KeysView({ initial }: { initial: MemberKey[] }) {
  const [keys, setKeys] = useState(initial);
  const [name, setName] = useState("");
  const [write, setWrite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const made = await api<{ key: string; record: MemberKey }>("/api/me/keys", {
        method: "POST",
        json: { name, scopes: write ? ["read", "write"] : ["read"] },
      });
      setKeys((current) => [made.record, ...current]);
      setFresh(made.key);
      setName("");
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      toast("Key copied.");
    } catch {
      toast("Select the key and copy it.");
    }
  };

  const revoke = async (key: MemberKey) => {
    if (!window.confirm(`Revoke "${key.name}"? Anything using it stops working at once.`)) return;
    try {
      await api(`/api/me/keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });
      setKeys((current) => current.filter((item) => item.id !== key.id));
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <div className="grid gap-8 pt-2">
      <p className="text-[15px] text-muted-foreground">
        A key lets your own AI assistant act on halalfood.world as you. Treat it like a password. Keys open up once your
        account is 7 days old, and you can have up to {MAX_KEYS}.
      </p>

      {fresh && (
        <section className="grid gap-2 rounded-2xl border border-border p-4" aria-live="polite">
          <h2 className="text-[17px] font-black">Copy your new key now</h2>
          <p className="text-sm text-muted-foreground">You won&apos;t see it again. If you lose it, revoke it and make another.</p>
          <code className="select-all break-all rounded-xl bg-muted px-3 py-2 text-sm font-semibold" data-testid="new-key">
            {fresh}
          </code>
          <div className="flex gap-2">
            <button type="button" onClick={copy} className={buttonClass("primary", "sm", "min-h-9 px-4")}>
              Copy key
            </button>
            <button type="button" onClick={() => setFresh(null)} className={buttonClass("outline", "sm", "min-h-9 px-4")}>
              Done
            </button>
          </div>
        </section>
      )}

      <section className="grid gap-2">
        <h2 className="text-[17px] font-black">Your keys</h2>
        {keys.length ? (
          <ul className="grid">
            {keys.map((key) => (
              <li key={key.id} className="flex items-center gap-3 border-b border-border/70 py-3 last:border-b-0">
                <div className="grid min-w-0 flex-1">
                  <span className="truncate text-[15px] font-extrabold">{key.name}</span>
                  <span className="text-sm text-muted-foreground">
                    <code>{key.prefix}…</code> · {key.scopes.includes("write") ? "Read and write" : "Read only"} · made {when(key.createdAt)}
                    {" · "}
                    {key.lastUsedAt ? `last used ${when(key.lastUsedAt)}` : "never used"}
                  </span>
                </div>
                <button type="button" onClick={() => revoke(key)} className={buttonClass("outline", "sm", "min-h-9 px-4")}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No keys yet.</p>
        )}
      </section>

      {keys.length < MAX_KEYS && (
        <section className="grid gap-3">
          <h2 className="text-[17px] font-black">New key</h2>
          <TextField label="Name" value={name} onChange={setName} maxLength={40} placeholder="Claude on my laptop" />
          <SwitchRow label="Allow writes" hint="Off: the key can only read." checked={write} onChange={setWrite} />
          <button type="button" onClick={create} disabled={busy || !name.trim()} className={buttonClass("primary", "md")}>
            Create key
          </button>
        </section>
      )}
    </div>
  );
}
