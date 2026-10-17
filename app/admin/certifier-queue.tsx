"use client";

import { useState } from "react";
import { buttonClass } from "@/components/hf/kit";
import { api, errorText, toast } from "@/components/hf/kit-client";
import { timeAgo } from "@/components/hf/time-ago";

export type PendingCertChange = {
  id: string;
  kindLabel: string;
  certifierName: string;
  certifierSlug: string;
  authority: string;
  sentence: string;
  detectedAt: number;
  sourceUrl: string | null;
};

export type CertSourceState = { id: string; authority: string; url: string; lastOkAt: number | null; lastCheckedAt: number | null; needsLook: boolean; lastError: string | null };

type CheckResult = { sourceId: string; ok: boolean; unchanged: boolean; rows: number; published: number; pending: number; error: string | null };

/** Pending changes to official certifier lists, and a button to run the check now. */
export function CertifierQueue({ initial, sources }: { initial: PendingCertChange[]; sources: CertSourceState[] }) {
  const [items, setItems] = useState(initial);
  const [running, setRunning] = useState(false);

  const runCheck = async () => {
    setRunning(true);
    try {
      const body = await api<{ results: CheckResult[] }>("/api/certifiers/check", { method: "POST" });
      const lines = body.results.map((result) =>
        !result.ok
          ? `${result.sourceId}: ${result.error ?? "failed"}`
          : result.unchanged
            ? `${result.sourceId}: unchanged (${result.rows})`
            : `${result.sourceId}: ${result.published} published, ${result.pending} to review`,
      );
      toast(lines.join(" · ") || "No sources to check");
      if (body.results.some((result) => result.pending)) window.location.reload();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-2xl border border-border p-4">
        {sources.map((source) => (
          <p key={source.id} className="text-sm font-semibold">
            <a href={source.url} rel="noopener" className="font-black underline-offset-4 hover:underline">
              {source.authority}
            </a>{" "}
            · last good check {source.lastOkAt ? timeAgo(source.lastOkAt) : "never"}
            {source.needsLook && <span className="font-black text-warning-strong"> · needs a look{source.lastError ? `: ${source.lastError}` : ""}</span>}
          </p>
        ))}
        <button type="button" onClick={runCheck} disabled={running} className={buttonClass("outline", "md", "justify-self-start")}>
          {running ? "Checking the official lists…" : "Run the check now"}
        </button>
      </div>
      {items.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <ChangeCard key={item.id} item={item} onDone={() => setItems((current) => current.filter((each) => each.id !== item.id))} />
          ))}
        </div>
      ) : (
        <p className="py-10 text-center text-sm font-semibold text-muted-foreground">No list changes to review.</p>
      )}
    </div>
  );
}

function ChangeCard({ item, onDone }: { item: PendingCertChange; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    try {
      await api(`/api/admin/certifier-changes/${item.id}`, { method: "POST", json: { decision } });
      toast(decision === "approve" ? "Published" : "Rejected");
      onDone();
    } catch (error) {
      toast(errorText(error));
      setBusy(false);
    }
  };
  return (
    <article className="grid gap-3 rounded-2xl border border-border p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-warning-muted px-2.5 py-0.5 text-xs font-black text-warning-strong">{item.kindLabel}</span>
        <span className="text-xs font-bold text-muted-foreground">{item.authority}</span>
        <span className="ml-auto text-xs font-bold text-muted-foreground">{timeAgo(item.detectedAt)}</span>
      </div>
      <a href={`/certifiers/${item.certifierSlug}`} className="text-[15px] font-black text-foreground underline-offset-4 hover:underline">
        {item.certifierName}
      </a>
      <p className="text-sm">{item.sentence}</p>
      {item.sourceUrl && (
        <a href={item.sourceUrl} rel="noopener" className="text-sm font-bold text-primary underline-offset-4 hover:underline">
          Compare with the official list
        </a>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => decide("approve")} disabled={busy} className={buttonClass("dark", "md")}>
          Publish
        </button>
        <button type="button" onClick={() => decide("reject")} disabled={busy} className={buttonClass("outline", "md")}>
          Reject
        </button>
      </div>
    </article>
  );
}
